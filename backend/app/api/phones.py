import csv
import io
import uuid
from datetime import date
from decimal import Decimal, InvalidOperation

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth.deps import get_current_user
from app.core.database import get_db
from app.models.brand import Brand
from app.models.phone_line import PhoneBill, PhoneLine, PhoneLineEvent
from app.models.user import User
from app.schemas.phone import (
    PhoneAssignRequest,
    PhoneBillCreate,
    PhoneBillOut,
    PhoneLineCreate,
    PhoneLineDetail,
    PhoneLineEventOut,
    PhoneLineOut,
    PhoneLineUpdate,
    PhoneStatusRequest,
    PhoneSummary,
    PhoneUnassignRequest,
)
from app.services.activity import record
from app.services.notify import notify_user
from app.services.people import user_labels

router = APIRouter(prefix="/phone-lines", tags=["phone-lines"])

STATUSES = {"available", "assigned", "suspended", "cancelled"}

# Columns used for CSV migration (export / template / import). Lines are
# matched on `number`, so re-importing updates existing lines.
CSV_FIELDS = [
    "number",
    "carrier",
    "plan_name",
    "sim_number",
    "data_allowance",
    "monthly_cost",
    "status",
    "assigned_to_email",
    "brand",
    "contract_start",
    "contract_end",
    "notes",
]

# One illustrative row so people migrating know the expected shape.
CSV_SAMPLE = {
    "number": "+44 7700 900123",
    "carrier": "Vodafone",
    "plan_name": "Business Unlimited",
    "sim_number": "8944000000000000000",
    "data_allowance": "Unlimited",
    "monthly_cost": "25.00",
    "status": "assigned",
    "assigned_to_email": "person@agholding.net",
    "brand": "",
    "contract_start": "2025-01-01",
    "contract_end": "2027-01-01",
    "notes": "Ported from old system",
}


async def _get(db: AsyncSession, line_id: uuid.UUID) -> PhoneLine:
    line = await db.get(PhoneLine, line_id)
    if not line:
        raise HTTPException(status_code=404, detail="Phone line not found")
    return line


async def _bill_counts(db: AsyncSession, ids: set[uuid.UUID]) -> dict[uuid.UUID, int]:
    if not ids:
        return {}
    rows = (
        await db.execute(
            select(PhoneBill.line_id, func.count())
            .where(PhoneBill.line_id.in_(ids))
            .group_by(PhoneBill.line_id)
        )
    ).all()
    return {r[0]: int(r[1]) for r in rows}


def _serialize(line: PhoneLine, names: dict, counts: dict | None = None) -> PhoneLineOut:
    out = PhoneLineOut.model_validate(line)
    lab = (names.get(line.assigned_to_id) or {}) if line.assigned_to_id else {}
    out.assigned_to_name = lab.get("name")
    out.assigned_to_title = lab.get("title")
    out.bill_count = (counts or {}).get(line.id, 0)
    return out


