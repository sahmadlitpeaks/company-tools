"""Inbound intake: a public endpoint websites post their forms to, plus a
triage inbox (list, assign, status) with conversion to CRM leads, recruiting
candidates or tickets.

Two request shapes are accepted on ``/ingest``. The original flat body (known
keys at the top level) still works exactly as it always did. The richer envelope
sent by the WordPress plugin carries the form's identity and its raw field
names, which is what allows per-form mapping — see
``app/services/intake_mapping.py``.
"""
import hashlib
import hmac
import json
import secrets
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_admin, get_current_user
from app.core.database import get_db
from app.models.crm import CrmLead
from app.models.intake import (
    SUBMISSION_STATUSES,
    SUBMISSION_TYPES,
    IntakeBlocklist,
    IntakeForm,
    IntakeRoutingRule,
    IntakeSource,
    Submission,
)
from app.models.user import User
from app.models.workplace import Ticket
from app.schemas.intake import (
    BlocklistCreate,
    BlocklistOut,
    FormDetailOut,
    FormFieldOut,
    FormOut,
    FormUpdate,
    IngestSchemaIn,
    IntakeSummary,
    MappingDoc,
    MappingPreviewIn,
    MappingPreviewItem,
    MappingPreviewOut,
    MappingTargetsOut,
    RemapIn,
    RemapOut,
    RoutingRuleCreate,
    RoutingRuleOut,
    RoutingRuleUpdate,
    RoutingTestIn,
    RoutingTestOut,
    SourceCreate,
    SourceOut,
    SourceUpdate,
    SubmissionOut,
    SubmissionUpdate,
)
from app.services import intake_routing
from app.services.activity import record
from app.services.app_settings import decrypt, encrypt
from app.services.intake_convert import make_candidate, make_lead
from app.services.intake_mapping import apply_mapping, auto_mapping, merge_catalog, schema_hash
from app.services.notify import notify_user
from app.services.people import user_labels
from app.services.spam import (
    content_hash,
    ip_rate_exceeded,
    learn_from_verdict,
    score_submission,
    screen,
)

# Token-authenticated ingest (WordPress etc. post here with the source token).
public_router = APIRouter(prefix="/intake", tags=["intake-public"])
# Authenticated management (gated by the `crm` module in main.py).
router = APIRouter(prefix="/intake", tags=["intake"])

_KNOWN = {"type", "name", "email", "phone", "company", "subject", "message", "page_url"}

# Safety rails for a public, unauthenticated-until-token endpoint.
MAX_BODY_BYTES = 256 * 1024
MAX_RAW_BYTES = 64 * 1024
MAX_FIELDS = 200
MAX_VALUE_CHARS = 8000
MAX_FORMS_PER_SOURCE = 100
# How far a signed request's timestamp may drift before it is treated as a replay.
DEFAULT_SIGNATURE_TTL = 300
# off = ignore any token, score = weigh the verdict, required = reject failures.
CAPTCHA_MODES = {"off", "score", "required"}


def _bearer_token(request: Request) -> str | None:
    """Extract the API token from Authorization: Bearer … or X-API-Key."""
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        return auth[7:].strip() or None
    return request.headers.get("x-api-key") or None


def _signing_secret(source: IntakeSource) -> str | None:
    """Secrets are stored encrypted; older rows may still be plaintext."""
    if not source.signing_secret:
        return None
    return decrypt(source.signing_secret) or source.signing_secret


