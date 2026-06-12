"""Time tracking / attendance: clock in-out, manual entries, weekly timesheets.

Everyone tracks their own time; a person's reporting-line manager and HR can
view and approve their timesheets.
"""
import uuid
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.core.database import get_db
from app.core.permissions import is_hr
from app.models.hr import Holiday
from app.models.timekeeping import TimeEntry, Timesheet, WorkSchedule
from app.models.user import User
from app.models.workplace import ApprovalRequest
from app.schemas.timekeeping import (
    AssignSchedule,
    ScheduleCreate,
    ScheduleOut,
    ScheduleUpdate,
    TimeEntryCreate,
    TimeEntryOut,
    TimeEntryUpdate,
    TimeSummary,
    TimesheetDecision,
    TimesheetOut,
)
from app.services.activity import record
from app.services.notify import notify_user
from app.services.people import user_labels

router = APIRouter(prefix="/time", tags=["time-tracking"])

_DEFAULT_WORKDAYS = [0, 1, 2, 3, 4]
_DEFAULT_DAILY_MINUTES = 480


def _monday(d: date) -> date:
    return d - timedelta(days=d.weekday())


async def _holidays(db: AsyncSession) -> set[date]:
    return set((await db.execute(select(Holiday.day))).scalars().all())


async def _schedule_for(db: AsyncSession, user: User) -> WorkSchedule | None:
    """The user's assigned schedule, falling back to the default one."""
    if getattr(user, "schedule_id", None):
        sched = await db.get(WorkSchedule, user.schedule_id)
        if sched and sched.active:
            return sched
    return (
        await db.execute(
            select(WorkSchedule).where(
                WorkSchedule.is_default.is_(True), WorkSchedule.active.is_(True)
            )
        )
    ).scalar_one_or_none()


def _expected_minutes(sched: WorkSchedule | None, week_start: date, holidays: set[date]) -> int:
    """Expected worked minutes across the week per the schedule, minus holidays."""
    workdays = (sched.workdays if sched and sched.workdays is not None else _DEFAULT_WORKDAYS)
    daily = sched.daily_minutes if sched else _DEFAULT_DAILY_MINUTES
    total = 0
    for i in range(7):
        day = week_start + timedelta(days=i)
        if day.weekday() in workdays and day not in holidays:
            total += daily
    return total


async def _leave_days_in_week(
    db: AsyncSession, user_id: uuid.UUID, week_start: date, holidays: set[date]
) -> float:
    """Approved leave (working days, half-day aware) overlapping the week."""
    week_end = week_start + timedelta(days=6)
    leaves = (
        await db.execute(
            select(ApprovalRequest).where(
                ApprovalRequest.type == "leave",
                ApprovalRequest.status == "approved",
                ApprovalRequest.requester_id == user_id,
                ApprovalRequest.start_date.is_not(None),
            )
        )
    ).scalars().all()
    total = 0.0
    for lv in leaves:
        start = max(lv.start_date, week_start)
        end = min(lv.end_date or lv.start_date, week_end)
        if end < start:
            continue
        days = 0
        cur = start
        while cur <= end:
            if cur.weekday() < 5 and cur not in holidays:
                days += 1
            cur += timedelta(days=1)
        if lv.half_day and days >= 1:
            total += 0.5
        else:
            total += days
    return total


async def _can_view(db: AsyncSession, viewer: User, target_id: uuid.UUID) -> bool:
    if viewer.id == target_id or is_hr(viewer):
        return True
    target = await db.get(User, target_id)
    return bool(target and target.manager_id == viewer.id)


async def _week_status(db: AsyncSession, user_id: uuid.UUID, week_start: date) -> str:
    ts = (
        await db.execute(
            select(Timesheet).where(
                Timesheet.user_id == user_id, Timesheet.week_start == week_start
            )
        )
    ).scalar_one_or_none()
    return ts.status if ts else "open"


def _locked(status: str) -> bool:
    return status in ("submitted", "approved")


