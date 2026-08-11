"""Turn a screened submission into the record it actually belongs in.

A sales enquiry becomes a CRM lead; a job application becomes a candidate in the
ATS. Keeping applicants out of the sales pipeline is not tidiness — the
recruiting module is deliberately excluded from manager defaults, so routing an
application there is also what keeps CVs away from the sales team.
"""
import base64
import binascii
import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.crm import CrmLead
from app.models.recruiting import Candidate, CandidateActivity, JobOpening
from app.services.storage import save_bytes

# A résumé is a document, not a media library. Anything larger is almost
# certainly a mistake, and this endpoint is public.
MAX_FILE_BYTES = 10 * 1024 * 1024
GENERAL_OPENING_TITLE = "General Applications"


def _labelled_fields(extras: dict | None, labels: dict | None) -> list[dict] | None:
    """Flatten leftover form fields into a display-ready list."""
    if not extras:
        return None
    labels = labels or {}
    out = []
    for key, value in extras.items():
        if isinstance(value, (list, tuple)):
            value = ", ".join(str(v) for v in value if v not in (None, ""))
        out.append({"key": key, "label": labels.get(key, key), "value": str(value)[:2000]})
    return out or None


def _notes_block(sub, extras: dict | None, labels: dict | None) -> str | None:
    """Message plus any unmapped fields, so nothing is invisible in the UI."""
    parts = [p for p in (sub.subject, sub.message) if p]
    for item in _labelled_fields(extras, labels) or []:
        parts.append(f"{item['label']}: {item['value']}")
    return "\n".join(parts) or None


def source_detail(source, form) -> str | None:
    names = [getattr(source, "name", None), getattr(form, "name", None)]
    label = " · ".join(n for n in names if n)
    return label[:255] or None


async def make_lead(db: AsyncSession, sub, source=None, form=None) -> CrmLead:
    """Create a CRM lead from a submission, carrying its provenance across."""
    extras = sub.payload or {}
    labels = (getattr(form, "fields", None) or [])
    label_map = {
        f["name"]: f.get("label") or f["name"]
        for f in labels if isinstance(f, dict) and f.get("name")
    }
    lead = CrmLead(
        name=sub.name,
        email=sub.email,
        phone=sub.phone,
        company=sub.company,
        source="web",
        source_detail=source_detail(source, form),
        notes=_notes_block(sub, extras, label_map),
        page_url=sub.page_url,
        intake_form_id=getattr(form, "id", None),
        fields=_labelled_fields(extras, label_map),
        origin_type="submission",
        origin_id=str(sub.id),
        status="new",
        owner_id=getattr(form, "notify_user_id", None) or getattr(source, "notify_user_id", None),
    )
    db.add(lead)
    await db.flush()
    sub.converted_lead_id = lead.id
    return lead


async def resolve_job(
    db: AsyncSession,
    *,
    job_id=None,
    job_title: str | None = None,
    company_id=None,
) -> JobOpening:
    """Find the opening an application belongs to, creating a catch-all if needed.

    ``Candidate.job_id`` is not nullable, so this must always return something —
    an application is never rejected merely because we could not work out which
    role it was for.
    """
    if job_id:
        if isinstance(job_id, str):
            try:
                job_id = uuid.UUID(job_id)
            except ValueError:
                job_id = None
        if job_id:
            job = await db.get(JobOpening, job_id)
            if job:
                return job

    if job_title:
        wanted = job_title.strip().lower()
        if wanted:
            match = (
                await db.execute(
                    select(JobOpening)
                    .where(func.lower(JobOpening.title) == wanted)
                    .order_by(JobOpening.created_at.desc())
                )
            ).scalars().first()
            if match:
                return match

    fallback = (
        await db.execute(
            select(JobOpening).where(JobOpening.title == GENERAL_OPENING_TITLE)
        )
    ).scalars().first()
    if fallback:
        return fallback

    fallback = JobOpening(
        title=GENERAL_OPENING_TITLE,
        status="open",
        company_id=company_id,
        description=(
            "Speculative and unmatched applications received through website forms."
        ),
    )
    db.add(fallback)
    await db.flush()
    return fallback


def store_resume(files: list | None) -> tuple[str | None, str | None]:
    """Persist the first usable attachment. Returns ``(rel_path, note)``.

    Never raises: an application with an unreadable or oversized CV is still a
    real application, so the failure is recorded as a note instead.
    """
    for item in files or []:
        if not isinstance(item, dict):
            continue
        name = item.get("name") or "resume.pdf"
        raw = item.get("data")
        if not raw:
            url = item.get("url")
            return None, f"CV '{name}' not transferred" + (f" — available at {url}" if url else "")
        try:
            blob = base64.b64decode(raw, validate=True)
        except (binascii.Error, ValueError):
            return None, f"CV '{name}' could not be decoded"
        if len(blob) > MAX_FILE_BYTES:
            return None, f"CV '{name}' exceeded the {MAX_FILE_BYTES // (1024 * 1024)} MB limit"
        try:
            rel_path, _ = save_bytes(blob, name, subdir="resumes")
        except Exception:
            return None, f"CV '{name}' was not an accepted document type"
        return rel_path, None
    return None, None


async def make_candidate(
    db: AsyncSession,
    sub,
    source=None,
    form=None,
    *,
    job_id=None,
    job_title: str | None = None,
    files: list | None = None,
) -> Candidate:
    """Create an ATS candidate from a job-application submission."""
    extras = sub.payload or {}
    label_map = {
        f["name"]: f.get("label") or f["name"]
        for f in (getattr(form, "fields", None) or [])
        if isinstance(f, dict) and f.get("name")
    }
    job = await resolve_job(db, job_id=job_id, job_title=job_title)
    resume_path, resume_note = store_resume(files)

    notes = _notes_block(sub, extras, label_map)
    if resume_note:
        notes = "\n".join(filter(None, [notes, resume_note]))

    candidate = Candidate(
        job_id=job.id,
        name=sub.name or sub.email or "Website applicant",
        email=sub.email,
        phone=sub.phone,
        resume_path=resume_path,
        source="website",
        stage="applied",
        status="active",
        notes=notes,
    )
    db.add(candidate)
    await db.flush()

    origin = source_detail(source, form) or "a website form"
    db.add(CandidateActivity(
        candidate_id=candidate.id,
        kind="note",
        body=f"Applied through {origin}." + (f"\n{sub.page_url}" if sub.page_url else ""),
    ))
    sub.converted_candidate_id = candidate.id
    return candidate