def _verify_signature(request: Request, source: IntakeSource, raw: bytes) -> None:
    """Check the HMAC, and the timestamp when one is supplied.

    Signing ``"{timestamp}.{body}"`` means a captured request stops working once
    the window closes. The older body-only form is still accepted so existing
    integrations keep running, unless the source opts into requiring timestamps.
    """
    secret = _signing_secret(source)
    if not secret:
        return

    sig = request.headers.get("x-signature", "")
    if sig.startswith("sha256="):
        sig = sig[7:]
    if not sig:
        raise HTTPException(status_code=401, detail="Invalid signature")

    stamp = request.headers.get("x-timestamp", "").strip()
    if not stamp:
        if source.require_timestamp:
            raise HTTPException(status_code=401, detail="Invalid signature")
        expected = hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest()
        if not hmac.compare_digest(sig, expected):
            raise HTTPException(status_code=401, detail="Invalid signature")
        return

    try:
        sent_at = int(stamp)
    except ValueError:
        raise HTTPException(status_code=401, detail="Invalid signature")
    ttl = source.signature_ttl_sec if source.signature_ttl_sec is not None else DEFAULT_SIGNATURE_TTL
    if ttl and abs(int(datetime.now(timezone.utc).timestamp()) - sent_at) > ttl:
        raise HTTPException(status_code=401, detail="Signature expired")

    expected = hmac.new(secret.encode(), f"{stamp}.".encode() + raw, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(sig, expected):
        raise HTTPException(status_code=401, detail="Invalid signature")


def _clean_fields(data: dict | None) -> dict:
    """Bound an inbound field dict so one request cannot dominate the table."""
    out: dict = {}
    for key, value in list((data or {}).items())[:MAX_FIELDS]:
        if not isinstance(key, str):
            continue
        if isinstance(value, (list, tuple)):
            value = [str(v)[:MAX_VALUE_CHARS] for v in value][:50]
        elif isinstance(value, dict):
            value = {str(k)[:120]: str(v)[:MAX_VALUE_CHARS] for k, v in list(value.items())[:50]}
        elif value is not None and not isinstance(value, (str, int, float, bool)):
            value = str(value)[:MAX_VALUE_CHARS]
        elif isinstance(value, str):
            value = value[:MAX_VALUE_CHARS]
        out[key[:191]] = value
    return out


def _shrink_raw(body: dict) -> dict:
    """Keep the original body, but not without limit."""
    encoded = json.dumps(body, default=str)
    if len(encoded) <= MAX_RAW_BYTES:
        return body
    trimmed = {k: v for k, v in body.items() if k != "files"}
    encoded = json.dumps(trimmed, default=str)
    if len(encoded) > MAX_RAW_BYTES:
        return {"_truncated": True, "_bytes": len(encoded)}
    trimmed["_truncated"] = True
    return trimmed


async def _authenticate(request: Request, db: AsyncSession) -> IntakeSource:
    token = _bearer_token(request)
    if not token:
        raise HTTPException(status_code=401, detail="Missing API token")
    source = (
        await db.execute(
            select(IntakeSource).where(IntakeSource.key == token, IntakeSource.active.is_(True))
        )
    ).scalar_one_or_none()
    if not source:
        raise HTTPException(status_code=401, detail="Invalid or inactive API token")
    return source


def _parse_body(body: dict, source: IntakeSource) -> dict:
    """Normalise either request shape into one internal structure.

    The richer envelope is recognised by an explicit ``v`` or a ``form`` block —
    never by the presence of ``fields``, which the original flat shape already
    allowed. That keeps every existing integration on exactly its old path.
    """
    is_envelope = bool(body.get("v")) or isinstance(body.get("form"), dict)

    if is_envelope:
        form_block = body.get("form") or {}
        site = body.get("site") or {}
        meta = body.get("meta") or {}
        data = _clean_fields(body.get("fields") if isinstance(body.get("fields"), dict) else {})
        core_hint: dict = {}
        field_schema = form_block.get("fields")
        if not isinstance(field_schema, list):
            field_schema = None
    else:
        # Legacy flat body: known keys are the answer, everything else is extra.
        data = _clean_fields({k: v for k, v in body.items() if k not in _KNOWN and k != "fields"})
        if isinstance(body.get("fields"), dict):
            data.update(_clean_fields(body["fields"]))
        core_hint = {
            key: (body.get(key) or None)
            for key in ("name", "email", "phone", "company", "subject", "message", "page_url")
        }
        form_block, site, meta, field_schema = {}, {}, {}, None

    utm = meta.get("utm") if isinstance(meta.get("utm"), dict) else None
    elapsed = meta.get("elapsed_ms")
    try:
        elapsed = int(elapsed) if elapsed is not None else None
    except (TypeError, ValueError):
        elapsed = None

    declared_type = str(body.get("type") or "").lower().strip() or None
    return {
        "envelope": is_envelope,
        "data": data,
        "core_hint": {k: v for k, v in core_hint.items() if v},
        "declared_type": declared_type if declared_type in SUBMISSION_TYPES else None,
        "form_key": (form_block.get("key") or None),
        "form_name": (form_block.get("name") or None),
        "provider": (form_block.get("provider") or "cf7"),
        "field_schema": field_schema,
        "site_url": (site.get("url") or None),
        "page_url": (meta.get("page_url") or body.get("page_url") or None),
        "referrer": (meta.get("referrer") or None),
        "user_agent": (meta.get("user_agent") or None),
        "utm": utm,
        "external_id": (str(body.get("external_id"))[:128] if body.get("external_id") else None),
        "captcha_token": (meta.get("captcha_token") or None),
        "elapsed_ms": elapsed,
        "site_flagged": bool(meta.get("spam")),
        "files": body.get("files") if isinstance(body.get("files"), list) else None,
    }


async def _resolve_form(
    db: AsyncSession, source: IntakeSource, parsed: dict
) -> IntakeForm | None:
    """Find or register the form this submission came from, and keep its
    field catalogue current so the mapping editor has something to show."""
    form_key = parsed["form_key"]
    if not form_key:
        return None

    form = (
        await db.execute(
            select(IntakeForm).where(
                IntakeForm.source_id == source.id, IntakeForm.form_key == form_key
            )
        )
    ).scalar_one_or_none()

    if form is None:
        if not source.auto_create_forms:
            return None
        count = await db.scalar(
            select(func.count(IntakeForm.id)).where(IntakeForm.source_id == source.id)
        ) or 0
        if count >= MAX_FORMS_PER_SOURCE:
            return None
        form = IntakeForm(
            source_id=source.id,
            form_key=form_key,
            name=parsed["form_name"] or "Untitled form",
            provider=parsed["provider"] if parsed["provider"] in {"cf7", "gravity", "elementor", "wpforms", "other"} else "other",
            site_url=parsed["site_url"] or source.site_url,
        )
        db.add(form)

    now = datetime.now(timezone.utc).isoformat()
    catalog, changed = merge_catalog(
        form.fields, parsed["field_schema"], parsed["data"], now=now
    )
    if changed:
        form.fields = catalog
        form.schema_hash = schema_hash(catalog)
    if parsed["form_name"] and form.name != parsed["form_name"]:
        form.name = parsed["form_name"]
    if parsed["site_url"] and form.site_url != parsed["site_url"]:
        form.site_url = parsed["site_url"]

    # A form nobody has configured gets a best-effort mapping immediately, so
    # its very first submission still produces a usable record.
    if not (form.mapping or {}).get("rules"):
        form.mapping = auto_mapping(form.fields)
        form.mapping_status = "auto" if (form.mapping or {}).get("rules") else "none"

    await db.flush()
    return form


def _map_fields(parsed: dict, form: IntakeForm | None):
    """Run the form's mapping, then fall back to any legacy top-level values."""
    result = apply_mapping(
        getattr(form, "mapping", None), parsed["data"], getattr(form, "fields", None)
    )
    for key, value in parsed["core_hint"].items():
        if not result.core.get(key):
            result.core[key] = value
    if parsed["declared_type"]:
        result.core["type"] = parsed["declared_type"]
    return result


async def _auto_convert(db, sub, source, form, routing, files) -> None:
    """Create the downstream record this submission was routed to."""
    from app.services.webhooks import emit as emit_webhook

    destination = routing.destination or "crm_lead"

    if destination == "candidate":
        job_title = None
        if routing.job_from_field:
            raw = (sub.raw_payload or {}).get("fields") or {}
            value = raw.get(routing.job_from_field) if isinstance(raw, dict) else None
            job_title = ", ".join(value) if isinstance(value, list) else (value or None)
        candidate = await make_candidate(
            db, sub, source, form, job_id=routing.job_id, job_title=job_title, files=files,
        )
        await emit_webhook(db, "candidate.created", {
            "id": str(candidate.id), "name": candidate.name, "email": candidate.email,
            "source": source.name, "form": sub.form_name,
        })
        return

    if destination == "crm_lead":
        # Applications belong in the ATS, never in the sales pipeline — even if
        # a rule pointed them here by mistake.
        if sub.type == "job_application":
            return
        lead = await make_lead(db, sub, source, form)
        await emit_webhook(db, "lead.created", {
            "id": str(lead.id), "name": lead.name, "email": lead.email,
            "source": lead.source, "source_detail": lead.source_detail,
            "site": sub.site_url, "form": sub.form_name,
        })


@public_router.post("/ingest")
async def ingest(request: Request, db: AsyncSession = Depends(get_db)):
    """Accept a form submission from a connected system (e.g. WordPress).

    Authenticated by the source's API token in the `Authorization: Bearer <token>`
    or `X-API-Key` header. Common fields are mapped; the rest go to ``payload``.
    """
    source = await _authenticate(request, db)

    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > MAX_BODY_BYTES:
        raise HTTPException(status_code=413, detail="Payload too large")
    raw = await request.body()
    if len(raw) > MAX_BODY_BYTES:
        raise HTTPException(status_code=413, detail="Payload too large")

    _verify_signature(request, source, raw)

    ip = request.client.host if request.client else None
    if source.rate_limit_per_min and source.rate_limit_per_min > 0:
        since = datetime.now(timezone.utc) - timedelta(minutes=1)
        recent = await db.scalar(
            select(func.count(Submission.id)).where(
                Submission.source_id == source.id, Submission.created_at >= since
            )
        )
        if (recent or 0) >= source.rate_limit_per_min:
            raise HTTPException(status_code=429, detail="Rate limit exceeded")
    # A per-source limit cannot see one bot working across every site we run.
    if await ip_rate_exceeded(db, ip):
        raise HTTPException(status_code=429, detail="Rate limit exceeded")

    try:
        body = json.loads(raw) if raw else {}
    except Exception:
        body = dict(await request.form())
    if not isinstance(body, dict):
        raise HTTPException(status_code=422, detail="Expected a JSON object")

    parsed = _parse_body(body, source)
    form = await _resolve_form(db, source, parsed)
    mapped = _map_fields(parsed, form)

    routing = await intake_routing.resolve(
        db, source=source, form=form, core=mapped.core,
        raw=parsed["data"], page_url=parsed["page_url"],
    )
    sub_type = routing.type if routing.type in SUBMISSION_TYPES else source.default_type

    email = mapped.core.get("email")
    message = mapped.core.get("message")

    # An idempotency key from the plugin stops its retry queue duplicating work.
    if parsed["external_id"]:
        existing = (
            await db.execute(
                select(Submission).where(
                    Submission.source_id == source.id,
                    Submission.external_id == parsed["external_id"],
                )
            )
        ).scalar_one_or_none()
        if existing:
            return {
                "ok": True, "status": "duplicate", "deduped": True, "id": str(existing.id),
            }

    if source.dedup_window_min and source.dedup_window_min > 0 and (email or message):
        since = datetime.now(timezone.utc) - timedelta(minutes=source.dedup_window_min)
        dupe = await db.scalar(
            select(func.count(Submission.id)).where(
                Submission.source_id == source.id,
                Submission.created_at >= since,
                Submission.email == email,
                Submission.message == message,
            )
        )
        if dupe:
            return {"ok": True, "status": "duplicate", "deduped": True}

    digest = content_hash(mapped.core.get("subject"), message)
    verdict = await screen(
        db, source=source,
        name=mapped.core.get("name"), email=email, phone=mapped.core.get("phone"),
        subject=mapped.core.get("subject"), message=message,
        # Screened against the *raw* fields: a mapping rule must never be able
        # to hide a honeypot from the filter.
        payload=parsed["data"],
        ip=ip, digest=digest,
        captcha_token=parsed["captcha_token"], elapsed_ms=parsed["elapsed_ms"],
        site_flagged=parsed["site_flagged"],
    )
    if verdict.rejected:
        await db.commit()  # persist blocklist hit counters
        raise HTTPException(status_code=403, detail="Submission rejected")

    sub = Submission(
        source_id=source.id,
        type=sub_type,
        name=mapped.core.get("name"),
        email=email,
        phone=mapped.core.get("phone"),
        company=mapped.core.get("company"),
        subject=mapped.core.get("subject"),
        message=message,
        page_url=mapped.core.get("page_url") or parsed["page_url"],
        payload=mapped.extras or None,
        # Keep the untouched original: every other column is derived from it,
        # so a mapping can be corrected and re-applied later without loss.
        raw_payload=_shrink_raw(body),
        mapping_status=mapped.status,
        form_id=getattr(form, "id", None),
        form_key=parsed["form_key"],
        form_name=getattr(form, "name", None) or parsed["form_name"],
        site_url=(getattr(form, "site_url", None) or parsed["site_url"] or source.site_url),
        utm=parsed["utm"] or None,
        referrer=parsed["referrer"] or request.headers.get("referer"),
        user_agent=parsed["user_agent"] or request.headers.get("user-agent"),
        content_hash=digest,
        external_id=parsed["external_id"],
        assignee_id=routing.assignee_id,
        ip=ip,
    )
    sub.spam_score = verdict.score
    sub.spam_reasons = (verdict.reasons + mapped.notes) or None
    sub.status = verdict.status
    db.add(sub)
    if form is not None:
        form.submission_count = (form.submission_count or 0) + 1
        form.last_submission_at = datetime.now(timezone.utc)
    await db.flush()

    # Fan the new submission out to any subscribed webhooks (best-effort).
    from app.services.webhooks import emit as emit_webhook

    await emit_webhook(db, "submission.created", {
        "id": str(sub.id), "type": sub.type, "status": sub.status,
        "name": sub.name, "email": sub.email, "subject": sub.subject,
        "source": source.name, "form": sub.form_name, "site": sub.site_url,
        "mapping_status": sub.mapping_status, "spam_score": verdict.score,
    })

    if sub.status == "new" and routing.auto_convert:
        await _auto_convert(db, sub, source, form, routing, parsed["files"])

    # Notify only when it's a real (clean) submission — not quarantined/spam noise.
    if sub.status == "new":
        recipients = (
            [getattr(form, "notify_user_id", None) or source.notify_user_id]
            if (getattr(form, "notify_user_id", None) or source.notify_user_id)
            else (
                await db.execute(
                    select(User.id).where(User.is_admin.is_(True), User.status == "active")
                )
            ).scalars().all()
        )
        origin = " · ".join(filter(None, [source.name, sub.form_name]))
        for rid in recipients:
            if rid:
                await notify_user(
                    db, user_id=rid,
                    title=f"New {sub_type.replace('_', ' ')}: {sub.subject or sub.name or 'submission'}",
                    body=f"From {sub.name or sub.email or 'website'} via {origin}.",
                    link="/inbox", category="info",
                )
    await db.commit()
    return {
        "ok": True, "id": str(sub.id), "status": sub.status,
        "spam_score": verdict.score, "mapping_status": sub.mapping_status,
        "form_id": str(form.id) if form is not None else None,
    }


@public_router.get("/ingest/ping")
async def ingest_ping(request: Request, db: AsyncSession = Depends(get_db)):
    """Connectivity check for the plugin's "Test connection" button.

    Returns only what the key-holder already knows about its own site — never
    another source's details, and never a secret.
    """
    source = await _authenticate(request, db)
    return {
        "ok": True,
        "site_name": source.name,
        "signing_required": bool(source.signing_secret),
        "timestamp_required": bool(source.require_timestamp),
        "captcha_mode": source.captcha_mode,
    }


@public_router.post("/ingest/schema")
async def ingest_schema(
    payload: IngestSchemaIn, request: Request, db: AsyncSession = Depends(get_db)
):
    """Register a form's field definitions without a submission.

    The plugin calls this when a site owner saves a form, so the mapping can be
    reviewed and corrected *before* the first real enquiry arrives rather than
    after one has already been mangled.
    """
    source = await _authenticate(request, db)
    raw = await request.body()
    _verify_signature(request, source, raw)

    parsed = _parse_body(
        {"v": 2, "form": payload.form, "site": payload.site or {}, "fields": {}}, source
    )
    if not parsed["form_key"]:
        raise HTTPException(status_code=422, detail="A form key is required")

    form = await _resolve_form(db, source, parsed)
    if form is None:
        raise HTTPException(status_code=422, detail="Form could not be registered")
    await db.commit()
    return {
        "ok": True,
        "form_id": str(form.id),
        "fields": len(form.fields or []),
        "mapping_status": form.mapping_status,
    }


# ---- Sources -------------------------------------------------------------
async def _source_out(db: AsyncSession, s: IntakeSource) -> SourceOut:
    out = SourceOut.model_validate(s)
    out.has_signing_secret = bool(s.signing_secret)
    out.submission_count = (
        await db.scalar(select(func.count(Submission.id)).where(Submission.source_id == s.id))
    ) or 0
    out.form_count = (
        await db.scalar(select(func.count(IntakeForm.id)).where(IntakeForm.source_id == s.id))
    ) or 0
    return out


@router.get("/sources", response_model=list[SourceOut])
async def list_sources(db: AsyncSession = Depends(get_db), _: User = Depends(get_current_admin)):
    rows = (await db.execute(select(IntakeSource).order_by(IntakeSource.name))).scalars().all()
    return [await _source_out(db, s) for s in rows]


@router.post("/sources", response_model=SourceOut, status_code=201)
async def create_source(
    payload: SourceCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_admin),
):
    if not payload.name.strip():
        raise HTTPException(status_code=422, detail="Name is required")
    if payload.default_type not in SUBMISSION_TYPES:
        raise HTTPException(status_code=422, detail="Invalid default type")
    if payload.captcha_mode not in CAPTCHA_MODES:
        raise HTTPException(status_code=422, detail="Invalid captcha mode")
    s = IntakeSource(
        name=payload.name.strip(),
        key=secrets.token_urlsafe(18),
        default_type=payload.default_type,
        auto_convert=payload.auto_convert,
        notify_user_id=payload.notify_user_id,
        rate_limit_per_min=payload.rate_limit_per_min,
        dedup_window_min=payload.dedup_window_min,
        spam_threshold=payload.spam_threshold,
        clean_threshold=payload.clean_threshold,
        site_url=payload.site_url,
        signature_ttl_sec=payload.signature_ttl_sec,
        require_timestamp=payload.require_timestamp,
        auto_create_forms=payload.auto_create_forms,
        captcha_mode=payload.captcha_mode,
    )
    db.add(s)
    await db.commit()
    await db.refresh(s)
    return await _source_out(db, s)


