"""Meta (Facebook + Instagram) Marketing API client.

Instagram is not a separate ad platform: IG ads are bought through the same
Meta ad account, so one credential feeds both channels. The
``publisher_platform`` breakdown is what splits them.

Conversions and revenue are nested inside ``actions`` / ``action_values``
arrays rather than being flat fields; which action types count as a conversion
is deliberately explicit below rather than guessed at.
"""
import json
from datetime import date
from decimal import Decimal

import httpx

from app.services.ad_sync.base import (
    NormalizedMetric,
    normalise_channel,
    to_decimal,
    to_int,
)

GRAPH_VERSION = "v21.0"
GRAPH_BASE = f"https://graph.facebook.com/{GRAPH_VERSION}"
TIMEOUT = 60

FIELDS = ",".join(
    [
        "campaign_id",
        "campaign_name",
        "spend",
        "impressions",
        "clicks",
        "actions",
        "action_values",
        "account_currency",
    ]
)

# What counts as a conversion. Kept explicit so the number in the UI has a
# defined meaning rather than depending on the account's default attribution.
CONVERSION_ACTIONS = {
    "purchase",
    "offsite_conversion.fb_pixel_purchase",
    "lead",
    "offsite_conversion.fb_pixel_lead",
    "complete_registration",
    "offsite_conversion.fb_pixel_complete_registration",
}
REVENUE_ACTIONS = {"purchase", "offsite_conversion.fb_pixel_purchase"}


def _sum_actions(rows, wanted: set[str]) -> Decimal:
    total = Decimal("0")
    for row in rows or []:
        if row.get("action_type") in wanted:
            total += to_decimal(row.get("value"))
    return total


def _error_message(response: httpx.Response) -> str:
    try:
        payload = response.json()
    except (json.JSONDecodeError, ValueError):
        return response.text[:200]
    return (payload.get("error") or {}).get("message") or response.text[:200]


def parse_rows(payload: dict) -> list[NormalizedMetric]:
    out: list[NormalizedMetric] = []
    for row in payload.get("data") or []:
        raw_date = row.get("date_start")
        if not raw_date:
            continue
        out.append(
            NormalizedMetric(
                external_campaign_id=str(row.get("campaign_id") or ""),
                campaign_name=row.get("campaign_name") or "Untitled campaign",
                campaign_status="active",
                channel=normalise_channel(row.get("publisher_platform", "")),
                date=date.fromisoformat(raw_date),
                spend=to_decimal(row.get("spend")),
                impressions=to_int(row.get("impressions")),
                clicks=to_int(row.get("clicks")),
                conversions=int(_sum_actions(row.get("actions"), CONVERSION_ACTIONS)),
                revenue=_sum_actions(row.get("action_values"), REVENUE_ACTIONS),
                currency=(row.get("account_currency") or "USD").upper(),
            )
        )
    return out


class MetaProvider:
    key = "meta"

    def __init__(self, transport: httpx.BaseTransport | None = None) -> None:
        # Injected only by tests, so the suite never makes a live call.
        self._transport = transport

    def _client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(timeout=TIMEOUT, transport=self._transport)

    async def fetch(
        self, cfg: dict, since: date, until: date
    ) -> list[NormalizedMetric]:
        account = (cfg.get("ad_account_id") or "").strip()
        token = (cfg.get("access_token") or "").strip()
        if not account or not token:
            raise RuntimeError("Meta needs an ad account ID and an access token")
        if not account.startswith("act_"):
            account = f"act_{account}"

        url = f"{GRAPH_BASE}/{account}/insights"
        params = {
            "level": "campaign",
            "time_increment": 1,
            "breakdowns": "publisher_platform",
            "fields": FIELDS,
            "time_range": json.dumps(
                {"since": since.isoformat(), "until": until.isoformat()}
            ),
            "limit": 500,
            "access_token": token,
        }

        rows: list[NormalizedMetric] = []
        async with self._client() as client:
            while url:
                response = await client.get(url, params=params)
                if response.status_code != 200:
                    raise RuntimeError(f"Meta: {_error_message(response)}")
                payload = response.json()
                rows.extend(parse_rows(payload))
                # The next URL already carries every parameter, including the token.
                url = (payload.get("paging") or {}).get("next") or ""
                params = None
        return rows

    async def verify(self, cfg: dict) -> dict:
        account = (cfg.get("ad_account_id") or "").strip()
        token = (cfg.get("access_token") or "").strip()
        if not account or not token:
            return {"ok": False, "error": "Ad account ID and access token required"}
        if not account.startswith("act_"):
            account = f"act_{account}"
        try:
            async with self._client() as client:
                response = await client.get(
                    f"{GRAPH_BASE}/{account}",
                    params={"fields": "name,currency", "access_token": token},
                )
        except httpx.HTTPError as e:
            return {"ok": False, "error": str(e)[:200]}
        if response.status_code != 200:
            return {"ok": False, "error": _error_message(response)}
        body = response.json()
        return {
            "ok": True,
            "account_name": body.get("name"),
            "currency": (body.get("currency") or "").upper() or None,
        }
