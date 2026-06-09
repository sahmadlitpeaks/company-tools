"""Leave balances and a 'who's out' calendar, derived from approved leave
requests in the Approvals module (so there's a single source of truth)."""
import uuid
from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.core.database import get_db
from app.models.user import User
from app.models.workplace import ApprovalRequest, LeaveBalance
from app.schemas.workplace import (
    LeaveBalanceOut,
    LeaveEntitlementIn,
    WhosOutItem,
)
from app.services.people import user_names

router = APIRouter(prefix="/leave", tags=["leave"])

DEFAULT_ENTITLEMENT = 25


def _weekdays(start: date, end: date) -> int:
    """Inclusive count of Mon–Fri between two dates."""
    if end < start:
        return 0
    days, cur = 0, start
    while cur <= end:
        if cur.weekday() < 5:
            days += 1
        cur += timedelta(days=1)
    return days


def _span_days(req: ApprovalRequest) -> int:
    if not req.start_date:
        return 0
    return _weekdays(req.start_date, req.end_date or req.start_date)


async def _entitlements(db: AsyncSession, year: int) -> dict[uuid.UUID, int]:
    rows = (
        await db.execute(
            select(LeaveBalance.user_id, LeaveBalance.entitlement_days).where(
                LeaveBalance.year == year
            )
        )
    ).all()
    return {r[0]: r[1] for r in rows}


async def _used_by_user(db: AsyncSession, year: int) -> dict[uuid.UUID, int]:
    leaves = (
        await db.execute(
            select(ApprovalRequest).where(
                ApprovalRequest.type == "leave",
                ApprovalRequest.status == "approved",
                ApprovalRequest.start_date.is_not(None),
            )
        )
    ).scalars().all()
    used: dict[uuid.UUID, int] = {}
    for lv in leaves:
        if lv.start_date and lv.start_date.year == year and lv.requester_id:
            used[lv.requester_id] = used.get(lv.requester_id, 0) + _span_days(lv)
    return used


@router.get("/balance", response_model=LeaveBalanceOut)
async def my_balance(
    db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)
):
    year = date.today().year
    ent = (await _entitlements(db, year)).get(user.id, DEFAULT_ENTITLEMENT)
    used = (await _used_by_user(db, year)).get(user.id, 0)
    return LeaveBalanceOut(
        user_id=user.id,
        user_name=user.display_name or user.email,
        year=year,
        entitlement_days=ent,
        used_days=used,
        remaining_days=ent - used,
    )


@router.get("/balances", response_model=list[LeaveBalanceOut])
async def all_balances(
    db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)
):
    if not (user.is_admin or user.role == "manager"):
        raise HTTPException(status_code=403, detail="Managers only")
    year = date.today().year
    ents = await _entitlements(db, year)
    used = await _used_by_user(db, year)
    users = (
        await db.execute(select(User).where(User.status == "active").order_by(User.display_name))
    ).scalars().all()
    out = []
    for u in users:
        ent = ents.get(u.id, DEFAULT_ENTITLEMENT)
        u_used = used.get(u.id, 0)
        out.append(
            LeaveBalanceOut(
                user_id=u.id,
                user_name=u.display_name or u.email,
                year=year,
                entitlement_days=ent,
                used_days=u_used,
                remaining_days=ent - u_used,
            )
        )
    return out


@router.put("/balances/{user_id}", response_model=LeaveBalanceOut)
async def set_entitlement(
    user_id: uuid.UUID,
    payload: LeaveEntitlementIn,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(get_current_user),
):
    if not admin.is_admin:
        raise HTTPException(status_code=403, detail="Admins only")
    year = payload.year or date.today().year
    row = (
        await db.execute(
            select(LeaveBalance).where(
                LeaveBalance.user_id == user_id, LeaveBalance.year == year
            )
        )
    ).scalar_one_or_none()
    if row:
        row.entitlement_days = payload.entitlement_days
    else:
        db.add(
            LeaveBalance(
                user_id=user_id, year=year, entitlement_days=payload.entitlement_days
            )
        )
    await db.commit()
    used = (await _used_by_user(db, year)).get(user_id, 0)
    names = await user_names(db, {user_id})
    return LeaveBalanceOut(
        user_id=user_id,
        user_name=names.get(user_id),
        year=year,
        entitlement_days=payload.entitlement_days,
        used_days=used,
        remaining_days=payload.entitlement_days - used,
    )


@router.get("/whos-out", response_model=list[WhosOutItem])
async def whos_out(
    days: int = 30,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Approved leave overlapping the window starting today."""
    today = date.today()
    until = today + timedelta(days=days)
    leaves = (
        await db.execute(
            select(ApprovalRequest)
            .where(
                ApprovalRequest.type == "leave",
                ApprovalRequest.status == "approved",
                ApprovalRequest.start_date.is_not(None),
            )
            .order_by(ApprovalRequest.start_date.asc())
        )
    ).scalars().all()
    names = await user_names(db, {lv.requester_id for lv in leaves})
    out = []
    for lv in leaves:
        start = lv.start_date
        end = lv.end_date or lv.start_date
        if start and end and end >= today and start <= until:
            out.append(
                WhosOutItem(
                    user_id=lv.requester_id,
                    user_name=names.get(lv.requester_id) if lv.requester_id else None,
                    title=lv.title,
                    start_date=start,
                    end_date=end,
                )
            )
    return out
