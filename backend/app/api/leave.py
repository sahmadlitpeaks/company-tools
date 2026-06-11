"""Full leave: typed balances with accrual, a holiday calendar, and a
'who's out' view. Leave requests themselves live in the Approvals module
(type=leave, optionally tagged with a leave_type_id) so there's one source
of truth for the approval workflow."""
import uuid
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.core.database import get_db
from app.models.hr import Holiday, LeaveType
from app.models.user import User
from app.models.workplace import ApprovalRequest, LeaveBalance
from app.schemas.leave import (
    HolidayCreate,
    HolidayOut,
    LeaveBalanceOut,
    LeaveEntitlementIn,
    LeaveTypeBalance,
    LeaveTypeCreate,
    LeaveTypeOut,
    LeaveTypeUpdate,
    WhosOutItem,
)
from app.services.activity import record
from app.services.people import user_names

router = APIRouter(prefix="/leave", tags=["leave"])


async def _holidays(db: AsyncSession) -> set[date]:
    days = (await db.execute(select(Holiday.day))).scalars().all()
    return set(days)


def _working_days(start: date, end: date, holidays: set[date]) -> int:
    """Inclusive Mon–Fri count between two dates, excluding company holidays."""
    if end < start:
        return 0
    days, cur = 0, start
    while cur <= end:
        if cur.weekday() < 5 and cur not in holidays:
            days += 1
        cur += timedelta(days=1)
    return days


async def _active_types(db: AsyncSession) -> list[LeaveType]:
    return list(
        (
            await db.execute(
                select(LeaveType)
                .where(LeaveType.active.is_(True))
                .order_by(LeaveType.sort, LeaveType.name)
            )
        ).scalars().all()
    )


async def _default_type_id(db: AsyncSession) -> uuid.UUID | None:
    """Untyped leave requests/balances fall back to this (Annual / first)."""
    types = await _active_types(db)
    return types[0].id if types else None


async def _overrides(db: AsyncSession, year: int) -> dict[tuple, int]:
    """(user_id, leave_type_id) -> entitlement override for the year."""
    rows = (
        await db.execute(
            select(
                LeaveBalance.user_id, LeaveBalance.leave_type_id, LeaveBalance.entitlement_days
            ).where(LeaveBalance.year == year)
        )
    ).all()
    return {(r[0], r[1]): r[2] for r in rows}


def _request_days(lv: ApprovalRequest, holidays: set[date]) -> float:
    """Working days a leave request consumes, honouring the half-day flag."""
    days = _working_days(lv.start_date, lv.end_date or lv.start_date, holidays)
    if getattr(lv, "half_day", False) and days >= 1:
        # A half-day is always taken on a single working day.
        return 0.5
    return float(days)


async def _usage(
    db: AsyncSession, year: int, holidays: set[date], default_type: uuid.UUID | None
) -> dict[tuple, list[float]]:
    """(user_id, type_id) -> [approved_days, pending_days] for the year."""
    leaves = (
        await db.execute(
            select(ApprovalRequest).where(
                ApprovalRequest.type == "leave",
                ApprovalRequest.status.in_(("approved", "pending")),
                ApprovalRequest.start_date.is_not(None),
            )
        )
    ).scalars().all()
    out: dict[tuple, list[float]] = {}
    for lv in leaves:
        if not (lv.start_date and lv.start_date.year == year and lv.requester_id):
            continue
        tid = lv.leave_type_id or default_type
        days = _request_days(lv, holidays)
        agg = out.setdefault((lv.requester_id, tid), [0.0, 0.0])
        agg[0 if lv.status == "approved" else 1] += days
    return out


def _accrued(entitlement: float, accrual_period: str, today: date) -> float:
    """Entitlement earned by today, per the type's accrual schedule.

    ``annual`` makes the full entitlement available immediately; ``monthly``
    accrues 1/12 of it per elapsed month of the year.
    """
    if entitlement <= 0:
        return 0.0
    if accrual_period == "monthly":
        return round(entitlement * (today.month / 12), 2)
    return float(entitlement)


async def _carryover(
    db: AsyncSession,
    year: int,
    types: list[LeaveType],
    holidays: set[date],
    default_type: uuid.UUID | None,
) -> dict[tuple, float]:
    """(user_id, type_id) -> unused days carried from the prior year (uncapped).

    The per-type ``carryover_max`` cap is applied later in ``_balance_for``.
    """
    prev = year - 1
    prev_overrides = await _overrides(db, prev)
    prev_usage = await _usage(db, prev, holidays, default_type)
    type_by_id = {t.id: t for t in types}
    out: dict[tuple, float] = {}
    for uid, tid in set(prev_usage) | set(prev_overrides):
        t = type_by_id.get(tid)
        if t is None or (t.carryover_max or 0) <= 0:
            continue
        base = prev_overrides.get((uid, tid))
        if base is None:
            base = t.default_days
        used = prev_usage.get((uid, tid), [0.0, 0.0])[0]
        out[(uid, tid)] = max(base - used, 0.0)
    return out


