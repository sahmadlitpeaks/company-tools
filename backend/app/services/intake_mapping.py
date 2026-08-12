"""Map arbitrary website form fields onto submission columns.

Form builders let every site name its fields freely — Contact Form 7 ships
``your-name``/``your-email`` by default but happily emits ``tel-123``,
``menu-456`` or ``text-874`` once a form is edited. This module turns whatever
arrives into the fixed set of submission columns, using a per-form mapping
document that an admin can correct at any time.

Everything here is a pure function of its arguments — no database, no I/O — so
re-applying a corrected mapping to a stored raw payload is guaranteed to produce
exactly what live ingestion would have produced.
"""
import hashlib
import re
from dataclasses import dataclass, field
from typing import Any

# Where a form field can be sent. `extra` keeps the value out of the columns but
# in the submission payload, optionally under a friendlier label.
TARGETS = [
    "name", "email", "phone", "company", "subject", "message",
    "page_url", "type", "extra",
]
TRANSFORMS = [
    "trim", "lower", "upper", "title", "digits", "strip_html",
    "join_array", "first_line", "email_only",
]
# Column widths, applied after transforms so a checkbox group can never
# overflow `Submission.email` and take the whole request down with it.
_LIMITS: dict[str, int | None] = {
    "name": 255, "email": 320, "phone": 64, "company": 255,
    "subject": 512, "page_url": 1024, "message": None, "type": 16,
}
_CORE_TARGETS = [t for t in TARGETS if t not in ("extra",)]

# WordPress/Contact Form 7 plumbing. Dropped from the visible extras, but still
# present in `Submission.raw_payload` if anyone ever needs to audit it.
_WP_INTERNAL = {
    "_wpcf7", "_wpcf7_version", "_wpcf7_locale", "_wpcf7_unit_tag",
    "_wpcf7_container_post", "_wpcf7_posted_data_hash", "_wpcf7_recaptcha_response",
    "_wpnonce", "_wp_http_referer", "g-recaptcha-response", "h-captcha-response",
    "cf-turnstile-response",
}

_EMAIL_RE = re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}")
_TAG_RE = re.compile(r"<[^>]+>")
_TRAILING_NUM_RE = re.compile(r"[-_]?\d+$")
_SENSITIVE_RE = re.compile(
    r"pass(word|wd)?|secret|token|api[-_ ]?key|cvv|cvc|iban|swift|ssn|"
    r"card[-_ ]?(no|number)|account[-_ ]?(no|number)",
    re.IGNORECASE,
)

# Exact matches on the normalised field name. Highest confidence.
_EXACT: dict[str, set[str]] = {
    "name": {
        "your name", "name", "full name", "fullname", "customer name",
        "contact name", "sender name", "client name", "nombre", "nom",
    },
    "email": {
        "your email", "email", "e mail", "mail", "email address",
        "your email address", "from email", "correo", "contact email",
    },
    "phone": {
        "your phone", "phone", "phone number", "tel", "telephone", "mobile",
        "mobile number", "whatsapp", "whatsapp number", "contact number",
        "cell", "cellphone", "telefono",
    },
    "company": {
        "company", "company name", "organization", "organisation",
        "organization name", "organisation name", "business", "business name",
        "firm",
    },
    "subject": {
        "your subject", "subject", "topic", "service", "service required",
        "interested in", "enquiry type", "inquiry type", "reason",
    },
    "message": {
        "your message", "message", "comments", "comment", "details",
        "enquiry", "inquiry", "question", "notes", "description",
        "requirements", "your enquiry", "how can we help",
    },
    "page_url": {"page url", "source url", "form page", "url"},
}
# Looser word-level matches, tried only after the exact table misses. Matched on
# whole words so "seo" can never fire inside "Seoul".
_WORDS: list[tuple[str, str]] = [
    ("email", "email"), ("email", "e mail"),
    ("phone", "phone"), ("phone", "mobile"), ("phone", "whatsapp"), ("phone", "tel"),
    ("company", "company"), ("company", "organisation"), ("company", "organization"),
    ("company", "business"),
    ("name", "name"),
    ("message", "message"), ("message", "comments"), ("message", "enquiry"),
    ("message", "inquiry"), ("message", "details"),
    ("subject", "subject"), ("subject", "service"),
]
# The form builder's own declared type, used when the name is uninformative.
_BY_TYPE = {"email": "email", "tel": "phone", "textarea": "message", "url": "page_url"}

# Split-name pairs, joined into a single `name` when both are present.
_FIRST_NAME = {"first name", "firstname", "fname", "given name", "first"}
_LAST_NAME = {"last name", "lastname", "lname", "surname", "family name", "last"}