@router.patch("/sources/{source_id}", response_model=SourceOut)
async def update_source(
    source_id: uuid.UUID,
    payload: SourceUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    s = await db.get(IntakeSource, source_id)
    if not s:
        raise HTTPException(status_code=404, detail="Source not found")
    data = payload.model_dump(exclude_unset=True)
    if "default_type" in data and data["default_type"] not in SUBMISSION_TYPES:
        raise HTTPException(status_code=422, detail="Invalid default type")
    if "captcha_mode" in data and data["captcha_mode"] not in CAPTCHA_MODES:
        raise HTTPException(status_code=422, detail="Invalid captcha mode")
    for f, v in data.items():
        setattr(s, f, v)
    await db.commit()
    await db.refresh(s)
    return await _source_out(db, s)


@router.post("/sources/{source_id}/rotate-key", response_model=SourceOut)
async def rotate_key(
    source_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    s = await db.get(IntakeSource, source_id)
    if not s:
        raise HTTPException(status_code=404, detail="Source not found")
    s.key = secrets.token_urlsafe(18)
    await db.commit()
    await db.refresh(s)
    return await _source_out(db, s)


@router.post("/sources/{source_id}/signing-secret")
async def rotate_signing_secret(
    source_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    """Generate (or clear) the HMAC signing secret. Returned only once here."""
    s = await db.get(IntakeSource, source_id)
    if not s:
        raise HTTPException(status_code=404, detail="Source not found")
    secret = secrets.token_urlsafe(24)
    # Encrypted at rest: this is the one credential that is never displayed
    # again, so there is no reason for it to sit readable in the database.
    s.signing_secret = encrypt(secret)
    await db.commit()
    return {"signing_secret": secret}


@router.delete("/sources/{source_id}/signing-secret", status_code=204)
async def clear_signing_secret(
    source_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    s = await db.get(IntakeSource, source_id)
    if s:
        s.signing_secret = None
        await db.commit()


@router.delete("/sources/{source_id}", status_code=204)
async def delete_source(
    source_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    s = await db.get(IntakeSource, source_id)
    if s:
        await db.delete(s)
        await db.commit()


# ---- Submissions ---------------------------------------------------------
async def _serialize(db: AsyncSession, subs: list[Submission]) -> list[SubmissionOut]:
    src_ids = {s.source_id for s in subs if s.source_id}
    sources = {}
    if src_ids:
        rows = (await db.execute(select(IntakeSource.id, IntakeSource.name).where(IntakeSource.id.in_(src_ids)))).all()
        sources = {r[0]: r[1] for r in rows}
    names = await user_labels(db, {s.assignee_id for s in subs if s.assignee_id})

    # Human labels live on the form, not the submission, so renaming a field
    # retro-fixes every past submission without touching a single row.
    form_ids = {s.form_id for s in subs if s.form_id}
    catalogs: dict = {}
    if form_ids:
        for form in (
            await db.execute(select(IntakeForm).where(IntakeForm.id.in_(form_ids)))
        ).scalars().all():
            catalogs[form.id] = {
                f["name"]: f.get("label") or f["name"]
                for f in (form.fields or []) if isinstance(f, dict) and f.get("name")
            }

    out = []
    for s in subs:
        item = SubmissionOut.model_validate(s)
        item.source_name = sources.get(s.source_id) if s.source_id else None
        item.assignee_name = (names.get(s.assignee_id) or {}).get("name") if s.assignee_id else None
        labels = catalogs.get(s.form_id) or {}
        item.field_labels = {
            k: labels.get(k, k) for k in (s.payload or {})
        } or None
        out.append(item)
    return out


@router.get("/submissions", response_model=list[SubmissionOut])
async def list_submissions(
    status: str | None = None,
    type: str | None = None,
    source_id: uuid.UUID | None = None,
    q: str | None = None,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    stmt = select(Submission).order_by(Submission.created_at.desc())
    if status:
        stmt = stmt.where(Submission.status == status)
    if type:
        stmt = stmt.where(Submission.type == type)
    if source_id:
        stmt = stmt.where(Submission.source_id == source_id)
    if q:
        like = f"%{q}%"
        stmt = stmt.where(
            Submission.name.ilike(like) | Submission.email.ilike(like)
            | Submission.subject.ilike(like) | Submission.message.ilike(like)
        )
    subs = (await db.execute(stmt.limit(500))).scalars().all()
    return await _serialize(db, subs)


@router.get("/summary", response_model=IntakeSummary)
async def summary(db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)):
    rows = (await db.execute(select(Submission.status, func.count()).group_by(Submission.status))).all()
    by_status = {r[0]: int(r[1]) for r in rows}
    trows = (await db.execute(select(Submission.type, func.count()).group_by(Submission.type))).all()
    return IntakeSummary(new=by_status.get("new", 0), by_status=by_status, by_type={r[0]: int(r[1]) for r in trows})


@router.get("/submissions/{sub_id}", response_model=SubmissionOut)
async def get_submission(
    sub_id: uuid.UUID, db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)
):
    sub = await db.get(Submission, sub_id)
    if not sub:
        raise HTTPException(status_code=404, detail="Not found")
    return (await _serialize(db, [sub]))[0]


@router.patch("/submissions/{sub_id}", response_model=SubmissionOut)
async def update_submission(
    sub_id: uuid.UUID,
    payload: SubmissionUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    sub = await db.get(Submission, sub_id)
    if not sub:
        raise HTTPException(status_code=404, detail="Not found")
    data = payload.model_dump(exclude_unset=True)
    if "status" in data and data["status"] not in SUBMISSION_STATUSES:
        raise HTTPException(status_code=422, detail="Invalid status")
    if "type" in data and data["type"] not in SUBMISSION_TYPES:
        raise HTTPException(status_code=422, detail="Invalid type")
    for f, v in data.items():
        setattr(sub, f, v)
    await db.commit()
    return (await _serialize(db, [sub]))[0]


@router.delete("/submissions/{sub_id}", status_code=204)
async def delete_submission(
    sub_id: uuid.UUID, db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)
):
    sub = await db.get(Submission, sub_id)
    if sub:
        await db.delete(sub)
        await db.commit()


async def _form_of(db: AsyncSession, sub: Submission) -> IntakeForm | None:
    return await db.get(IntakeForm, sub.form_id) if sub.form_id else None


@router.post("/submissions/{sub_id}/release", response_model=SubmissionOut)
async def release(
    sub_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Approve a quarantined/spam submission as a real one (-> status `new`)."""
    sub = await db.get(Submission, sub_id)
    if not sub:
        raise HTTPException(status_code=404, detail="Not found")
    sub.status = "new"
    # This is a human saying "that was real" — the most reliable training
    # signal the filter ever gets, so record it.
    await learn_from_verdict(db, sub, is_spam=False)
    record(db, user=user, action="updated", entity_type="submission", entity_id=sub.id,
           summary="Released submission from quarantine")
    await db.commit()
    return (await _serialize(db, [sub]))[0]


@router.post("/submissions/{sub_id}/mark-spam", response_model=SubmissionOut)
async def mark_spam(
    sub_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Confirm a submission is junk, and teach the filter from it."""
    sub = await db.get(Submission, sub_id)
    if not sub:
        raise HTTPException(status_code=404, detail="Not found")
    sub.status = "spam"
    await learn_from_verdict(db, sub, is_spam=True)
    record(db, user=user, action="updated", entity_type="submission", entity_id=sub.id,
           summary="Marked submission as spam")
    await db.commit()
    return (await _serialize(db, [sub]))[0]


@router.post("/submissions/{sub_id}/convert-lead", response_model=SubmissionOut)
async def convert_lead(
    sub_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    sub = await db.get(Submission, sub_id)
    if not sub:
        raise HTTPException(status_code=404, detail="Not found")
    if sub.converted_lead_id:
        raise HTTPException(status_code=409, detail="Already converted to a lead")
    if sub.type == "job_application":
        raise HTTPException(
            status_code=422,
            detail="Job applications convert to candidates, not CRM leads",
        )
    src = await db.get(IntakeSource, sub.source_id) if sub.source_id else None
    lead = await make_lead(db, sub, src, await _form_of(db, sub))
    if sub.status in ("new", "quarantined"):
        sub.status = "in_progress"
    record(db, user=user, action="created", entity_type="crm_lead", entity_id=lead.id,
           summary="Converted submission to CRM lead")
    await db.commit()
    return (await _serialize(db, [sub]))[0]


@router.post("/submissions/{sub_id}/convert-candidate", response_model=SubmissionOut)
async def convert_candidate(
    sub_id: uuid.UUID,
    job_id: uuid.UUID | None = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Move a website application into the ATS.

    Requires the recruiting module rather than CRM: applicant records and CVs
    are deliberately not visible to the sales side.
    """
    if not (user.is_admin or "recruiting" in user.effective_permissions):
        raise HTTPException(status_code=403, detail="You don't have access to this area")
    sub = await db.get(Submission, sub_id)
    if not sub:
        raise HTTPException(status_code=404, detail="Not found")
    if sub.converted_candidate_id:
        raise HTTPException(status_code=409, detail="Already converted to a candidate")
    src = await db.get(IntakeSource, sub.source_id) if sub.source_id else None
    form = await _form_of(db, sub)
    files = (sub.raw_payload or {}).get("files")
    candidate = await make_candidate(
        db, sub, src, form,
        job_id=job_id or getattr(form, "job_id", None),
        files=files if isinstance(files, list) else None,
    )
    if sub.status in ("new", "quarantined"):
        sub.status = "in_progress"
    record(db, user=user, action="created", entity_type="candidate", entity_id=candidate.id,
           summary="Converted submission to recruiting candidate")
    await db.commit()
    return (await _serialize(db, [sub]))[0]


@router.post("/submissions/{sub_id}/convert-ticket", response_model=SubmissionOut)
async def convert_ticket(
    sub_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    sub = await db.get(Submission, sub_id)
    if not sub:
        raise HTTPException(status_code=404, detail="Not found")
    if sub.converted_ticket_id:
        raise HTTPException(status_code=409, detail="Already converted to a ticket")
    next_no = ((await db.scalar(select(func.max(Ticket.number)))) or 0) + 1
    ticket = Ticket(
        number=next_no,
        subject=sub.subject or f"{sub.type.title()} from {sub.name or sub.email or 'website'}",
        description="\n".join(filter(None, [sub.message, f"(from {sub.email or ''})"])) or None,
        category="other",
        status="open",
        assignee_id=sub.assignee_id,
    )
    db.add(ticket)
    await db.flush()
    sub.converted_ticket_id = ticket.id
    if sub.status == "new":
        sub.status = "in_progress"
    record(db, user=user, action="created", entity_type="ticket", entity_id=ticket.id,
           summary="Converted submission to ticket")
    await db.commit()
    return (await _serialize(db, [sub]))[0]


# ---- Forms and field mapping ---------------------------------------------
def _unmapped_targets(mapping: dict | None) -> list[str]:
    """Core columns no rule feeds — what the editor warns about."""
    covered = {r.get("target") for r in ((mapping or {}).get("rules") or [])}
    return [t for t in ("name", "email", "phone", "message") if t not in covered]


async def _form_out(db: AsyncSession, form: IntakeForm, *, detail: bool = False):
    out = (FormDetailOut if detail else FormOut).model_validate(form)
    out.field_count = len(form.fields or [])
    src = await db.get(IntakeSource, form.source_id) if form.source_id else None
    out.source_name = src.name if src else None
    if detail:
        out.fields = [FormFieldOut(**{
            "name": f.get("name"), "label": f.get("label"), "type": f.get("type"),
            "options": f.get("options") if isinstance(f.get("options"), list) else None,
            "required": bool(f.get("required")), "sample": f.get("sample"),
            "seen_count": int(f.get("seen_count") or 0), "origin": f.get("origin"),
        }) for f in (form.fields or []) if isinstance(f, dict) and f.get("name")]
        out.mapping = MappingDoc.model_validate(form.mapping) if form.mapping else None
        out.unmapped_targets = _unmapped_targets(form.mapping)
    return out


@router.get("/targets", response_model=MappingTargetsOut)
async def mapping_targets(_: User = Depends(get_current_user)):
    """Vocabulary for the mapping and routing editors."""
    return MappingTargetsOut()


@router.get("/forms", response_model=list[FormOut])
async def list_forms(
    source_id: uuid.UUID | None = None,
    needs_review: bool = False,
    q: str | None = None,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    stmt = select(IntakeForm).order_by(IntakeForm.last_submission_at.desc().nullslast())
    if source_id:
        stmt = stmt.where(IntakeForm.source_id == source_id)
    if needs_review:
        stmt = stmt.where(IntakeForm.mapping_status.in_(("none", "auto", "partial")))
    if q:
        like = f"%{q}%"
        stmt = stmt.where(IntakeForm.name.ilike(like) | IntakeForm.form_key.ilike(like))
    rows = (await db.execute(stmt.limit(500))).scalars().all()
    return [await _form_out(db, f) for f in rows]


@router.get("/forms/{form_id}", response_model=FormDetailOut)
async def get_form(
    form_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    form = await db.get(IntakeForm, form_id)
    if not form:
        raise HTTPException(status_code=404, detail="Form not found")
    return await _form_out(db, form, detail=True)


@router.patch("/forms/{form_id}", response_model=FormDetailOut)
async def update_form(
    form_id: uuid.UUID,
    payload: FormUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_admin),
):
    form = await db.get(IntakeForm, form_id)
    if not form:
        raise HTTPException(status_code=404, detail="Form not found")
    for f, v in payload.model_dump(exclude_unset=True).items():
        setattr(form, f, v)
    record(db, user=user, action="updated", entity_type="intake_form", entity_id=form.id,
           summary=f"Updated web form '{form.name}'")
    await db.commit()
    await db.refresh(form)
    return await _form_out(db, form, detail=True)


@router.put("/forms/{form_id}/mapping", response_model=FormDetailOut)
async def put_mapping(
    form_id: uuid.UUID,
    payload: MappingDoc,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_admin),
):
    """Save a human-authored mapping. This is what promotes a form off `auto`."""
    form = await db.get(IntakeForm, form_id)
    if not form:
        raise HTTPException(status_code=404, detail="Form not found")
    form.mapping = payload.model_dump()
    form.mapping_status = "mapped" if payload.rules else "none"
    record(db, user=user, action="updated", entity_type="intake_form", entity_id=form.id,
           summary=f"Saved field mapping for '{form.name}'")
    await db.commit()
    await db.refresh(form)
    return await _form_out(db, form, detail=True)


@router.post("/forms/{form_id}/auto-map", response_model=FormDetailOut)
async def auto_map(
    form_id: uuid.UUID,
    save: bool = False,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    """Re-run the guesser over the discovered fields."""
    form = await db.get(IntakeForm, form_id)
    if not form:
        raise HTTPException(status_code=404, detail="Form not found")
    guessed = auto_mapping(form.fields)
    if save:
        form.mapping = guessed
        form.mapping_status = "auto" if guessed.get("rules") else "none"
        await db.commit()
        await db.refresh(form)
        return await _form_out(db, form, detail=True)
    out = await _form_out(db, form, detail=True)
    out.mapping = MappingDoc.model_validate(guessed)
    out.unmapped_targets = _unmapped_targets(guessed)
    return out


def _raw_fields(sub: Submission) -> dict:
    """The submitted fields as they arrived, for re-running a mapping."""
    raw = sub.raw_payload or {}
    inner = raw.get("fields")
    if isinstance(inner, dict):
        return inner
    return {k: v for k, v in raw.items() if k not in _KNOWN and k not in ("v", "form", "site", "meta", "files", "external_id", "type")}


@router.post("/forms/{form_id}/preview-mapping", response_model=MappingPreviewOut)
async def preview_mapping(
    form_id: uuid.UUID,
    payload: MappingPreviewIn,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    """Show what a candidate mapping would produce. Writes nothing."""
    form = await db.get(IntakeForm, form_id)
    if not form:
        raise HTTPException(status_code=404, detail="Form not found")
    mapping = payload.mapping.model_dump() if payload.mapping else form.mapping

    if payload.sample is not None:
        samples = [(None, None, payload.sample)]
    elif payload.submission_id:
        sub = await db.get(Submission, payload.submission_id)
        if not sub:
            raise HTTPException(status_code=404, detail="Submission not found")
        samples = [(sub.id, sub.created_at, _raw_fields(sub))]
    else:
        rows = (
            await db.execute(
                select(Submission)
                .where(Submission.form_id == form.id, Submission.raw_payload.isnot(None))
                .order_by(Submission.created_at.desc())
                .limit(max(1, min(payload.limit, 10)))
            )
        ).scalars().all()
        samples = [(s.id, s.created_at, _raw_fields(s)) for s in rows]

    items = []
    for sub_id, created, data in samples:
        result = apply_mapping(mapping, data, form.fields)
        score, reasons = score_submission(
            name=result.core.get("name"), email=result.core.get("email"),
            phone=result.core.get("phone"), subject=result.core.get("subject"),
            message=result.core.get("message"), payload=data,
        )
        items.append(MappingPreviewItem(
            submission_id=sub_id, received_at=created, core=result.core,
            extras=result.extras, labels=result.labels, status=result.status,
            notes=result.notes, spam_score=score, spam_reasons=reasons,
        ))
    return MappingPreviewOut(items=items, unmapped_targets=_unmapped_targets(mapping))


@router.post("/forms/{form_id}/remap", response_model=RemapOut)
async def remap(
    form_id: uuid.UUID,
    payload: RemapIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_admin),
):
    """Re-apply the saved mapping to submissions already received.

    Only the mapped columns move. Triage state — status, assignee, whether it
    was converted — is a human's work and is never overwritten.
    """
    form = await db.get(IntakeForm, form_id)
    if not form:
        raise HTTPException(status_code=404, detail="Form not found")

    stmt = (
        select(Submission)
        .where(Submission.form_id == form.id)
        .order_by(Submission.created_at.desc())
        .limit(max(1, min(payload.limit, 2000)))
    )
    if payload.only_unconverted:
        stmt = stmt.where(
            Submission.converted_lead_id.is_(None),
            Submission.converted_candidate_id.is_(None),
        )
    rows = (await db.execute(stmt)).scalars().all()

    out = RemapOut(dry_run=payload.dry_run)
    for sub in rows:
        out.examined += 1
        if not sub.raw_payload:
            out.skipped_no_raw += 1
            continue
        result = apply_mapping(form.mapping, _raw_fields(sub), form.fields)
        changes = {
            "name": result.core.get("name"), "email": result.core.get("email"),
            "phone": result.core.get("phone"), "company": result.core.get("company"),
            "subject": result.core.get("subject"), "message": result.core.get("message"),
        }
        if all(getattr(sub, k) == v for k, v in changes.items()) and sub.mapping_status == result.status:
            continue
        out.updated += 1
        if payload.dry_run:
            continue
        for key, value in changes.items():
            setattr(sub, key, value)
        sub.payload = result.extras or None
        sub.mapping_status = result.status
        if payload.resync_leads and sub.converted_lead_id:
            lead = await db.get(CrmLead, sub.converted_lead_id)
            if lead:
                lead.name, lead.email = sub.name, sub.email
                lead.phone, lead.company = sub.phone, sub.company
                out.leads_updated += 1

    if payload.dry_run:
        await db.rollback()
        return out
    record(db, user=user, action="updated", entity_type="intake_form", entity_id=form.id,
           summary=f"Re-applied mapping to {out.updated} submission(s) of '{form.name}'")
    await db.commit()
    return out


@router.delete("/forms/{form_id}", status_code=204)
async def delete_form(
    form_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    form = await db.get(IntakeForm, form_id)
    if form:
        await db.delete(form)
        await db.commit()


@router.post("/submissions/{sub_id}/remap", response_model=SubmissionOut)
async def remap_submission(
    sub_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    sub = await db.get(Submission, sub_id)
    if not sub:
        raise HTTPException(status_code=404, detail="Not found")
    if not sub.raw_payload:
        raise HTTPException(status_code=422, detail="No original payload stored for this submission")
    form = await _form_of(db, sub)
    result = apply_mapping(getattr(form, "mapping", None), _raw_fields(sub), getattr(form, "fields", None))
    for key in ("name", "email", "phone", "company", "subject", "message"):
        setattr(sub, key, result.core.get(key))
    sub.payload = result.extras or None
    sub.mapping_status = result.status
    await db.commit()
    return (await _serialize(db, [sub]))[0]


@router.post("/submissions/{sub_id}/sync-lead", response_model=SubmissionOut)
async def sync_lead(
    sub_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Refresh a converted lead's contact details from its submission.

    Human-owned fields — status, owner, value — are left alone; this only
    repairs the data that came off a mapping.
    """
    sub = await db.get(Submission, sub_id)
    if not sub:
        raise HTTPException(status_code=404, detail="Not found")
    if not sub.converted_lead_id:
        raise HTTPException(status_code=409, detail="This submission has no linked lead")
    lead = await db.get(CrmLead, sub.converted_lead_id)
    if not lead:
        raise HTTPException(status_code=404, detail="Linked lead no longer exists")
    form = await _form_of(db, sub)
    lead.name, lead.email, lead.phone = sub.name, sub.email, sub.phone
    lead.company, lead.page_url = sub.company, sub.page_url
    if form is not None:
        lead.intake_form_id = form.id
    if not lead.notes:
        lead.notes = "\n".join(filter(None, [sub.subject, sub.message])) or None
    record(db, user=user, action="updated", entity_type="crm_lead", entity_id=lead.id,
           summary="Re-synced lead from its website submission")
    await db.commit()
    return (await _serialize(db, [sub]))[0]


# ---- Routing rules -------------------------------------------------------
@router.get("/routing-rules", response_model=list[RoutingRuleOut])
async def list_rules(
    db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)
):
    rows = (
        await db.execute(
            select(IntakeRoutingRule).order_by(
                IntakeRoutingRule.priority, IntakeRoutingRule.created_at
            )
        )
    ).scalars().all()
    return rows


@router.post("/routing-rules", response_model=RoutingRuleOut, status_code=201)
async def create_rule(
    payload: RoutingRuleCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_admin),
):
    if not payload.conditions:
        raise HTTPException(
            status_code=422,
            detail="A rule needs at least one condition, or it would match everything",
        )
    rule = IntakeRoutingRule(
        name=payload.name.strip() or "Untitled rule",
        source_id=payload.source_id,
        form_id=payload.form_id,
        priority=payload.priority,
        active=payload.active,
        conditions=[c.model_dump() for c in payload.conditions],
        outcome=payload.outcome.model_dump(mode="json", exclude_none=True),
    )
    db.add(rule)
    record(db, user=user, action="created", entity_type="intake_rule", entity_id=rule.id,
           summary=f"Created routing rule '{rule.name}'")
    await db.commit()
    await db.refresh(rule)
    return rule


@router.patch("/routing-rules/{rule_id}", response_model=RoutingRuleOut)
async def update_rule(
    rule_id: uuid.UUID,
    payload: RoutingRuleUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    rule = await db.get(IntakeRoutingRule, rule_id)
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")
    data = payload.model_dump(exclude_unset=True, mode="json", exclude_none=True)
    if "conditions" in data and not data["conditions"]:
        raise HTTPException(status_code=422, detail="A rule needs at least one condition")
    for f, v in data.items():
        setattr(rule, f, v)
    await db.commit()
    await db.refresh(rule)
    return rule


@router.delete("/routing-rules/{rule_id}", status_code=204)
async def delete_rule(
    rule_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    rule = await db.get(IntakeRoutingRule, rule_id)
    if rule:
        await db.delete(rule)
        await db.commit()


@router.post("/routing-rules/test", response_model=RoutingTestOut)
async def test_rules(
    payload: RoutingTestIn,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    """Show which rule a past submission would hit under the current set."""
    sub = await db.get(Submission, payload.submission_id)
    if not sub:
        raise HTTPException(status_code=404, detail="Submission not found")
    source = await db.get(IntakeSource, sub.source_id) if sub.source_id else None
    form = await _form_of(db, sub)
    core = {
        "name": sub.name, "email": sub.email, "phone": sub.phone,
        "company": sub.company, "subject": sub.subject, "message": sub.message,
        "page_url": sub.page_url, "type": sub.type,
    }
    routing = await intake_routing.resolve(
        db, source=source, form=form, core=core,
        raw=_raw_fields(sub), page_url=sub.page_url,
    )
    # Evaluating rules bumps their match counters; a test must not.
    await db.rollback()
    return RoutingTestOut(
        rule_id=routing.rule_id, rule_name=routing.rule_name,
        type=routing.type, destination=routing.destination, job_id=routing.job_id,
    )


# ---- Blocklist -----------------------------------------------------------
@router.get("/blocklist", response_model=list[BlocklistOut])
async def list_blocklist(
    db: AsyncSession = Depends(get_db), _: User = Depends(get_current_admin)
):
    rows = (
        await db.execute(
            select(IntakeBlocklist).order_by(IntakeBlocklist.created_at.desc()).limit(500)
        )
    ).scalars().all()
    return rows


@router.post("/blocklist", response_model=BlocklistOut, status_code=201)
async def create_blocklist_entry(
    payload: BlocklistCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_admin),
):
    entry = IntakeBlocklist(
        kind=payload.kind,
        value=payload.value.lower(),
        action=payload.action,
        reason=payload.reason,
        source_id=payload.source_id,
        expires_at=payload.expires_at,
        created_by_id=user.id,
    )
    db.add(entry)
    record(db, user=user, action="created", entity_type="intake_blocklist", entity_id=entry.id,
           summary=f"Blocklist {payload.action}: {payload.kind} {payload.value}")
    await db.commit()
    await db.refresh(entry)
    return entry


@router.delete("/blocklist/{entry_id}", status_code=204)
async def delete_blocklist_entry(
    entry_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    entry = await db.get(IntakeBlocklist, entry_id)
    if entry:
        await db.delete(entry)
        await db.commit()