async def _balance_for(
    user: User,
    year: int,
    types: list[LeaveType],
    overrides: dict,
    usage: dict,
    today: date,
    carryover: dict | None = None,
) -> LeaveBalanceOut:
    by_type: list[LeaveTypeBalance] = []
    default_tid = types[0].id if types else None
    carryover = carryover or {}
    top = {"ent": 0.0, "used": 0.0, "rem": 0.0}
    for t in types:
        base = overrides.get((user.id, t.id))
        if base is None and t.id == default_tid:
            # Legacy single-balance rows stored leave_type_id = NULL.
            base = overrides.get((user.id, None))
        if base is None:
            base = t.default_days
        carried = min(carryover.get((user.id, t.id), 0.0), float(t.carryover_max or 0))
        ent = base + carried
        used, pending = usage.get((user.id, t.id), [0.0, 0.0])
        remaining = ent - used
        by_type.append(
            LeaveTypeBalance(
                leave_type_id=t.id, name=t.name, color=t.color, paid=t.paid,
                entitlement_days=ent, carryover_days=carried,
                accrued_days=_accrued(ent, t.accrual_period, today),
                used_days=used, pending_days=pending, remaining_days=remaining,
            )
        )
        # Top-level fields mirror the primary (default/Annual) type for
        # backward compatibility with the simple balance view.
        if t.id == default_tid:
            top = {"ent": ent, "used": used, "rem": remaining}
    return LeaveBalanceOut(
        user_id=user.id,
        user_name=user.display_name or user.email,
        year=year,
        entitlement_days=top["ent"],
        used_days=top["used"],
        remaining_days=top["rem"],
        by_type=by_type,
    )