@router.get("", response_model=list[PhoneLineOut])
async def list_lines(
    status: str | None = None,
    assigned_to_id: uuid.UUID | None = None,
    q: str | None = None,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    stmt = select(PhoneLine).order_by(PhoneLine.created_at.desc())
    if status:
        stmt = stmt.where(PhoneLine.status == status)
    if assigned_to_id:
        stmt = stmt.where(PhoneLine.assigned_to_id == assigned_to_id)
    if q:
        like = f"%{q}%"
        stmt = stmt.where(
            PhoneLine.number.ilike(like)
            | PhoneLine.carrier.ilike(like)
            | PhoneLine.plan_name.ilike(like)
        )
    lines = (await db.execute(stmt)).scalars().all()
    names = await user_labels(db, {ln.assigned_to_id for ln in lines})
    counts = await _bill_counts(db, {ln.id for ln in lines})
    return [_serialize(ln, names, counts) for ln in lines]


@router.get("/summary", response_model=PhoneSummary)
async def summary(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    rows = (
        await db.execute(select(PhoneLine.status, func.count()).group_by(PhoneLine.status))
    ).all()
    by_status = {r[0]: int(r[1]) for r in rows}
    # Monthly spend across lines that aren't cancelled.
    spend = (
        await db.execute(
            select(func.coalesce(func.sum(PhoneLine.monthly_cost), 0)).where(
                PhoneLine.status != "cancelled"
            )
        )
    ).scalar() or 0
    return PhoneSummary(
        total=sum(by_status.values()),
        by_status=by_status,
        assigned=by_status.get("assigned", 0),
        monthly_cost=Decimal(spend),
    )


def _parse_date(v: str | None):
    v = (v or "").strip()
    if not v:
        return None
    try:
        return date.fromisoformat(v)
    except ValueError:
        return None


def _parse_decimal(v: str | None):
    v = (v or "").strip()
    if not v:
        return None
    try:
        return Decimal(v)
    except InvalidOperation:
        return None


def _csv_response(rows: list[dict], filename: str) -> StreamingResponse:
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=CSV_FIELDS)
    writer.writeheader()
    writer.writerows(rows)
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/template.csv")
async def template_csv(_: User = Depends(get_current_user)):
    """A header row plus one example row to fill in when migrating."""
    return _csv_response([CSV_SAMPLE], "phone-lines-template.csv")


@router.get("/export.csv")
async def export_csv(
    db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)
):
    lines = (
        await db.execute(select(PhoneLine).order_by(PhoneLine.number))
    ).scalars().all()
    emails = await _emails_by_id(db, {ln.assigned_to_id for ln in lines})
    brands = await _brand_names_by_id(db, {ln.brand_id for ln in lines})
    rows = [
        {
            "number": ln.number,
            "carrier": ln.carrier or "",
            "plan_name": ln.plan_name or "",
            "sim_number": ln.sim_number or "",
            "data_allowance": ln.data_allowance or "",
            "monthly_cost": ln.monthly_cost if ln.monthly_cost is not None else "",
            "status": ln.status,
            "assigned_to_email": emails.get(ln.assigned_to_id, ""),
            "brand": brands.get(ln.brand_id, ""),
            "contract_start": ln.contract_start.isoformat() if ln.contract_start else "",
            "contract_end": ln.contract_end.isoformat() if ln.contract_end else "",
            "notes": ln.notes or "",
        }
        for ln in lines
    ]
    return _csv_response(rows, "phone-lines.csv")


async def _emails_by_id(db: AsyncSession, ids: set) -> dict:
    ids = {i for i in ids if i}
    if not ids:
        return {}
    rows = (await db.execute(select(User.id, User.email).where(User.id.in_(ids)))).all()
    return {r[0]: r[1] for r in rows}


async def _brand_names_by_id(db: AsyncSession, ids: set) -> dict:
    ids = {i for i in ids if i}
    if not ids:
        return {}
    rows = (await db.execute(select(Brand.id, Brand.name).where(Brand.id.in_(ids)))).all()
    return {r[0]: r[1] for r in rows}


