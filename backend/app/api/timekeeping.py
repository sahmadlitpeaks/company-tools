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
from app.models.timekeeping import (
    TimeBreak,
    TimeCorrectionRequest,
    TimeEntry,
    Timesheet,
    WorkSchedule,
)
from app.models.user import User
from app.models.workplace import ApprovalRequest
from app.schemas.timekeeping import (
    AssignSchedule,
    ScheduleCreate,
    ScheduleOut,
    ScheduleUpdate,
    TimeBreakOut,
    TimeCorrectionCreate,
    TimeCorrectionDecision,
    TimeCorrectionOut,
    TimeEntryCreate,
    TimeEntryOut,
    TimeEntryUpdate,
    TimeSummary,
    TimeTodayResetOut,
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


def _utc(dt: datetime) -> datetime:
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _duration_minutes(start: datetime, end: datetime) -> int:
    return max(0, int((_utc(end) - _utc(start)).total_seconds() // 60))


def _duration_seconds(start: datetime, end: datetime) -> int:
    return max(0, int((_utc(end) - _utc(start)).total_seconds()))


async def _break_minutes(
    db: AsyncSession, entry_id: uuid.UUID, *, until: datetime | None = None
) -> int:
    rows = (
        await db.execute(select(TimeBreak).where(TimeBreak.entry_id == entry_id))
    ).scalars().all()
    now = until or datetime.now(timezone.utc)
    return sum(_duration_minutes(row.started_at, row.ended_at or now) for row in rows)


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
        active_break = (
            await db.execute(
                select(TimeBreak).where(
                    TimeBreak.entry_id == open_entry.id,
                    TimeBreak.ended_at.is_(None),
                )
            )
        ).scalar_one_or_none()
        if active_break:
            active_break.ended_at = now
        open_entry.clock_out = now
        ci = open_entry.clock_in
        gross = _duration_minutes(ci, now) if ci else 0
        open_entry.minutes = max(0, gross - await _break_minutes(db, open_entry.id, until=now))
        entry = open_entry
    else:
        entry = TimeEntry(
            user_id=user.id, work_date=today, clock_in=now, source="clock", minutes=0
        )
        db.add(entry)
    await db.commit()
    await db.refresh(entry)
    return TimeEntryOut.model_validate(entry)


@router.post("/break", response_model=TimeBreakOut)
async def toggle_break(
    db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)
):
    """Start or end a break inside the caller's active clock entry."""
    open_entry = (
        await db.execute(
            select(TimeEntry).where(
                TimeEntry.user_id == user.id,
                TimeEntry.clock_in.is_not(None),
                TimeEntry.clock_out.is_(None),
            )
        )
    ).scalar_one_or_none()
    if not open_entry:
        raise HTTPException(status_code=409, detail="Clock in before starting a break")
    active = (
        await db.execute(
            select(TimeBreak).where(
                TimeBreak.entry_id == open_entry.id,
                TimeBreak.ended_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    now = datetime.now(timezone.utc)
    if active:
        active.ended_at = now
        row = active
    else:
        row = TimeBreak(
            entry_id=open_entry.id,
            user_id=user.id,
            started_at=now,
        )
        db.add(row)
    await db.commit()
    await db.refresh(row)
    return row


def _correction_out(row: TimeCorrectionRequest, name: str | None = None) -> TimeCorrectionOut:
    out = TimeCorrectionOut.model_validate(row)
    out.user_name = name
    return out


@router.post("/corrections", response_model=TimeCorrectionOut, status_code=201)
async def request_correction(
    body: TimeCorrectionCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    entry = await db.get(TimeEntry, body.entry_id)
    if not entry or entry.user_id != user.id:
        raise HTTPException(status_code=404, detail="Entry not found")
    if not body.reason.strip():
        raise HTTPException(status_code=422, detail="Explain why the entry needs changing")
    if body.requested_minutes is not None and body.requested_minutes < 0:
        raise HTTPException(status_code=422, detail="Minutes cannot be negative")
    pending = (
        await db.execute(
            select(TimeCorrectionRequest).where(
                TimeCorrectionRequest.entry_id == entry.id,
                TimeCorrectionRequest.status == "pending",
            )
        )
    ).scalar_one_or_none()
    if pending:
        raise HTTPException(status_code=409, detail="A correction is already pending")
    approval = ApprovalRequest(
        type="time_correction",
        title=f"Time correction for {entry.work_date.isoformat()}",
        details=body.reason.strip(),
        requester_id=user.id,
        approver_id=user.manager_id,
    )
    db.add(approval)
    await db.flush()
    row = TimeCorrectionRequest(
        entry_id=entry.id,
        user_id=user.id,
        approval_request_id=approval.id,
        requested_clock_in=body.requested_clock_in,
        requested_clock_out=body.requested_clock_out,
        requested_minutes=body.requested_minutes,
        reason=body.reason.strip(),
    )
    db.add(row)
    if user.manager_id:
        await notify_user(
            db,
            user_id=user.manager_id,
            title="Time correction to review",
            body=f"{user.display_name or user.email} requested a time-entry correction.",
            link="/time",
            category="approval",
        )
    record(
        db,
        user=user,
        action="created",
        entity_type="time_correction",
        entity_id=row.id,
        summary=f"Requested a time correction for {entry.work_date.isoformat()}",
    )
    await db.commit()
    await db.refresh(row)
    return _correction_out(row, user.display_name or user.email)


@router.get("/corrections", response_model=list[TimeCorrectionOut])
async def list_corrections(
    scope: str = "mine",
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    stmt = select(TimeCorrectionRequest).order_by(TimeCorrectionRequest.created_at.desc())
    if scope == "review":
        if not (is_hr(user) or user.role == "manager"):
            raise HTTPException(status_code=403, detail="Manager or HR access required")
        if not is_hr(user):
            reports = select(User.id).where(User.manager_id == user.id)
            stmt = stmt.where(TimeCorrectionRequest.user_id.in_(reports))
        stmt = stmt.where(TimeCorrectionRequest.status == "pending")
    else:
        stmt = stmt.where(TimeCorrectionRequest.user_id == user.id)
    rows = (await db.execute(stmt)).scalars().all()
    labels = await user_labels(db, {r.user_id for r in rows})
    return [
        _correction_out(r, (labels.get(r.user_id) or {}).get("name"))
        for r in rows
    ]


@router.post("/corrections/{correction_id}/decision", response_model=TimeCorrectionOut)
async def decide_correction(
    correction_id: uuid.UUID,
    body: TimeCorrectionDecision,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    row = await db.get(TimeCorrectionRequest, correction_id)
    if not row:
        raise HTTPException(status_code=404, detail="Correction not found")
    target = await db.get(User, row.user_id)
    if not (is_hr(user) or (target and target.manager_id == user.id)):
        raise HTTPException(status_code=403, detail="Only the manager or HR can decide")
    if row.status != "pending":
        raise HTTPException(status_code=409, detail="Already decided")
    if body.status not in {"approved", "rejected"}:
        raise HTTPException(status_code=422, detail="Invalid decision")
    entry = await db.get(TimeEntry, row.entry_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")
    if body.status == "approved":
        if row.requested_clock_in is not None:
            entry.clock_in = row.requested_clock_in
        if row.requested_clock_out is not None:
            entry.clock_out = row.requested_clock_out
        if row.requested_minutes is not None:
            entry.minutes = row.requested_minutes
        elif entry.clock_in and entry.clock_out:
            entry.minutes = max(
                0,
                _duration_minutes(entry.clock_in, entry.clock_out)
                - await _break_minutes(db, entry.id, until=entry.clock_out),
            )
        entry.source = "manual"
    row.status = body.status
    row.decided_by_id = user.id
    row.decided_at = datetime.now(timezone.utc)
    row.decision_note = body.note
    if row.approval_request_id:
        approval = await db.get(ApprovalRequest, row.approval_request_id)
        if approval and approval.status == "pending":
            approval.status = body.status
            approval.decided_by_id = user.id
            approval.decided_at = row.decided_at
            approval.decision_note = body.note
    await notify_user(
        db,
        user_id=row.user_id,
        title=f"Time correction {body.status}",
        body=f"Your correction for {entry.work_date.isoformat()} was {body.status}.",
        link="/time",
        category="approval",
    )
    record(
        db,
        user=user,
        action="updated",
        entity_type="time_correction",
        entity_id=row.id,
        summary=f"{body.status.title()} a time correction",
    )
    await db.commit()
    await db.refresh(row)
    return _correction_out(row, target.display_name if target else None)


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


@router.delete("/today", response_model=TimeTodayResetOut)
async def reset_today(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Delete the caller's entries for today and reopen the current week.

    This is intentionally self-service and date-scoped. It also clears an open
    clock/break through the entry's database cascades, while retaining any
    linked approval record as cancelled audit history.
    """
    today = date.today()
    week_start = _monday(today)
    entries = (
        await db.execute(
            select(TimeEntry).where(
                TimeEntry.user_id == user.id,
                TimeEntry.work_date == today,
            )
        )
    ).scalars().all()

    entry_ids = [entry.id for entry in entries]
    if entry_ids:
        corrections = (
            await db.execute(
                select(TimeCorrectionRequest).where(
                    TimeCorrectionRequest.entry_id.in_(entry_ids)
                )
            )
        ).scalars().all()
        approval_ids = {
            correction.approval_request_id
            for correction in corrections
            if correction.approval_request_id
        }
        for approval_id in approval_ids:
            approval = await db.get(ApprovalRequest, approval_id)
            if approval and approval.status == "pending":
                approval.status = "cancelled"
                approval.decided_at = datetime.now(timezone.utc)
                approval.decision_note = "Time entry was cleared by its owner."
        for entry in entries:
            await db.delete(entry)

    timesheet = (
        await db.execute(
            select(Timesheet).where(
                Timesheet.user_id == user.id,
                Timesheet.week_start == week_start,
            )
        )
    ).scalar_one_or_none()
    reopened = bool(timesheet and timesheet.status != "open")
    if timesheet:
        timesheet.status = "open"
        timesheet.submitted_at = None
        timesheet.decided_by_id = None
        timesheet.decided_at = None
        timesheet.note = None

    record(
        db,
        user=user,
        action="deleted",
        entity_type="user",
        entity_id=user.id,
        summary=f"Cleared {len(entries)} time entries for {today.isoformat()}",
    )
    await db.commit()
    return TimeTodayResetOut(
        deleted_entries=len(entries),
        reopened_timesheet=reopened,
    )


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
    active_break = None
    today_break_minutes = 0
    today_completed_work_seconds = 0
    today_completed_break_seconds = 0
    open_completed_break_seconds = 0
    today_elapsed_minutes = sum(e.minutes for e in entries if e.work_date == today)
    if open_entry:
        open_break_rows = (
            await db.execute(
                select(TimeBreak).where(
                    TimeBreak.entry_id == open_entry.id,
                )
            )
        ).scalars().all()
        active_break = next((row for row in open_break_rows if row.ended_at is None), None)
        open_completed_break_seconds = sum(
            _duration_seconds(row.started_at, row.ended_at)
            for row in open_break_rows
            if row.ended_at is not None
        )
        today_completed_break_seconds += open_completed_break_seconds
        today_break_minutes = await _break_minutes(db, open_entry.id)
        if open_entry.clock_in:
            today_elapsed_minutes += max(
                0,
                _duration_minutes(open_entry.clock_in, datetime.now(timezone.utc))
                - today_break_minutes,
            )
    closed_today = [e for e in entries if e.work_date == today and e.id != getattr(open_entry, "id", None)]
    closed_break_rows: list[TimeBreak] = []
    if closed_today:
        closed_break_rows = (
            await db.execute(
                select(TimeBreak).where(TimeBreak.entry_id.in_([e.id for e in closed_today]))
            )
        ).scalars().all()
        today_break_minutes += sum(
            _duration_minutes(b.started_at, b.ended_at or datetime.now(timezone.utc))
            for b in closed_break_rows
        )
        today_completed_break_seconds += sum(
            _duration_seconds(b.started_at, b.ended_at)
            for b in closed_break_rows
            if b.ended_at is not None
        )
    break_seconds_by_entry: dict[uuid.UUID, int] = {}
    for row in closed_break_rows:
        break_seconds_by_entry[row.entry_id] = (
            break_seconds_by_entry.get(row.entry_id, 0)
            + _duration_seconds(row.started_at, row.ended_at)
        )
    for entry in closed_today:
        if entry.clock_in and entry.clock_out:
            today_completed_work_seconds += max(
                0,
                _duration_seconds(entry.clock_in, entry.clock_out)
                - break_seconds_by_entry.get(entry.id, 0),
            )
        else:
            today_completed_work_seconds += max(0, entry.minutes * 60)
    week_minutes = sum(e.minutes for e in entries)
    holidays = await _holidays(db)
    sched = await _schedule_for(db, user)
    expected = _expected_minutes(sched, week_start, holidays)
    daily_expected = (
        sched.daily_minutes if sched and sched.daily_minutes else _DEFAULT_DAILY_MINUTES
    )
    today_entries = [e for e in entries if e.work_date == today]
    # All breaks for today's entries (closed + open) for the day timeline bar.
    today_break_rows: list[TimeBreak] = []
    if today_entries:
        today_break_rows = (
            await db.execute(
                select(TimeBreak).where(
                    TimeBreak.entry_id.in_([e.id for e in today_entries])
                )
            )
        ).scalars().all()
    out = TimeSummary(
        open_entry=TimeEntryOut.model_validate(open_entry) if open_entry else None,
        active_break=TimeBreakOut.model_validate(active_break) if active_break else None,
        today_minutes=sum(e.minutes for e in entries if e.work_date == today),
        today_break_minutes=today_break_minutes,
        today_elapsed_minutes=today_elapsed_minutes,
        today_completed_work_seconds=today_completed_work_seconds,
        today_completed_break_seconds=today_completed_break_seconds,
        open_completed_break_seconds=open_completed_break_seconds,
        week_minutes=week_minutes,
        week_expected_minutes=expected,
        week_overtime_minutes=max(week_minutes - expected, 0),
        week_status=await _week_status(db, user.id, week_start),
        today_entries=[TimeEntryOut.model_validate(e) for e in today_entries],
        today_breaks=[TimeBreakOut.model_validate(b) for b in today_break_rows],
        daily_expected_minutes=daily_expected,
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