# ---- Clock in/out --------------------------------------------------------
@router.post("/clock", response_model=TimeEntryOut)
async def clock(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    """Toggle the clock: close an open entry, or start a new one."""
    today = date.today()
    if _locked(await _week_status(db, user.id, _monday(today))):
        raise HTTPException(status_code=409, detail="This week is already submitted")
    open_entry = (
        await db.execute(
            select(TimeEntry).where(
                TimeEntry.user_id == user.id,
                TimeEntry.clock_in.is_not(None),
                TimeEntry.clock_out.is_(None),
            )
        )
    ).scalar_one_or_none()
    now = datetime.now(timezone.utc)
    if open_entry:
        open_entry.clock_out = now
        ci = open_entry.clock_in
        if ci and ci.tzinfo is None:
            ci = ci.replace(tzinfo=timezone.utc)
        open_entry.minutes = max(0, int((now - ci).total_seconds() // 60)) if ci else 0
        entry = open_entry
    else:
        entry = TimeEntry(
            user_id=user.id, work_date=today, clock_in=now, source="clock", minutes=0
        )
        db.add(entry)
    await db.commit()
    await db.refresh(entry)
    return TimeEntryOut.model_validate(entry)


# ---- Entries -------------------------------------------------------------
@router.get("/entries", response_model=list[TimeEntryOut])
async def list_entries(
    user_id: uuid.UUID | None = None,
    start: date | None = None,
    end: date | None = None,
    db: AsyncSession = Depends(get_db),
    viewer: User = Depends(get_current_user),
):
    target = user_id or viewer.id
    if not await _can_view(db, viewer, target):
        raise HTTPException(status_code=403, detail="Not allowed")
    stmt = select(TimeEntry).where(TimeEntry.user_id == target).order_by(TimeEntry.work_date, TimeEntry.created_at)
    if start:
        stmt = stmt.where(TimeEntry.work_date >= start)
    if end:
        stmt = stmt.where(TimeEntry.work_date <= end)
    return (await db.execute(stmt)).scalars().all()


@router.post("/entries", response_model=TimeEntryOut, status_code=201)
async def add_entry(
    payload: TimeEntryCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if _locked(await _week_status(db, user.id, _monday(payload.work_date))):
        raise HTTPException(status_code=409, detail="That week is already submitted")
    minutes = payload.minutes
    if minutes is None and payload.clock_in and payload.clock_out:
        minutes = max(0, int((payload.clock_out - payload.clock_in).total_seconds() // 60))
    if not minutes or minutes <= 0:
        raise HTTPException(status_code=422, detail="Provide minutes or a clock in/out range")
    entry = TimeEntry(
        user_id=user.id, work_date=payload.work_date, minutes=minutes,
        clock_in=payload.clock_in, clock_out=payload.clock_out,
        kind=payload.kind, note=payload.note, source="manual",
    )
    db.add(entry)
    await db.commit()
    await db.refresh(entry)
    return TimeEntryOut.model_validate(entry)


@router.patch("/entries/{entry_id}", response_model=TimeEntryOut)
async def update_entry(
    entry_id: uuid.UUID,
    payload: TimeEntryUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    entry = await db.get(TimeEntry, entry_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")
    if entry.user_id != user.id:
        raise HTTPException(status_code=403, detail="Not allowed")
    if _locked(await _week_status(db, user.id, _monday(entry.work_date))):
        raise HTTPException(status_code=409, detail="That week is already submitted")
    for f, v in payload.model_dump(exclude_unset=True).items():
        setattr(entry, f, v)
    await db.commit()
    await db.refresh(entry)
    return TimeEntryOut.model_validate(entry)


@router.delete("/entries/{entry_id}", status_code=204)
async def delete_entry(
    entry_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    entry = await db.get(TimeEntry, entry_id)
    if not entry:
        return
    if entry.user_id != user.id and not is_hr(user):
        raise HTTPException(status_code=403, detail="Not allowed")
    if _locked(await _week_status(db, entry.user_id, _monday(entry.work_date))):
        raise HTTPException(status_code=409, detail="That week is already submitted")
    await db.delete(entry)
    await db.commit()


# ---- Timesheets ----------------------------------------------------------
async def _timesheet(db: AsyncSession, user_id: uuid.UUID, week_start: date) -> TimesheetOut:
    entries = (
        await db.execute(
            select(TimeEntry).where(
                TimeEntry.user_id == user_id,
                TimeEntry.work_date >= week_start,
                TimeEntry.work_date < week_start + timedelta(days=7),
            ).order_by(TimeEntry.work_date)
        )
    ).scalars().all()
    ts = (
        await db.execute(
            select(Timesheet).where(
                Timesheet.user_id == user_id, Timesheet.week_start == week_start
            )
        )
    ).scalar_one_or_none()
    total = sum(e.minutes for e in entries)
    target = await db.get(User, user_id)
    holidays = await _holidays(db)
    sched = await _schedule_for(db, target) if target else None
    expected = _expected_minutes(sched, week_start, holidays)
    out = TimesheetOut(
        id=ts.id if ts else None,
        user_id=user_id,
        week_start=week_start,
        status=ts.status if ts else "open",
        submitted_at=ts.submitted_at if ts else None,
        decided_by_id=ts.decided_by_id if ts else None,
        decided_at=ts.decided_at if ts else None,
        note=ts.note if ts else None,
        total_minutes=total,
        expected_minutes=expected,
        overtime_minutes=max(total - expected, 0),
        leave_days=await _leave_days_in_week(db, user_id, week_start, holidays),
        entries=[TimeEntryOut.model_validate(e) for e in entries],
    )
    return out


@router.get("/timesheet", response_model=TimesheetOut)
async def get_timesheet(
    week: date | None = None,
    user_id: uuid.UUID | None = None,
    db: AsyncSession = Depends(get_db),
    viewer: User = Depends(get_current_user),
):
    target = user_id or viewer.id
    if not await _can_view(db, viewer, target):
        raise HTTPException(status_code=403, detail="Not allowed")
    week_start = _monday(week or date.today())
    out = await _timesheet(db, target, week_start)
    names = await user_labels(db, {target})
    out.user_name = (names.get(target) or {}).get("name")
    return out


@router.post("/timesheet/submit", response_model=TimesheetOut)
async def submit_timesheet(
    week: date | None = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    week_start = _monday(week or date.today())
    ts = (
        await db.execute(
            select(Timesheet).where(
                Timesheet.user_id == user.id, Timesheet.week_start == week_start
            )
        )
    ).scalar_one_or_none()
    if ts and ts.status in ("submitted", "approved"):
        raise HTTPException(status_code=409, detail="Already submitted")
    if not ts:
        ts = Timesheet(user_id=user.id, week_start=week_start)
        db.add(ts)
    ts.status = "submitted"
    ts.submitted_at = datetime.now(timezone.utc)
    ts.decided_by_id = None
    ts.decided_at = None
    # Notify the reporting-line manager.
    if user.manager_id:
        await notify_user(
            db, user_id=user.manager_id,
            title="Timesheet to approve",
            body=f"{user.display_name or user.email} submitted their timesheet for week of {week_start.isoformat()}.",
            link="/time", category="approval",
        )
    record(db, user=user, action="updated", entity_type="user", entity_id=user.id,
           summary=f"Submitted timesheet ({week_start.isoformat()})")
    await db.commit()
    return await get_timesheet(week_start, user.id, db, user)


@router.post("/timesheet/{timesheet_id}/decision", response_model=TimesheetOut)
async def decide_timesheet(
    timesheet_id: uuid.UUID,
    payload: TimesheetDecision,
    db: AsyncSession = Depends(get_db),
    viewer: User = Depends(get_current_user),
):
    ts = await db.get(Timesheet, timesheet_id)
    if not ts:
        raise HTTPException(status_code=404, detail="Timesheet not found")
    target = await db.get(User, ts.user_id)
    is_manager = bool(target and target.manager_id == viewer.id)
    if not (is_hr(viewer) or is_manager):
        raise HTTPException(status_code=403, detail="Only the manager or HR can decide")
    if payload.status not in ("approved", "rejected"):
        raise HTTPException(status_code=422, detail="Invalid decision")
    ts.status = payload.status
    ts.decided_by_id = viewer.id
    ts.decided_at = datetime.now(timezone.utc)
    ts.note = payload.note
    await notify_user(
        db, user_id=ts.user_id,
        title=f"Timesheet {payload.status}",
        body=f"Your timesheet for week of {ts.week_start.isoformat()} was {payload.status}.",
        link="/time", category="approval",
    )
    record(db, user=viewer, action="updated", entity_type="user", entity_id=ts.user_id,
           summary=f"Timesheet {payload.status}")
    await db.commit()
    return await get_timesheet(ts.week_start, ts.user_id, db, viewer)


@router.get("/approvals", response_model=list[TimesheetOut])
async def approvals(
    db: AsyncSession = Depends(get_db), viewer: User = Depends(get_current_user)
):
    """Submitted timesheets awaiting this manager (or all, for HR)."""
    stmt = select(Timesheet).where(Timesheet.status == "submitted")
    rows = (await db.execute(stmt.order_by(Timesheet.submitted_at))).scalars().all()
    if not is_hr(viewer):
        reports = {
            u.id for u in (
                await db.execute(select(User).where(User.manager_id == viewer.id))
            ).scalars().all()
        }
        rows = [t for t in rows if t.user_id in reports]
    names = await user_labels(db, {t.user_id for t in rows})
    out = []
    for t in rows:
        item = await _timesheet(db, t.user_id, t.week_start)
        item.user_name = (names.get(t.user_id) or {}).get("name")
        out.append(item)
    return out


@router.get("/summary", response_model=TimeSummary)
async def summary(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    today = date.today()
    week_start = _monday(today)
    entries = (
        await db.execute(
            select(TimeEntry).where(
                TimeEntry.user_id == user.id, TimeEntry.work_date >= week_start
            )
        )
    ).scalars().all()
    open_entry = next((e for e in entries if e.clock_in and not e.clock_out), None)
    week_minutes = sum(e.minutes for e in entries)
    holidays = await _holidays(db)
    sched = await _schedule_for(db, user)
    expected = _expected_minutes(sched, week_start, holidays)
    out = TimeSummary(
        open_entry=TimeEntryOut.model_validate(open_entry) if open_entry else None,
        today_minutes=sum(e.minutes for e in entries if e.work_date == today),
        week_minutes=week_minutes,
        week_expected_minutes=expected,
        week_overtime_minutes=max(week_minutes - expected, 0),
        week_status=await _week_status(db, user.id, week_start),
    )
    pend = await approvals(db, user)
    out.pending_approvals = len(pend)
    return out


# ---- Work schedules (HR) -------------------------------------------------
async def _schedule_out(db: AsyncSession, sched: WorkSchedule) -> ScheduleOut:
    count = await db.scalar(
        select(func.count(User.id)).where(User.schedule_id == sched.id)
    )
    out = ScheduleOut.model_validate(sched)
    out.assigned_count = count or 0
    return out


@router.get("/schedules", response_model=list[ScheduleOut])
async def list_schedules(
    db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)
):
    rows = (
        await db.execute(
            select(WorkSchedule).where(WorkSchedule.active.is_(True)).order_by(WorkSchedule.name)
        )
    ).scalars().all()
    return [await _schedule_out(db, s) for s in rows]


@router.post("/schedules", response_model=ScheduleOut, status_code=201)
async def create_schedule(
    body: ScheduleCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if not is_hr(user):
        raise HTTPException(status_code=403, detail="HR access required")
    sched = WorkSchedule(**body.model_dump())
    db.add(sched)
    await db.flush()
    if sched.is_default:
        await _clear_other_defaults(db, sched.id)
    await db.commit()
    await db.refresh(sched)
    return await _schedule_out(db, sched)


@router.patch("/schedules/{schedule_id}", response_model=ScheduleOut)
async def update_schedule(
    schedule_id: uuid.UUID,
    body: ScheduleUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if not is_hr(user):
        raise HTTPException(status_code=403, detail="HR access required")
    sched = await db.get(WorkSchedule, schedule_id)
    if not sched:
        raise HTTPException(status_code=404, detail="Schedule not found")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(sched, k, v)
    if sched.is_default:
        await _clear_other_defaults(db, sched.id)
    await db.commit()
    await db.refresh(sched)
    return await _schedule_out(db, sched)


@router.delete("/schedules/{schedule_id}", status_code=204)
async def delete_schedule(
    schedule_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if not is_hr(user):
        raise HTTPException(status_code=403, detail="HR access required")
    sched = await db.get(WorkSchedule, schedule_id)
    if sched:
        sched.active = False  # soft-delete keeps history intact
        await db.commit()


async def _clear_other_defaults(db: AsyncSession, keep_id: uuid.UUID) -> None:
    others = (
        await db.execute(
            select(WorkSchedule).where(
                WorkSchedule.is_default.is_(True), WorkSchedule.id != keep_id
            )
        )
    ).scalars().all()
    for o in others:
        o.is_default = False


@router.put("/users/{user_id}/schedule", response_model=ScheduleOut | None)
async def assign_schedule(
    user_id: uuid.UUID,
    body: AssignSchedule,
    db: AsyncSession = Depends(get_db),
    viewer: User = Depends(get_current_user),
):
    if not is_hr(viewer):
        raise HTTPException(status_code=403, detail="HR access required")
    target = await db.get(User, user_id)
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if body.schedule_id and not await db.get(WorkSchedule, body.schedule_id):
        raise HTTPException(status_code=404, detail="Schedule not found")
    target.schedule_id = body.schedule_id
    await db.commit()
    if not body.schedule_id:
        return None
    sched = await db.get(WorkSchedule, body.schedule_id)
    return await _schedule_out(db, sched)
