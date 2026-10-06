import csv
import io
import json
import uuid
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Literal

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Response, UploadFile
from sqlalchemy import String, cast, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.core.database import get_db
from app.models.card import Lead
from app.models.crm import (
    CONTACT_ACTIVITY_KINDS,
    MANUAL_ACTIVITY_KINDS,
    OPEN_STATUSES,
    CrmActivity,
    CrmLead,
)
from app.models.landing import LandingLead, LandingPage
from app.models.user import User
from app.schemas.crm import (
    CrmActivityCreate,
    CrmActivityOut,
    CrmBulkAction,
    CrmImportIssue,
    CrmImportPreview,
    CrmImportResult,
    CrmImportRow,
    CrmLeadCreate,
    CrmLeadOut,
    CrmLeadUpdate,
    CrmSummary,
    LeadPriority,
    LeadStatus,
    normalize_tags,
)
from app.schemas.pagination import Page
from app.services import crm_import
from app.services.list_filters import received_range, search_pattern
from app.services.notify import notify_user

router = APIRouter(prefix="/crm", tags=["crm"])

FollowUp = Literal["overdue", "today", "upcoming", "none"]
Sort = Literal["newest", "oldest", "value_high", "value_low", "follow_up"]
# Fields whose edits are written to the lead's timeline.
_TRACKED = ("status", "owner_id", "value", "priority", "follow_up_date")
_LABELS = {"status": "Stage", "owner_id": "Owner", "value": "Value", "priority": "Priority", "follow_up_date": "Follow-up"}


def _today() -> date:
    return datetime.now(timezone.utc).date()


def _can_delete(user: User, lead: CrmLead) -> bool:
    return bool(user.is_admin or (lead.owner_id is not None and lead.owner_id == user.id))


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


def _serialize(lead: CrmLead, names: dict[uuid.UUID, str], user: User) -> CrmLeadOut:
    out = CrmLeadOut.model_validate(lead)
    out.owner_name = names.get(lead.owner_id) if lead.owner_id else None
    out.can_delete = _can_delete(user, lead)
    return out


async def _get_lead(db: AsyncSession, lead_id: uuid.UUID) -> CrmLead:
    lead = await db.get(CrmLead, lead_id)
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    return lead


async def _check_owner(db: AsyncSession, owner_id: uuid.UUID | None) -> None:
    if owner_id is None:
        return
    owner = await db.get(User, owner_id)
    if owner is None or not owner.is_active or owner.status == "disabled":
        raise HTTPException(status_code=422, detail="Choose an active user as the owner")


def _require_lost_reason(status: str, reason: str | None) -> None:
    if status == "lost" and not (reason or "").strip():
        raise HTTPException(status_code=422, detail="Give a reason when marking a lead as lost")


def _show(field: str, value, names: dict[uuid.UUID, str]) -> str:
    if value is None or value == "":
        return "Unassigned" if field == "owner_id" else "—"
    if field == "owner_id":
        return names.get(value, "a removed user")
    if field == "value":
        return f"{Decimal(value):,.2f}"
    return str(value)


def _new_activity(lead: CrmLead, kind: str, body: str, user: User | None) -> CrmActivity:
    # Stamp in Python: the database clock can be second-resolution (SQLite) or
    # fixed per transaction, which would let timeline entries tie.
    return CrmActivity(
        lead_id=lead.id, kind=kind, body=body, author_id=user.id if user else None,
        created_at=datetime.now(timezone.utc),
    )


def _log(db: AsyncSession, lead: CrmLead, kind: str, body: str, user: User | None) -> None:
    db.add(_new_activity(lead, kind, body, user))


async def _notify_owner(db: AsyncSession, owner_id: uuid.UUID | None, user: User, title: str, link: str) -> None:
    if owner_id and owner_id != user.id:
        await notify_user(db, user_id=owner_id, title=title, link=link, category="crm")


