"""Every lead lands in the CRM through here (BRD 9B, LHB-01..03).

``capture_lead`` either creates a lead or, when the same person is already an
open lead (same email, or same phone number), adds this submission to that lead
instead of creating a duplicate. Either way the submission is recorded as a
``CrmLeadSource`` row, so the lead lists every place it came from.
"""
import re
import uuid

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.crm import OPEN_STATUSES, CrmActivity, CrmLead, CrmLeadSource

SOURCE_LABELS = {
    "card": "Digital card", "landing": "Landing page", "web": "Website form", "manual": "Added by hand",
    "import": "Spreadsheet import", "brochure": "Brochure download", "asset": "Asset download",
}


def phone_key(phone: str | None) -> str | None:
    """Last 9 digits, so +971 50 123 4567 and 050 123 4567 match."""
    digits = re.sub(r"\D", "", phone or "")
    return digits[-9:] if len(digits) >= 7 else None


async def find_duplicate(db: AsyncSession, email: str | None, phone: str | None) -> CrmLead | None:
    conditions = []
    if email and email.strip():
        conditions.append(func.lower(CrmLead.email) == email.strip().lower())
    key = phone_key(phone)
    if key:
        conditions.append(CrmLead.phone_key == key)
    if not conditions:
        return None
    return await db.scalar(
        select(CrmLead).where(or_(*conditions), CrmLead.status.in_(OPEN_STATUSES))
        .order_by(CrmLead.created_at.desc()).limit(1)
    )


def add_source(db: AsyncSession, lead: CrmLead, *, source: str, source_detail: str | None,
               origin_type: str | None, origin_id: str | None) -> None:
    db.add(CrmLeadSource(lead_id=lead.id, source=source, source_detail=(source_detail or None) and source_detail[:255],
                         origin_type=origin_type, origin_id=origin_id))


async def capture_lead(
    db: AsyncSession, *, source: str, source_detail: str | None = None,
    origin_type: str | None = None, origin_id: str | None = None,
    name: str | None = None, email: str | None = None, phone: str | None = None,
    company: str | None = None, notes: str | None = None, merge: bool = True, **extra,
) -> tuple[CrmLead, bool]:
    """Create or merge a lead. Returns ``(lead, merged)``; the caller commits."""
    existing = await find_duplicate(db, email, phone) if merge else None
    if existing is not None:
        for field, value in (("name", name), ("email", email), ("phone", phone), ("company", company)):
            if value and not getattr(existing, field):
                setattr(existing, field, value)
        existing.phone_key = phone_key(existing.phone)
        label = SOURCE_LABELS.get(source, source)
        body = f"Came in again via {label}" + (f" ({source_detail})" if source_detail else "") + "."
        if notes:
            body += f"\n\n{notes}"
        db.add(CrmActivity(lead_id=existing.id, kind="note", body=body[:20000]))
        add_source(db, existing, source=source, source_detail=source_detail, origin_type=origin_type, origin_id=origin_id)
        await db.flush()
        return existing, True
    lead = CrmLead(id=uuid.uuid4(), name=name, email=email, phone=phone, company=company, notes=notes,
                   source=source, source_detail=source_detail, origin_type=origin_type, origin_id=origin_id,
                   phone_key=phone_key(phone), **extra)
    lead.status = extra.get("status") or "new"
    db.add(lead)
    await db.flush()
    add_source(db, lead, source=source, source_detail=source_detail, origin_type=origin_type, origin_id=origin_id)
    await db.flush()
    return lead, False
