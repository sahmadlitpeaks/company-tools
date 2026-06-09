import uuid
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth.deps import get_current_user
from app.core.database import get_db
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
from app.services.people import user_names

router = APIRouter(prefix="/phone-lines", tags=["phone-lines"])

STATUSES = {"available", "assigned", "suspended", "cancelled"}


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
    out.assigned_to_name = names.get(line.assigned_to_id) if line.assigned_to_id else None
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
    names = await user_names(db, {ln.assigned_to_id for ln in lines})
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
    names = await user_names(db, {line.assigned_to_id})
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
    names = await user_names(db, ids)
    detail = PhoneLineDetail.model_validate(line)
    detail.assigned_to_name = names.get(line.assigned_to_id) if line.assigned_to_id else None
    detail.bill_count = len(line.bills)
    detail.events = []
    for e in line.events:
        eo = PhoneLineEventOut.model_validate(e)
        eo.user_name = names.get(e.user_id) if e.user_id else None
        eo.performed_by_name = names.get(e.performed_by_id) if e.performed_by_id else None
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
    names = await user_names(db, {line.assigned_to_id})
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
    names = await user_names(db, {line.assigned_to_id})
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
    names = await user_names(db, {line.assigned_to_id})
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
