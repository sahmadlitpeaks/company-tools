"""Run the SharePoint extraction pipeline against a local synthetic PDF pack.

The pack stays outside the repository. Live analysis is opt-in and bounded by
an explicit total cost ceiling; results are written to a caller-chosen file.
"""

import argparse
import asyncio
import json
import re
from datetime import datetime
from pathlib import Path

from app.core.config import settings
from app.services.sharepoint.analysis import analyze, payload
from app.services.sharepoint.common import SharePointError
from app.services.sharepoint.privacy import extract


def _date(value: str | None) -> str | None:
    if not value:
        return None
    for form in ("%Y-%m-%d", "%d %b %Y", "%d %B %Y"):
        try:
            return datetime.strptime(value, form).date().isoformat()
        except ValueError:
            continue
    return value


def _fact(compliance: dict, key: str) -> str | None:
    fact = compliance.get(key)
    return fact.get("value") if isinstance(fact, dict) else None


def core_checks(category: str, expected: dict, result: dict,
                source_text: str = "") -> dict[str, bool]:
    """Compare evidence-backed fields; test-pack instructions are never ground truth."""
    section = result["sections"][0]
    compliance = section["compliance"]
    summary = section["summary"].casefold()
    dates = {(row["category"], row["date"]) for row in section.get("expiries", [])}
    if category == "licenses":
        checks = {
            "entity": _fact(compliance, "company") == expected["entity"],
            "license_number": _fact(compliance, "reference_number") == expected["license_no"],
            "current_issue": _date(_fact(compliance, "issue_date")) == _date(expected.get("current_issue")),
            "expiry": _date(_fact(compliance, "expiry_date")) == _date(expected["expiry"]),
        }
        # The OCR fixture's ground truth describes an inferred state that is
        # not printed on the page. Never reward a model for inventing it.
        if expected["status"].casefold() in source_text.casefold():
            checks["status"] = _fact(compliance, "document_status") == expected["status"]
        return checks
    if category == "products":
        price = re.search(r"([A-Z]{3})\s*([\d,]+(?:\.\d+)?)", expected["price"])
        amount = float(price.group(2).replace(",", "")) if price else None
        currency = price.group(1) if price else None
        return {
            "sku": expected["sku"].casefold() in summary,
            "name": expected["name"].casefold() in summary,
            "status": expected["status"].casefold() in summary,
            "price": any(row.get("amount") == amount and row.get("currency") == currency
                         for row in section.get("commercials", [])),
            "effective": ("effective", _date(expected["effective_from"])) in dates,
            "valid_until": ("expiry", _date(expected["valid_until"])) in dates,
        }
    if category == "pricing_agreements":
        checks = {
            "agreement_number": _fact(compliance, "reference_number") == expected["agreement_no"],
            "effective": _date(_fact(compliance, "effective_date")) == _date(expected["effective"]),
            "expiry": _date(_fact(compliance, "expiry_date")) == _date(expected["expiry"]),
        }
        notice = re.search(r"\b(\d+)\s+days?\s+notice\b", expected.get("renewal") or "", re.I)
        if notice:
            checks["notice_days"] = (compliance.get("termination_notice") or {}).get("days") == int(notice.group(1))
        return checks
    # Supporting documents have different forms. Check only explicit source
    # dates that the existing analysis contract can represent.
    checks = {}
    for _, rows in expected.get("sections", []):
        for label, value in rows:
            if label in {"Expiry Date", "Valid Until"}:
                checks["expiry"] = _date(_fact(compliance, "expiry_date")) == _date(value)
            elif label == "Renewal Offer Deadline":
                checks["offer_deadline"] = any(
                    _date(action.get("deadline")) == _date(value)
                    for action in compliance.get("required_actions", []))
    return checks


def _save(path: Path, report: dict) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    temporary.replace(path)


async def evaluate(folder: Path, output: Path, *, live: bool, max_spend: float,
                   input_price: float, output_price: float,
                   selected: set[str] | None = None) -> dict:
    truth = json.loads((folder / "ground_truth.json").read_text(encoding="utf-8"))
    expected = {
        entry["filename"]: (category, entry)
        for category in ("licenses", "products", "pricing_agreements", "supporting_documents")
        for entry in truth[category]
    }
    files = sorted(folder.glob("*.pdf"))
    if {file.name for file in files} != set(expected):
        raise ValueError("PDF inventory differs from ground_truth.json")
    if selected:
        if not selected <= set(expected):
            raise ValueError("Selected filenames must occur in ground_truth.json")
        files = [file for file in files if file.name in selected]
    if live and (max_spend <= 0 or not settings.SHAREPOINT_OPENAI_API_KEY):
        raise ValueError("Live analysis needs a positive cost ceiling and configured API key")

    report = {"model": settings.SHAREPOINT_OPENAI_MODEL if live else None,
              "max_spend_usd": max_spend if live else None,
              "estimated_spend_usd": 0.0, "files": {}}
    for file in files:
        category, truth_entry = expected[file.name]
        row = {"category": category, "bytes": file.stat().st_size}
        report["files"][file.name] = row
        reservation = 0.0
        try:
            if row["bytes"] > settings.SHAREPOINT_MAX_FILE_BYTES:
                raise SharePointError("file_limit", 422)
            segments = extract(file.read_bytes(), "pdf", settings.SHAREPOINT_MAX_TEXT_CHARS)
            row["segments"] = len(segments)
            row["characters"] = sum(len(segment["text"]) for segment in segments)
            row["extraction"] = "ok"
            if live:
                request = payload(segments)
                # Reserve a deliberately high token ceiling before each call.
                # The actual usage replaces this reservation after completion.
                input_ceiling = len(json.dumps(request, ensure_ascii=False).encode("utf-8")) + 5000
                reservation = (input_ceiling * input_price +
                               len(request["batches"]) * 6000 * output_price) / 1_000_000
                if report["estimated_spend_usd"] + reservation > max_spend:
                    row["analysis"] = "budget_stop"
                    _save(output, report)
                    break
                result, usage = await analyze(segments)
                row["analysis"] = "ok"
                row["usage"] = usage
                row["result"] = result
                row["core_checks"] = core_checks(category, truth_entry, result,
                                                 " ".join(segment["text"] for segment in segments))
                report["estimated_spend_usd"] += (
                    usage["input_tokens"] * input_price + usage["output_tokens"] * output_price
                ) / 1_000_000
        except SharePointError as error:
            row["error"] = error.code
            if live and row.get("extraction") == "ok":
                report["estimated_spend_usd"] += reservation
        except Exception as error:
            row["error"] = type(error).__name__
            if live and row.get("extraction") == "ok":
                report["estimated_spend_usd"] += reservation
        _save(output, report)
        print(file.name, row.get("analysis", row.get("extraction", "failed")),
              row.get("error", ""), flush=True)
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("folder", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--live", action="store_true")
    parser.add_argument("--max-spend-usd", type=float, default=0)
    parser.add_argument("--input-price-per-million", type=float, default=0.10)
    parser.add_argument("--output-price-per-million", type=float, default=0.50)
    parser.add_argument("--select", action="append", default=[], metavar="FILENAME",
                        help="Analyze only this PDF (repeat to select several)")
    args = parser.parse_args()
    report = asyncio.run(evaluate(args.folder, args.output, live=args.live,
                                  max_spend=args.max_spend_usd,
                                  input_price=args.input_price_per_million,
                                  output_price=args.output_price_per_million,
                                  selected=set(args.select)))
    print("processed", len(report["files"]), "estimated_spend_usd",
          round(report["estimated_spend_usd"], 6), flush=True)


if __name__ == "__main__":
    main()
