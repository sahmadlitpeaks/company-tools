import csv
import io
import uuid
from collections import Counter
from decimal import Decimal, InvalidOperation

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.core.database import get_db
from app.models.card import Lead
from app.models.crm import CrmLead
from app.models.landing import LandingLead, LandingPage
from app.models.user import User
from app.schemas.crm import CrmLeadCreate, CrmLeadOut, CrmLeadUpdate, CrmSummary

router = APIRouter(prefix="/crm", tags=["crm"])

STATUSES = {"new", "contacted", "qualified", "won", "lost"}
OPEN_STATUSES = {"new", "contacted", "qualified"}


async def _owner_names(db: AsyncSession, ids: set[uuid.UUID]) -> dict[uuid.UUID, str]:
    ids = {i for i in ids if i}
    if not ids:
        return {}
    rows = (
        await db.execute(
            select(User.id, User.display_name, User.email).where(User.id.in_(ids))
        )
    ).all()
    return {r[0]: (r[1] or r[2]) for r in rows}


def _serialize(lead: CrmLead, names: dict[uuid.UUID, str]) -> CrmLeadOut:
    out = CrmLeadOut.model_validate(lead)
    out.owner_name = names.get(lead.owner_id) if lead.owner_id else None
    return out


@router.get("/leads", response_model=list[CrmLeadOut])
async def list_leads(
    status: str | None = None,
    source: str | None = None,
    company_id: uuid.UUID | None = None,
    q: str | None = None,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    stmt = select(CrmLead).order_by(CrmLead.created_at.desc())
    if status:
        stmt = stmt.where(CrmLead.status == status)
    if source:
        stmt = stmt.where(CrmLead.source == source)
    if company_id:
        stmt = stmt.where(CrmLead.company_id == company_id)
    if q:
        like = f"%{q}%"
        stmt = stmt.where(
            CrmLead.name.ilike(like)
            | CrmLead.email.ilike(like)
            | CrmLead.company.ilike(like)
        )
    leads = (await db.execute(stmt.limit(1000))).scalars().all()
    names = await _owner_names(db, {x.owner_id for x in leads})
    return [_serialize(x, names) for x in leads]


@router.get("/summary", response_model=CrmSummary)
async def summary(
    db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)
):
    leads = (await db.execute(select(CrmLead))).scalars().all()
    by_status: Counter[str] = Counter(x.status for x in leads)
    by_source: Counter[str] = Counter(x.source for x in leads)
    won = sum((Decimal(x.value) for x in leads if x.status == "won" and x.value), Decimal("0"))
    opn = sum(
        (Decimal(x.value) for x in leads if x.status in OPEN_STATUSES and x.value),
        Decimal("0"),
    )
    return CrmSummary(
        total=len(leads),
        by_status=dict(by_status),
        by_source=dict(by_source),
        won_value=won.quantize(Decimal("0.01")),
        open_value=opn.quantize(Decimal("0.01")),
    )


@router.post("/leads", response_model=CrmLeadOut, status_code=201)
async def create_lead(
    payload: CrmLeadCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    if payload.status not in STATUSES:
        raise HTTPException(status_code=422, detail="Invalid status")
    lead = CrmLead(**payload.model_dump())
    db.add(lead)
    await db.commit()
    await db.refresh(lead)
    names = await _owner_names(db, {lead.owner_id})
    return _serialize(lead, names)


@router.patch("/leads/{lead_id}", response_model=CrmLeadOut)
async def update_lead(
    lead_id: uuid.UUID,
    payload: CrmLeadUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    lead = await db.get(CrmLead, lead_id)
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    data = payload.model_dump(exclude_unset=True)
    if "status" in data and data["status"] not in STATUSES:
        raise HTTPException(status_code=422, detail="Invalid status")
    for field, value in data.items():
        setattr(lead, field, value)
    await db.commit()
    await db.refresh(lead)
    names = await _owner_names(db, {lead.owner_id})
    return _serialize(lead, names)


@router.delete("/leads/{lead_id}", status_code=204)
async def delete_lead(
    lead_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    lead = await db.get(CrmLead, lead_id)
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    await db.delete(lead)
    await db.commit()


@router.post("/sync-existing")
async def sync_existing(
    db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)
):
    """Ingest existing digital-card and landing-form leads into the CRM (de-duped)."""
    existing = (
        await db.execute(select(CrmLead.origin_type, CrmLead.origin_id))
    ).all()
    seen = {(t, i) for t, i in existing if i}
    created = 0

    # Card leads
    card_leads = (await db.execute(select(Lead))).scalars().all()
    for lead in card_leads:
        if ("card_lead", str(lead.id)) in seen:
            continue
        db.add(
            CrmLead(
                name=lead.name,
                email=lead.email,
                phone=lead.phone,
                company=lead.company,
                notes=lead.message,
                source="card",
                status="new",
                origin_type="card_lead",
                origin_id=str(lead.id),
                created_at=lead.created_at,
            )
        )
        created += 1

    # Landing-page leads
    page_titles = {
        p.id: p.title for p in (await db.execute(select(LandingPage))).scalars().all()
    }
    landing_leads = (await db.execute(select(LandingLead))).scalars().all()
    for lead in landing_leads:
        if ("landing_lead", str(lead.id)) in seen:
            continue
        db.add(
            CrmLead(
                name=lead.name,
                email=lead.email,
                phone=lead.phone,
                notes=lead.message,
                source="landing",
                source_detail=page_titles.get(lead.page_id),
                status="new",
                origin_type="landing_lead",
                origin_id=str(lead.id),
                created_at=lead.created_at,
            )
        )
        created += 1

    await db.commit()
    return {"created": created}


def _dec(v: str):
    v = (v or "").strip()
    if not v:
        return None
    try:
        return Decimal(v)
    except InvalidOperation:
        return None


@router.post("/import")
async def import_csv(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Import leads from a CSV (columns: name,email,phone,company,value,notes)."""
    raw = (await file.read()).decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(raw))
    created = 0
    for row in reader:
        if not any((row.get("name"), row.get("email"), row.get("phone"))):
            continue
        db.add(
            CrmLead(
                name=(row.get("name") or "").strip() or None,
                email=(row.get("email") or "").strip() or None,
                phone=(row.get("phone") or "").strip() or None,
                company=(row.get("company") or "").strip() or None,
                value=_dec(row.get("value", "")),
                notes=(row.get("notes") or "").strip() or None,
                source="import",
                status="new",
            )
        )
        created += 1
    await db.commit()
    return {"created": created}