# ---- Leave types (admin-managed) -----------------------------------------
@router.get("/types", response_model=list[LeaveTypeOut])
async def list_types(
    include_inactive: bool = False,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    stmt = select(LeaveType).order_by(LeaveType.sort, LeaveType.name)
    if not include_inactive:
        stmt = stmt.where(LeaveType.active.is_(True))
    return (await db.execute(stmt)).scalars().all()


@router.post("/types", response_model=LeaveTypeOut, status_code=201)
async def create_type(
    payload: LeaveTypeCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="Admins only")
    if not payload.name.strip():
        raise HTTPException(status_code=422, detail="Name is required")
    t = LeaveType(**payload.model_dump())
    db.add(t)
    await db.commit()
    await db.refresh(t)
    return t


@router.patch("/types/{type_id}", response_model=LeaveTypeOut)
async def update_type(
    type_id: uuid.UUID,
    payload: LeaveTypeUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="Admins only")
    t = await db.get(LeaveType, type_id)
    if not t:
        raise HTTPException(status_code=404, detail="Leave type not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(t, field, value)
    await db.commit()
    await db.refresh(t)
    return t


@router.delete("/types/{type_id}", status_code=204)
async def delete_type(
    type_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="Admins only")
    t = await db.get(LeaveType, type_id)
    if t:
        # Soft-delete: keep historical requests intact.
        t.active = False
        await db.commit()


# ---- Holiday calendar ----------------------------------------------------
@router.get("/holidays", response_model=list[HolidayOut])
async def list_holidays(
    year: int | None = None,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    holidays = (await db.execute(select(Holiday).order_by(Holiday.day))).scalars().all()
    if year:
        holidays = [h for h in holidays if h.day.year == year]
    return holidays


@router.post("/holidays", response_model=HolidayOut, status_code=201)
async def add_holiday(
    payload: HolidayCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="Admins only")
    existing = (
        await db.execute(select(Holiday).where(Holiday.day == payload.day))
    ).scalar_one_or_none()
    if existing:
        existing.name = payload.name
        await db.commit()
        await db.refresh(existing)
        return existing
    h = Holiday(day=payload.day, name=payload.name)
    db.add(h)
    await db.commit()
    await db.refresh(h)
    return h


@router.delete("/holidays/{holiday_id}", status_code=204)
async def delete_holiday(
    holiday_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="Admins only")
    h = await db.get(Holiday, holiday_id)
    if h:
        await db.delete(h)
        await db.commit()


# ---- Balances ------------------------------------------------------------
@router.get("/balance", response_model=LeaveBalanceOut)
async def my_balance(
    db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)
):
    year = date.today().year
    types = await _active_types(db)
    holidays = await _holidays(db)
    default_type = types[0].id if types else None
    overrides = await _overrides(db, year)
    usage = await _usage(db, year, holidays, default_type)
    carryover = await _carryover(db, year, types, holidays, default_type)
    return await _balance_for(user, year, types, overrides, usage, date.today(), carryover)


@router.get("/balances", response_model=list[LeaveBalanceOut])
async def all_balances(
    db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)
):
    if not (user.is_admin or user.role == "manager"):
        raise HTTPException(status_code=403, detail="Managers only")
    year = date.today().year
    types = await _active_types(db)
    holidays = await _holidays(db)
    default_type = types[0].id if types else None
    overrides = await _overrides(db, year)
    usage = await _usage(db, year, holidays, default_type)
    carryover = await _carryover(db, year, types, holidays, default_type)
    users = (
        await db.execute(select(User).where(User.status == "active").order_by(User.display_name))
    ).scalars().all()
    return [
        await _balance_for(u, year, types, overrides, usage, date.today(), carryover)
        for u in users
    ]


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
    type_id = payload.leave_type_id or await _default_type_id(db)
    row = (
        await db.execute(
            select(LeaveBalance).where(
                LeaveBalance.user_id == user_id,
                LeaveBalance.year == year,
                LeaveBalance.leave_type_id == type_id,
            )
        )
    ).scalar_one_or_none()
    if row:
        row.entitlement_days = payload.entitlement_days
    else:
        db.add(
            LeaveBalance(
                user_id=user_id, year=year, leave_type_id=type_id,
                entitlement_days=payload.entitlement_days,
            )
        )
    record(
        db, user=admin, action="updated", entity_type="user", entity_id=user_id,
        summary="Updated leave entitlement",
    )
    await db.commit()
    target = await db.get(User, user_id)
    types = await _active_types(db)
    holidays = await _holidays(db)
    default_type = types[0].id if types else None
    overrides = await _overrides(db, year)
    usage = await _usage(db, year, holidays, default_type)
    carryover = await _carryover(db, year, types, holidays, default_type)
    return await _balance_for(target, year, types, overrides, usage, date.today(), carryover)


def _ics_escape(text: str) -> str:
    return text.replace("\\", "\\\\").replace(",", "\\,").replace(";", "\\;").replace("\n", "\\n")


@router.get("/calendar.ics")
async def calendar_feed(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """An iCal feed of company holidays plus approved leave (subscribe in any
    calendar app). All-day VEVENTs use exclusive DTEND per the spec."""
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Company Tools//Leave//EN",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        "X-WR-CALNAME:Company Leave & Holidays",
    ]

    holidays = (await db.execute(select(Holiday).order_by(Holiday.day))).scalars().all()
    for h in holidays:
        end = h.day + timedelta(days=1)
        lines += [
            "BEGIN:VEVENT",
            f"UID:holiday-{h.id}@company-tools",
            f"DTSTAMP:{stamp}",
            f"DTSTART;VALUE=DATE:{h.day:%Y%m%d}",
            f"DTEND;VALUE=DATE:{end:%Y%m%d}",
            f"SUMMARY:{_ics_escape(h.name)} (Holiday)",
            "TRANSP:TRANSPARENT",
            "END:VEVENT",
        ]

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
    for lv in leaves:
        start = lv.start_date
        end = (lv.end_date or lv.start_date) + timedelta(days=1)
        who = names.get(lv.requester_id) if lv.requester_id else "Someone"
        suffix = " (½ day)" if lv.half_day else ""
        lines += [
            "BEGIN:VEVENT",
            f"UID:leave-{lv.id}@company-tools",
            f"DTSTAMP:{stamp}",
            f"DTSTART;VALUE=DATE:{start:%Y%m%d}",
            f"DTEND;VALUE=DATE:{end:%Y%m%d}",
            f"SUMMARY:{_ics_escape(f'{who} — {lv.title}{suffix}')}",
            "END:VEVENT",
        ]

    lines.append("END:VCALENDAR")
    body = "\r\n".join(lines) + "\r\n"
    return Response(
        content=body,
        media_type="text/calendar",
        headers={"Content-Disposition": 'attachment; filename="leave.ics"'},
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
    type_rows = (
        await db.execute(select(LeaveType.id, LeaveType.name, LeaveType.color))
    ).all()
    type_map = {r[0]: (r[1], r[2]) for r in type_rows}
    out = []
    for lv in leaves:
        start = lv.start_date
        end = lv.end_date or lv.start_date
        if start and end and end >= today and start <= until:
            tinfo = type_map.get(lv.leave_type_id)
            out.append(
                WhosOutItem(
                    user_id=lv.requester_id,
                    user_name=names.get(lv.requester_id) if lv.requester_id else None,
                    title=lv.title,
                    leave_type_name=tinfo[0] if tinfo else None,
                    color=tinfo[1] if tinfo else None,
                    start_date=start,
                    end_date=end,
                )
            )
    return out