def _lead_query(
    status=None, source=None, company_id=None, q=None, priority=None, tag=None, follow_up=None
):
    stmt = select(CrmLead)
    if status:
        stmt = stmt.where(CrmLead.status == status)
    if source:
        stmt = stmt.where(CrmLead.source == source)
    if company_id:
        stmt = stmt.where(CrmLead.company_id == company_id)
    if priority:
        stmt = stmt.where(CrmLead.priority == priority)
    if tag and (clean := normalize_tags([tag])):
        # Tags are a JSON list of plain strings; match one whole quoted entry.
        literal = clean[0].replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        stmt = stmt.where(cast(CrmLead.tags, String).ilike(f'%"{literal}"%', escape="\\"))
    if follow_up:
        today = _today()
        stmt = stmt.where(CrmLead.status.in_(OPEN_STATUSES))
        stmt = stmt.where(
            {
                "overdue": CrmLead.follow_up_date < today,
                "today": CrmLead.follow_up_date == today,
                "upcoming": CrmLead.follow_up_date > today,
                "none": CrmLead.follow_up_date.is_(None),
            }[follow_up]
        )
    if q and q.strip():
        like = search_pattern(q)
        stmt = stmt.where(
            CrmLead.name.ilike(like, escape="\\")
            | CrmLead.email.ilike(like, escape="\\")
            | CrmLead.company.ilike(like, escape="\\")
            | CrmLead.phone.ilike(like, escape="\\")
            | CrmLead.notes.ilike(like, escape="\\")
        )
    return stmt


class _Filters:
    """The list filters, shared by the paged list and the CSV export."""

    def __init__(
        self,
        status: LeadStatus | None = None,
        source: str | None = None,
        company_id: uuid.UUID | None = None,
        owner_id: uuid.UUID | None = None,
        unassigned: bool = False,
        priority: LeadPriority | None = None,
        tag: str | None = Query(None, max_length=40),
        follow_up: FollowUp | None = None,
        q: str | None = Query(None, max_length=300),
        after: date | None = None,
        before: date | None = None,
        sort: Sort = "newest",
    ):
        if owner_id and unassigned:
            raise HTTPException(status_code=422, detail="Choose an owner or unassigned, not both")
        self.owner_id, self.unassigned, self.sort = owner_id, unassigned, sort
        self.stmt = received_range(
            _lead_query(status, source, company_id, q, priority, tag, follow_up),
            CrmLead.created_at, after, before,
        )
        if owner_id:
            self.stmt = self.stmt.where(CrmLead.owner_id == owner_id)
        elif unassigned:
            self.stmt = self.stmt.where(CrmLead.owner_id.is_(None))

    @property
    def order(self):
        return {
            "newest": CrmLead.created_at.desc(),
            "oldest": CrmLead.created_at.asc(),
            "value_high": CrmLead.value.desc().nulls_last(),
            "value_low": CrmLead.value.asc().nulls_last(),
            "follow_up": CrmLead.follow_up_date.asc().nulls_last(),
        }[self.sort]