@router.post("/import")
async def import_csv(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Bulk create/update phone lines from a CSV (matched by number).

    Lets admins migrate an existing telecom inventory in one go. Unknown
    assignee emails or brand names are skipped (the line still imports).
    """
    raw = (await file.read()).decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(raw))
    # Resolve assignees / brands by name once.
    users = {
        e.lower(): i
        for i, e in (await db.execute(select(User.id, User.email))).all()
    }
    brands = {
        n.lower(): i
        for i, n in (await db.execute(select(Brand.id, Brand.name))).all()
    }
    created = updated = 0
    errors: list[str] = []
    for i, row in enumerate(reader, start=2):
        number = (row.get("number") or "").strip()
        if not number:
            errors.append(f"Row {i}: number is required")
            continue
        status = (row.get("status") or "available").strip() or "available"
        if status not in STATUSES:
            status = "available"
        email = (row.get("assigned_to_email") or "").strip().lower()
        assigned_to_id = users.get(email) if email else None
        if email and not assigned_to_id:
            errors.append(f"Row {i}: unknown assignee '{email}' (left unassigned)")
        brand_name = (row.get("brand") or "").strip().lower()
        brand_id = brands.get(brand_name) if brand_name else None
        if assigned_to_id and status == "available":
            status = "assigned"
        values = dict(
            carrier=(row.get("carrier") or "").strip() or None,
            plan_name=(row.get("plan_name") or "").strip() or None,
            sim_number=(row.get("sim_number") or "").strip() or None,
            data_allowance=(row.get("data_allowance") or "").strip() or None,
            monthly_cost=_parse_decimal(row.get("monthly_cost")),
            status=status,
            assigned_to_id=assigned_to_id,
            brand_id=brand_id,
            contract_start=_parse_date(row.get("contract_start")),
            contract_end=_parse_date(row.get("contract_end")),
            notes=(row.get("notes") or "").strip() or None,
        )
        existing = (
            await db.execute(select(PhoneLine).where(PhoneLine.number == number))
        ).scalar_one_or_none()
        if existing:
            for k, v in values.items():
                setattr(existing, k, v)
            updated += 1
        else:
            line = PhoneLine(number=number, **values)
            db.add(line)
            await db.flush()
            db.add(
                PhoneLineEvent(
                    line_id=line.id,
                    event_type="assigned" if line.assigned_to_id else "note",
                    user_id=line.assigned_to_id,
                    note="Imported via CSV",
                    performed_by_id=user.id,
                )
            )
            created += 1
    record(
        db, user=user, action="created", entity_type="phone_line",
        summary=f"Imported phone lines via CSV ({created} new, {updated} updated)",
    )
    await db.commit()
    return {"created": created, "updated": updated, "errors": errors}


@router.post("", response_model=PhoneLineOut, status_code=201)
async def create_line(
    payload: PhoneLineCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if payload.status not in STATUSES:
        raise HTTPException(status_code=422, detail="Invalid status")
    clash = (
        await db.execute(select(PhoneLine).where(PhoneLine.number == payload.number))
    ).scalar_one_or_none()
    if clash:
        raise HTTPException(status_code=409, detail="That number already exists")
    line = PhoneLine(**payload.model_dump())
    # Keep status consistent with an initial assignee.
    if line.assigned_to_id and line.status == "available":
        line.status = "assigned"
    db.add(line)
    await db.flush()
    db.add(
        PhoneLineEvent(
            line_id=line.id,
            event_type="assigned" if line.assigned_to_id else "note",
            user_id=line.assigned_to_id,
            note="Line added",
            performed_by_id=user.id,
        )
    )
    record(
        db, user=user, action="created", entity_type="phone_line", entity_id=line.id,
        summary=f"Added phone line {line.number}",
    )
    await db.commit()
    await db.refresh(line)
    names = await user_labels(db, {line.assigned_to_id})
    return _serialize(line, names)


@router.get("/{line_id}", response_model=PhoneLineDetail)
async def get_line(
    line_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    line = await db.get(
        PhoneLine, line_id,
        options=[selectinload(PhoneLine.events), selectinload(PhoneLine.bills)],
    )
    if not line:
        raise HTTPException(status_code=404, detail="Phone line not found")
    ids = {line.assigned_to_id}
    for e in line.events:
        ids |= {e.user_id, e.performed_by_id}
    names = await user_labels(db, ids)
    detail = PhoneLineDetail.model_validate(line)
    alab = (names.get(line.assigned_to_id) or {}) if line.assigned_to_id else {}
    detail.assigned_to_name = alab.get("name")
    detail.assigned_to_title = alab.get("title")
    detail.bill_count = len(line.bills)
    detail.events = []
    for e in line.events:
        eo = PhoneLineEventOut.model_validate(e)
        eo.user_name = (names.get(e.user_id) or {}).get("name") if e.user_id else None
        eo.performed_by_name = (
            (names.get(e.performed_by_id) or {}).get("name") if e.performed_by_id else None
        )
        detail.events.append(eo)
    detail.bills = [PhoneBillOut.model_validate(b) for b in line.bills]
    return detail


@router.patch("/{line_id}", response_model=PhoneLineOut)
async def update_line(
    line_id: uuid.UUID,
    payload: PhoneLineUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    line = await _get(db, line_id)
    data = payload.model_dump(exclude_unset=True)
    if "status" in data and data["status"] not in STATUSES:
        raise HTTPException(status_code=422, detail="Invalid status")
    if "number" in data and data["number"] != line.number:
        clash = (
            await db.execute(select(PhoneLine).where(PhoneLine.number == data["number"]))
        ).scalar_one_or_none()
        if clash:
            raise HTTPException(status_code=409, detail="That number already exists")

    prev_plan, prev_cost = line.plan_name, line.monthly_cost
    for field, value in data.items():
        setattr(line, field, value)

    # Record package/cost changes in the history.
    if ("plan_name" in data and data["plan_name"] != prev_plan) or (
        "monthly_cost" in data and data["monthly_cost"] != prev_cost
    ):
        db.add(
            PhoneLineEvent(
                line_id=line.id,
                event_type="plan_changed",
                user_id=line.assigned_to_id,
                note=f"Package: {line.plan_name or '—'} · {line.monthly_cost or 0}/mo",
                performed_by_id=user.id,
            )
        )
    await db.commit()
    await db.refresh(line)
    names = await user_labels(db, {line.assigned_to_id})
    counts = await _bill_counts(db, {line.id})
    return _serialize(line, names, counts)


@router.post("/{line_id}/assign", response_model=PhoneLineOut)
async def assign(
    line_id: uuid.UUID,
    payload: PhoneAssignRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    line = await _get(db, line_id)
    if line.status == "cancelled":
        raise HTTPException(status_code=409, detail="Line is cancelled")
    target = await db.get(User, payload.user_id)
    if not target:
        raise HTTPException(status_code=404, detail="Assignee not found")
    line.assigned_to_id = target.id
    line.status = "assigned"
    db.add(
        PhoneLineEvent(
            line_id=line.id, event_type="assigned", user_id=target.id,
            note=payload.note, performed_by_id=user.id,
        )
    )
    record(
        db, user=user, action="assigned", entity_type="phone_line", entity_id=line.id,
        summary=f"Assigned {line.number} to {target.display_name or target.email}",
    )
    await notify_user(
        db, user_id=target.id,
        title="A phone line was assigned to you",
        body=f"{line.number} ({line.carrier or 'mobile'}) is now assigned to you.",
        link="/phone-lines", category="asset",
    )
    await db.commit()
    await db.refresh(line)
    names = await user_labels(db, {line.assigned_to_id})
    return _serialize(line, names)


@router.post("/{line_id}/unassign", response_model=PhoneLineOut)
async def unassign(
    line_id: uuid.UUID,
    payload: PhoneUnassignRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    line = await _get(db, line_id)
    prev = line.assigned_to_id
    line.assigned_to_id = None
    if line.status == "assigned":
        line.status = "available"
    db.add(
        PhoneLineEvent(
            line_id=line.id, event_type="unassigned", user_id=prev,
            note=payload.note, performed_by_id=user.id,
        )
    )
    record(
        db, user=user, action="updated", entity_type="phone_line", entity_id=line.id,
        summary=f"Released {line.number}",
    )
    await db.commit()
    await db.refresh(line)
    return _serialize(line, {})


@router.post("/{line_id}/status", response_model=PhoneLineOut)
async def set_status(
    line_id: uuid.UUID,
    payload: PhoneStatusRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if payload.status not in STATUSES:
        raise HTTPException(status_code=422, detail="Invalid status")
    line = await _get(db, line_id)
    prev = line.status
    line.status = payload.status
    if payload.status in {"available", "suspended", "cancelled"}:
        line.assigned_to_id = None if payload.status == "cancelled" else line.assigned_to_id
    event = {
        "suspended": "suspended",
        "available": "reactivated",
        "cancelled": "cancelled",
        "assigned": "note",
    }.get(payload.status, "note")
    db.add(
        PhoneLineEvent(
            line_id=line.id, event_type=event, user_id=line.assigned_to_id,
            note=payload.note or f"Status {prev} → {payload.status}",
            performed_by_id=user.id,
        )
    )
    record(
        db, user=user, action="updated", entity_type="phone_line", entity_id=line.id,
        summary=f"{line.number}: {prev} → {payload.status}",
    )
    await db.commit()
    await db.refresh(line)
    names = await user_labels(db, {line.assigned_to_id})
    return _serialize(line, names)


@router.post("/{line_id}/bills", response_model=PhoneBillOut, status_code=201)
async def add_bill(
    line_id: uuid.UUID,
    payload: PhoneBillCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    line = await _get(db, line_id)
    bill = PhoneBill(line_id=line.id, **payload.model_dump())
    db.add(bill)
    record(
        db, user=user, action="created", entity_type="phone_line", entity_id=line.id,
        summary=f"Logged {line.number} bill for {bill.period}",
    )
    await db.commit()
    await db.refresh(bill)
    return PhoneBillOut.model_validate(bill)


@router.delete("/bills/{bill_id}", status_code=204)
async def delete_bill(
    bill_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    bill = await db.get(PhoneBill, bill_id)
    if bill:
        await db.delete(bill)
        await db.commit()


@router.delete("/{line_id}", status_code=204)
async def delete_line(
    line_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    line = await db.get(PhoneLine, line_id)
    if line:
        await db.delete(line)
        await db.commit()