def normalize_key(name: str) -> str:
    """Reduce a raw field name to a comparable form.

    ``tel-123`` -> ``tel``; ``Your-Email[]`` -> ``your email``. The trailing
    number strip is what makes Contact Form 7's auto-numbered names (which
    change whenever a form is edited) match a stable dictionary.
    """
    text = (name or "").strip().lower()
    if text.endswith("[]"):
        text = text[:-2]
    text = _TRAILING_NUM_RE.sub("", text)
    text = re.sub(r"[-_.]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def _loose_key(name: str) -> str:
    """Punctuation-insensitive form, keeping any numbering intact.

    Used for matching a saved rule against a posted field. Unlike
    ``normalize_key`` it must NOT drop trailing digits — those are what tell
    ``menu-456`` and ``menu-789`` apart.
    """
    text = (name or "").strip().lower()
    if text.endswith("[]"):
        text = text[:-2]
    text = re.sub(r"[-_.]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def _has_word(haystack: str, needle: str) -> bool:
    return f" {needle} " in f" {haystack} "


def guess_target(
    name: str, label: str | None = None, field_type: str | None = None
) -> tuple[str | None, int]:
    """Best guess at where a field belongs, with a 0-100 confidence.

    Returns ``(None, 0)`` for anything ambiguous. That is deliberate: a bare
    ``text-874`` could be a name, a job title or a budget, and silently guessing
    wrong is worse than leaving it for the admin — which is what the mapping
    editor exists for.
    """
    norm = normalize_key(name)
    if not norm:
        return None, 0

    for target, names in _EXACT.items():
        if norm in names:
            return target, 100

    base = (field_type or "").rstrip("*").lower()
    if base in _BY_TYPE:
        return _BY_TYPE[base], 80

    for target, word in _WORDS:
        if _has_word(norm, word):
            return target, 60

    if label:
        lnorm = normalize_key(label)
        for target, names in _EXACT.items():
            if lnorm in names:
                return target, 55
        for target, word in _WORDS:
            if _has_word(lnorm, word):
                return target, 50

    return None, 0


def _entry_name(entry: Any) -> str:
    return (entry or {}).get("name", "") if isinstance(entry, dict) else str(entry)


def auto_mapping(fields: list[dict] | None) -> dict:
    """Build a starting mapping document from a discovered field catalogue.

    Deterministic and idempotent: the highest-confidence field wins each target,
    ties broken by the order the fields were discovered in.
    """
    entries = [f for f in (fields or []) if isinstance(f, dict) and f.get("name")]
    best: dict[str, tuple[int, int, str]] = {}  # target -> (confidence, -order, name)

    for order, entry in enumerate(entries):
        name = entry["name"]
        if name in _WP_INTERNAL:
            continue
        target, confidence = guess_target(
            name, entry.get("label"), entry.get("type") or entry.get("basetype")
        )
        if not target or confidence <= 0:
            continue
        candidate = (confidence, -order, name)
        if target not in best or candidate > best[target]:
            best[target] = candidate

    rules: list[dict] = []

    # A split first/last name pair beats any single guessed name field.
    first = next((e["name"] for e in entries if normalize_key(e["name"]) in _FIRST_NAME), None)
    last = next((e["name"] for e in entries if normalize_key(e["name"]) in _LAST_NAME), None)
    if first and last:
        rules.append({
            "sources": [first, last], "target": "name",
            "combine": "join", "join": " ", "transform": ["trim"],
        })
        best.pop("name", None)

    for target in TARGETS:
        if target in best:
            rules.append({
                "sources": [best[target][2]], "target": target,
                "combine": "first", "transform": ["trim"],
            })

    return {"version": 1, "rules": rules, "extras": "keep"}


def _scalar(value: Any, join: str = ", ") -> str | None:
    """Flatten any submitted value to a string, or None when it is empty."""
    if value is None or isinstance(value, bool):
        return None if value is None else ("yes" if value else "no")
    if isinstance(value, (list, tuple, set)):
        parts = [p for p in (_scalar(v, join) for v in value) if p]
        return join.join(parts) or None
    if isinstance(value, dict):
        parts = [f"{k}: {v}" for k, v in value.items() if v not in (None, "")]
        return join.join(parts) or None
    text = str(value).strip()
    return text or None


def transform_value(value: Any, ops: list[str] | None, join: str = ", ") -> str | None:
    """Apply an ordered transform chain to a single value."""
    text = _scalar(value, join)
    if text is None:
        return None
    for op in ops or []:
        if text is None:
            return None
        if op == "trim":
            text = text.strip()
        elif op == "lower":
            text = text.lower()
        elif op == "upper":
            text = text.upper()
        elif op == "title":
            text = text.title()
        elif op == "digits":
            plus = text.strip().startswith("+")
            digits = re.sub(r"\D", "", text)
            text = ("+" + digits) if (plus and digits) else digits
        elif op == "strip_html":
            text = _TAG_RE.sub(" ", text)
            text = re.sub(r"\s+", " ", text).strip()
        elif op == "join_array":
            continue  # arrays are already flattened by _scalar
        elif op == "first_line":
            text = text.splitlines()[0].strip() if text.splitlines() else text
        elif op == "email_only":
            found = _EMAIL_RE.search(text)
            text = found.group(0) if found else None
    return (text or None) if text is not None else None


def _clip(target: str, value: str | None) -> str | None:
    if value is None:
        return None
    limit = _LIMITS.get(target)
    return value[:limit] if limit else value


@dataclass
class MappedResult:
    """Outcome of running a mapping document over one submitted body."""

    core: dict[str, str | None] = field(default_factory=dict)
    extras: dict[str, Any] = field(default_factory=dict)
    labels: dict[str, str] = field(default_factory=dict)
    status: str = "none"
    notes: list[str] = field(default_factory=list)


def _resolve(data: dict, key: str) -> str | None:
    """Find the key in ``data`` a rule source refers to.

    An exact match always wins. Failing that we fall back to a
    punctuation-insensitive comparison, which absorbs hyphen/underscore drift
    between a saved mapping and what the site actually posts — but only when
    exactly one field matches, and never across differing field numbers.
    """
    if key in data:
        return key
    wanted = _loose_key(key)
    matches = [k for k in data if _loose_key(k) == wanted]
    return matches[0] if len(matches) == 1 else None


def apply_mapping(
    mapping: dict | None, data: dict | None, fields: list[dict] | None = None
) -> MappedResult:
    """Run a mapping document over a submitted body.

    Anything a rule does not claim stays in ``extras``; anything a rule claims
    for a core column is removed from ``extras`` so it is not stored twice. No
    input is ever discarded outright.
    """
    data = {k: v for k, v in (data or {}).items()}
    result = MappedResult()
    labels = {
        f["name"]: f.get("label") or f["name"]
        for f in (fields or []) if isinstance(f, dict) and f.get("name")
    }

    rules = list((mapping or {}).get("rules") or [])
    consumed: set[str] = set()

    for rule in rules:
        target = rule.get("target")
        if target not in TARGETS:
            continue
        sources = [s for s in (rule.get("sources") or []) if s]
        if not sources:
            continue
        combine = rule.get("combine") or "first"
        joiner = rule.get("join", " " if combine == "join" else ", ")
        ops = rule.get("transform") or []

        resolved = [_resolve(data, s) for s in sources]
        values = [
            transform_value(data.get(key), ops, joiner) if key else None
            for key in resolved
        ]
        present = [v for v in values if v]
        if combine == "join":
            value = joiner.join(present) or None
        else:
            value = next((v for v in present if v), None)

        if target == "extra":
            if rule.get("label"):
                for key in resolved:
                    if key:
                        labels[key] = rule["label"]
            continue
        if value is None or result.core.get(target):
            continue

        result.core[target] = _clip(target, value)
        # Only fields that actually contributed are removed from the extras;
        # anything a rule referenced but did not use stays visible.
        for key, contributed in zip(resolved, values):
            if key and contributed:
                consumed.add(key)

    # --- Salvage -----------------------------------------------------------
    # A brand-new form has no mapping at all. Rather than store a blank lead,
    # recover the obvious fields by shape and flag the result for review.
    leftovers = {
        k: v for k, v in data.items()
        if k not in consumed and k not in _WP_INTERNAL and not k.startswith("_wpcf7")
    }
    salvaged = False

    if not result.core.get("email"):
        for key, value in leftovers.items():
            text = _scalar(value)
            found = _EMAIL_RE.search(text) if text else None
            if found:
                result.core["email"] = _clip("email", found.group(0))
                consumed.add(key)
                salvaged = True
                result.notes.append(f"Email recovered from unmapped field '{key}'")
                break

    if not result.core.get("phone"):
        for key, value in leftovers.items():
            if key in consumed:
                continue
            text = _scalar(value)
            digits = re.sub(r"\D", "", text or "")
            if 7 <= len(digits) <= 15 and len(digits) >= len((text or "").strip()) - 6:
                result.core["phone"] = _clip("phone", (text or "").strip())
                consumed.add(key)
                salvaged = True
                result.notes.append(f"Phone recovered from unmapped field '{key}'")
                break

    if not result.core.get("message"):
        longest, longest_key = None, None
        for key, value in leftovers.items():
            if key in consumed:
                continue
            text = _scalar(value)
            if text and len(text) > 30 and (longest is None or len(text) > len(longest)):
                longest, longest_key = text, key
        if longest:
            result.core["message"] = longest
            consumed.add(longest_key)
            salvaged = True
            result.notes.append(f"Message recovered from unmapped field '{longest_key}'")

    if not result.core.get("name"):
        for key, value in leftovers.items():
            if key in consumed:
                continue
            if _has_word(normalize_key(labels.get(key, key)), "name"):
                text = _scalar(value)
                if text:
                    result.core["name"] = _clip("name", text)
                    consumed.add(key)
                    salvaged = True
                    result.notes.append(f"Name recovered from unmapped field '{key}'")
                    break

    result.extras = {
        k: v for k, v in data.items()
        if k not in consumed and k not in _WP_INTERNAL and not k.startswith("_wpcf7")
        and v not in (None, "", [], {})
    }
    result.labels = {k: labels.get(k, k) for k in result.extras}

    # Salvage means the mapping was incomplete, whether or not any rule ran —
    # so the form is flagged for review rather than reported as clean.
    if salvaged or (rules and not (result.core.get("email") or result.core.get("phone"))):
        result.status = "partial"
    elif not rules:
        result.status = "none"
    else:
        result.status = "mapped"
    return result


# ---- Field catalogue -----------------------------------------------------
def _mask_sample(name: str, value: Any) -> str | None:
    """A short, safe preview of a submitted value for the mapping editor.

    The admin needs to see that ``text-874`` holds a phone number, but the
    catalogue is long-lived config, not a place to accumulate contact details —
    so recognisable shapes are kept and the identifying parts are masked.
    """
    if _SENSITIVE_RE.search(name or ""):
        return None
    text = _scalar(value)
    if not text:
        return None
    found = _EMAIL_RE.search(text)
    if found:
        local, _, domain = found.group(0).partition("@")
        return f"{local[:1]}***@{domain}"[:120]
    digits = re.sub(r"\D", "", text)
    if len(digits) >= 7 and len(digits) >= len(text) - 6:
        return f"{text.strip()[:3]}•••{text.strip()[-2:]}"[:120]
    return text[:120]


def schema_hash(fields: list[dict] | None) -> str:
    """Digest of a form's field names, so an edited form is detectable."""
    names = sorted(_entry_name(f) for f in (fields or []))
    return hashlib.sha1("\n".join(names).encode()).hexdigest()


def merge_catalog(
    existing: list | None,
    schema_fields: list | None = None,
    data: dict | None = None,
    *,
    now: str | None = None,
) -> tuple[list[dict], bool]:
    """Fold a pushed field schema and an observed body into the catalogue.

    Returns the merged catalogue and whether anything changed, so a schema push
    that tells us nothing new does not churn the row.
    """
    catalog: dict[str, dict] = {}
    order: list[str] = []
    for entry in existing or []:
        if isinstance(entry, dict) and entry.get("name"):
            catalog[entry["name"]] = dict(entry)
            order.append(entry["name"])

    changed = False

    def _slot(name: str, origin: str) -> dict:
        nonlocal changed
        if name not in catalog:
            catalog[name] = {
                "name": name, "label": None, "type": None, "options": None,
                "required": False, "sample": None, "seen_count": 0,
                "first_seen": now, "last_seen": now, "origin": origin,
            }
            order.append(name)
            changed = True
        return catalog[name]

    for entry in schema_fields or []:
        if not isinstance(entry, dict) or not entry.get("name"):
            continue
        name = entry["name"]
        if name in _WP_INTERNAL:
            continue
        slot = _slot(name, "schema")
        for src, dst in (("label", "label"), ("basetype", "type"), ("type", "type"),
                         ("options", "options"), ("required", "required")):
            value = entry.get(src)
            if value in (None, "", []):
                continue
            if dst == "type" and src == "type" and entry.get("basetype"):
                continue  # basetype is the more stable of the two
            if slot.get(dst) != value:
                slot[dst] = value
                changed = True

    for name, value in (data or {}).items():
        if name in _WP_INTERNAL or name.startswith("_wpcf7"):
            continue
        slot = _slot(name, "observed")
        slot["seen_count"] = int(slot.get("seen_count") or 0) + 1
        slot["last_seen"] = now
        sample = _mask_sample(name, value)
        if sample and slot.get("sample") != sample:
            slot["sample"] = sample
        if isinstance(value, (list, tuple)) and slot.get("type") is None:
            slot["type"] = "checkbox"
        changed = True

    return [catalog[name] for name in order], changed