@router.get("/leads/page", response_model=Page[CrmLeadOut])
async def lead_page(
    filters: _Filters = Depends(),
    limit: int = Query(25, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    stmt = filters.stmt
    total = int((await db.scalar(select(func.count()).select_from(stmt.subquery()))) or 0)
    # Clamp after deleting the final row of a page, so the UI never gets stranded.
    offset = min(offset // limit, max(0, (total - 1) // limit)) * limit
    leads = (await db.execute(stmt.order_by(filters.order, CrmLead.id).offset(offset).limit(limit))).scalars().all()
    names = await _owner_names(db, {x.owner_id for x in leads})
    return Page(items=[_serialize(x, names, user) for x in leads], total=total, limit=limit, offset=offset)


_EXPORT_COLUMNS = [
    "name", "email", "phone", "company", "value", "notes", "status", "priority", "tags",
    "next_step", "follow_up_date", "expected_close_date", "lost_reason", "owner", "source",
    "source_detail", "last_contacted_at", "created_at",
]
_EXPORT_LIMIT = 20000


def _safe_cell(value) -> str:
    """Stop spreadsheet apps from running lead text (often from public web
    forms) as a formula. Plain phone numbers like +971… are left alone."""
    text = "" if value is None else str(value)
    if text.startswith(crm_import.FORMULA_PREFIXES) and not (
        text[0] in "+-" and text[1:].replace(" ", "").replace("-", "").replace(".", "").isdigit()
    ):
        return "'" + text
    return text


@router.get("/leads/export")
async def export_leads(
    filters: _Filters = Depends(),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Download the filtered list as CSV. The file re-imports as-is."""
    leads = (
        await db.execute(filters.stmt.order_by(filters.order, CrmLead.id).limit(_EXPORT_LIMIT))
    ).scalars().all()
    names = await _owner_names(db, {x.owner_id for x in leads})
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(_EXPORT_COLUMNS)
    for lead in leads:
        row = {
            **{c: getattr(lead, c, None) for c in _EXPORT_COLUMNS},
            "tags": ", ".join(lead.tags or []),
            "owner": names.get(lead.owner_id) if lead.owner_id else None,
            "created_at": lead.created_at.isoformat() if lead.created_at else None,
            "last_contacted_at": lead.last_contacted_at.isoformat() if lead.last_contacted_at else None,
        }
        writer.writerow([_safe_cell(row[c]) for c in _EXPORT_COLUMNS])
    filename = f"crm-leads-{_today().isoformat()}.csv"
    return Response(
        content="﻿" + buffer.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/leads", response_model=list[CrmLeadOut])
async def list_leads(
    status: str | None = None,
    source: str | None = None,
    company_id: uuid.UUID | None = None,
    q: str | None = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    stmt = _lead_query(status, source, company_id, q).order_by(CrmLead.created_at.desc(), CrmLead.id)
    leads = (await db.execute(stmt.limit(1000))).scalars().all()
    names = await _owner_names(db, {x.owner_id for x in leads})
    return [_serialize(x, names, user) for x in leads]


@router.get("/summary", response_model=CrmSummary)
async def summary(
    db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)
):
    by_status = dict((await db.execute(select(CrmLead.status, func.count()).group_by(CrmLead.status))).all())
    by_source = dict((await db.execute(select(CrmLead.source, func.count()).group_by(CrmLead.source))).all())
    won = await db.scalar(select(func.sum(CrmLead.value)).where(CrmLead.status == "won"))
    opn = await db.scalar(select(func.sum(CrmLead.value)).where(CrmLead.status.in_(OPEN_STATUSES)))
    today = _today()
    open_follow_ups = select(func.count()).where(CrmLead.status.in_(OPEN_STATUSES))
    overdue = await db.scalar(open_follow_ups.where(CrmLead.follow_up_date < today))
    due_today = await db.scalar(open_follow_ups.where(CrmLead.follow_up_date == today))
    return CrmSummary(
        total=sum(by_status.values()),
        by_status=by_status,
        by_source=by_source,
        won_value=Decimal(won or 0).quantize(Decimal("0.01")),
        open_value=Decimal(opn or 0).quantize(Decimal("0.01")),
        overdue=overdue or 0,
        due_today=due_today or 0,
    )


@router.post("/leads", response_model=CrmLeadOut, status_code=201)
async def create_lead(
    payload: CrmLeadCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _require_lost_reason(payload.status, payload.lost_reason)
    await _check_owner(db, payload.owner_id)
    lead = CrmLead(**payload.model_dump())
    db.add(lead)
    await db.flush()
    _log(db, lead, "created", "Lead added", user)
    await _notify_owner(db, lead.owner_id, user, f"Lead assigned to you: {lead.name or lead.email or 'new lead'}", f"/crm/{lead.id}")
    await db.commit()
    await db.refresh(lead)
    names = await _owner_names(db, {lead.owner_id})
    return _serialize(lead, names, user)


@router.get("/leads/{lead_id}", response_model=CrmLeadOut)
async def get_lead(
    lead_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    lead = await _get_lead(db, lead_id)
    names = await _owner_names(db, {lead.owner_id})
    return _serialize(lead, names, user)


def _apply_changes(lead: CrmLead, data: dict, names: dict[uuid.UUID, str]) -> list[str]:
    """Set `data` on the lead and describe the tracked edits for its timeline."""
    status = data.get("status", lead.status)
    # A reason is required when a lead moves into lost; leads that were lost
    # before reasons existed stay editable.
    becomes_lost = status == "lost" and lead.status != "lost"
    if becomes_lost:
        _require_lost_reason(status, data.get("lost_reason", lead.lost_reason))
    if status != "lost" and "status" in data:
        data["lost_reason"] = None
    changes = []
    for field in _TRACKED:
        if field in data and data[field] != getattr(lead, field):
            before, after = getattr(lead, field), data[field]
            if field == "value" and before is not None and after is not None and Decimal(before) == Decimal(after):
                continue
            changes.append(f"{_LABELS[field]}: {_show(field, before, names)} → {_show(field, after, names)}")
    if becomes_lost:
        changes.append(f"Lost reason: {data.get('lost_reason', lead.lost_reason)}")
    for field, value in data.items():
        setattr(lead, field, value)
    return changes


@router.patch("/leads/{lead_id}", response_model=CrmLeadOut)
async def update_lead(
    lead_id: uuid.UUID,
    payload: CrmLeadUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    lead = await _get_lead(db, lead_id)
    data = payload.model_dump(exclude_unset=True)
    if data.get("status", "") is None:
        del data["status"]  # a stage is required; null means "leave it"
    if "owner_id" in data:
        await _check_owner(db, data["owner_id"])
    previous_owner = lead.owner_id
    names = await _owner_names(db, {lead.owner_id, data.get("owner_id")})
    changes = _apply_changes(lead, data, names)
    if changes:
        _log(db, lead, "change", "\n".join(changes), user)
    if lead.owner_id != previous_owner:
        await _notify_owner(db, lead.owner_id, user, f"Lead assigned to you: {lead.name or lead.email or 'lead'}", f"/crm/{lead.id}")
    await db.commit()
    await db.refresh(lead)
    names = await _owner_names(db, {lead.owner_id})
    return _serialize(lead, names, user)


@router.delete("/leads/{lead_id}", status_code=204)
async def delete_lead(
    lead_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    lead = await _get_lead(db, lead_id)
    if not _can_delete(user, lead):
        raise HTTPException(status_code=403, detail="Only an admin or the lead's owner can delete it")
    await db.delete(lead)
    await db.commit()


@router.post("/leads/bulk")
async def bulk_update(
    payload: CrmBulkAction,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Assign, re-stage or delete many leads at once. All or nothing."""
    leads = (await db.execute(select(CrmLead).where(CrmLead.id.in_(set(payload.ids))))).scalars().all()
    if payload.action == "delete":
        if any(not _can_delete(user, lead) for lead in leads):
            raise HTTPException(status_code=403, detail="Only an admin or the lead's owner can delete it. Nothing was deleted.")
        for lead in leads:
            await db.delete(lead)
        await db.commit()
        return {"updated": len(leads)}

    if payload.action == "assign":
        await _check_owner(db, payload.owner_id)
        data = {"owner_id": payload.owner_id}
    else:
        if payload.status is None:
            raise HTTPException(status_code=422, detail="Choose a stage")
        _require_lost_reason(payload.status, payload.lost_reason)
        data = {"status": payload.status}
        if payload.status == "lost":
            data["lost_reason"] = payload.lost_reason
    names = await _owner_names(db, {x.owner_id for x in leads} | {payload.owner_id})
    updated = 0
    for lead in leads:
        changes = _apply_changes(lead, dict(data), names)
        if changes:
            _log(db, lead, "change", "\n".join(changes), user)
            updated += 1
    if payload.action == "assign" and updated:
        await _notify_owner(db, payload.owner_id, user, f"{updated} lead{'s' if updated != 1 else ''} assigned to you", "/crm")
    await db.commit()
    return {"updated": updated}


# ---------- Timeline ----------


def _activity_out(activity: CrmActivity, names: dict[uuid.UUID, str], user: User) -> CrmActivityOut:
    out = CrmActivityOut.model_validate(activity)
    out.author_name = names.get(activity.author_id) if activity.author_id else None
    out.can_delete = activity.kind in MANUAL_ACTIVITY_KINDS and (
        user.is_admin or activity.author_id == user.id
    )
    return out


@router.get("/leads/{lead_id}/activities", response_model=list[CrmActivityOut])
async def list_activities(
    lead_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await _get_lead(db, lead_id)
    rows = (
        await db.execute(
            select(CrmActivity)
            .where(CrmActivity.lead_id == lead_id)
            .order_by(CrmActivity.created_at.desc(), CrmActivity.id)
            .limit(500)
        )
    ).scalars().all()
    names = await _owner_names(db, {x.author_id for x in rows})
    return [_activity_out(x, names, user) for x in rows]


@router.post("/leads/{lead_id}/activities", response_model=CrmActivityOut, status_code=201)
async def add_activity(
    lead_id: uuid.UUID,
    payload: CrmActivityCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    lead = await _get_lead(db, lead_id)
    activity = _new_activity(lead, payload.kind, payload.body, user)
    db.add(activity)
    if payload.kind in CONTACT_ACTIVITY_KINDS:
        lead.last_contacted_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(activity)
    names = await _owner_names(db, {user.id})
    return _activity_out(activity, names, user)


@router.delete("/leads/{lead_id}/activities/{activity_id}", status_code=204)
async def delete_activity(
    lead_id: uuid.UUID,
    activity_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    activity = await db.get(CrmActivity, activity_id)
    if not activity or activity.lead_id != lead_id:
        raise HTTPException(status_code=404, detail="Timeline entry not found")
    if activity.kind not in MANUAL_ACTIVITY_KINDS:
        raise HTTPException(status_code=403, detail="Automatic history entries can't be deleted")
    if not (user.is_admin or activity.author_id == user.id):
        raise HTTPException(status_code=403, detail="Only the author or an admin can delete this entry")
    await db.delete(activity)
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


# ---------- Import ----------


async def _read_upload(file: UploadFile, sheet: str | None, mapping: str | None):
    raw = await file.read(crm_import.MAX_BYTES + 1)
    try:
        table = crm_import.read_table(file.filename or "", raw, sheet or None)
        if mapping:
            try:
                chosen = json.loads(mapping)
            except ValueError:
                raise crm_import.ImportFileError("The column mapping is not valid JSON.")
            if not isinstance(chosen, dict):
                raise crm_import.ImportFileError("The column mapping must be an object.")
        else:
            chosen = crm_import.suggest_mapping(table.columns)
        return table, crm_import.validate_mapping(table.columns, chosen)
    except crm_import.ImportFileError as exc:
        raise HTTPException(status_code=422, detail=str(exc))


async def _existing_by_email(db: AsyncSession, keys: set[str]) -> dict[str, CrmLead]:
    found: dict[str, CrmLead] = {}
    keys_list = sorted(keys)
    for start in range(0, len(keys_list), 500):
        chunk = keys_list[start : start + 500]
        rows = (
            await db.execute(
                select(CrmLead)
                .where(func.lower(CrmLead.email).in_(chunk))
                .order_by(CrmLead.created_at.asc(), CrmLead.id)
            )
        ).scalars().all()
        for lead in rows:
            found.setdefault((lead.email or "").lower(), lead)
    return found


def _issues(rows: list[crm_import.LeadRow]) -> tuple[list[CrmImportIssue], list[CrmImportIssue]]:
    errors = [CrmImportIssue(row=r.row, message=r.error) for r in rows if r.error]
    warnings = [CrmImportIssue(row=r.row, message=w) for r in rows if not r.error for w in r.warnings]
    return errors[:100], warnings[:100]


@router.post("/import/preview", response_model=CrmImportPreview)
async def import_preview(
    file: UploadFile = File(...),
    sheet: str | None = Form(None),
    mapping: str | None = Form(None),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Read a CSV/XLSX and show how it would import, without saving anything."""
    table, chosen = await _read_upload(file, sheet, mapping)
    rows = crm_import.normalize_table(table, chosen)
    valid = [r for r in rows if not r.error]
    existing = await _existing_by_email(db, {r.key for r in valid if r.key})
    seen: set[str] = set()
    sample: list[CrmImportRow] = []
    in_file = matches = 0
    for row in valid:
        if row.key and row.key in seen:
            match, in_file = "duplicate_in_file", in_file + 1
        elif row.key and row.key in existing:
            match, matches = "exists", matches + 1
        else:
            match = "new"
        if row.key:
            seen.add(row.key)
        if len(sample) < 10:
            sample.append(CrmImportRow(
                row=row.row, match=match, status=row.data["status"],
                **{k: row.data.get(k) for k in ("name", "email", "phone", "company")},
            ))
    errors, warnings = _issues(rows)
    return CrmImportPreview(
        sheets=table.sheets, sheet=table.sheet, columns=table.columns, mapping=chosen,
        total_rows=len(rows), valid_rows=len(valid), duplicates_in_file=in_file,
        existing_matches=matches, errors=errors, warnings=warnings, sample=sample,
    )


_MERGE_FILL = ("name", "phone", "company", "value", "priority", "next_step", "follow_up_date", "expected_close_date")


@router.post("/import", response_model=CrmImportResult)
async def import_leads(
    file: UploadFile = File(...),
    sheet: str | None = Form(None),
    mapping: str | None = Form(None),
    on_duplicate: Literal["skip", "merge"] = Form("skip"),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Import leads from CSV or XLSX. Without a mapping, columns are matched by
    name (e.g. name, email, phone, company, value, notes). A row whose email is
    already in the CRM, or earlier in the file, is skipped or merged."""
    table, chosen = await _read_upload(file, sheet, mapping)
    rows = crm_import.normalize_table(table, chosen)
    valid = [r for r in rows if not r.error]
    targets = await _existing_by_email(db, {r.key for r in valid if r.key})
    label = (file.filename or "file")[:120]
    created = merged = skipped = 0
    # Timeline rows are added after the new leads are flushed: nothing else
    # orders the two inserts, and Postgres enforces the foreign key.
    entries: list[CrmActivity] = []
    for row in valid:
        data = row.data
        target = targets.get(row.key) if row.key else None
        if target is None:
            # Set the id here so the timeline entry needs no flush per row.
            lead = CrmLead(id=uuid.uuid4(), **data, source="import", source_detail=label[:255])
            db.add(lead)
            entries.append(_new_activity(lead, "import", f"Imported from {label} (row {row.row})", user))
            if row.key:
                targets[row.key] = lead
            created += 1
        elif on_duplicate == "skip":
            skipped += 1
        else:
            for key in _MERGE_FILL:
                if data.get(key) is not None and getattr(target, key) in (None, ""):
                    setattr(target, key, data[key])
            if data.get("tags"):
                target.tags = normalize_tags([*(target.tags or []), *data["tags"]])
            body = f"Merged from {label} (row {row.row})"
            if data.get("notes"):
                body += f"\n\n{data['notes']}"
            entries.append(_new_activity(target, "import", body, user))
            merged += 1
    await db.flush()
    db.add_all(entries)
    await db.commit()
    errors, _ = _issues(rows)
    return CrmImportResult(created=created, merged=merged, skipped=skipped, errors=errors)
