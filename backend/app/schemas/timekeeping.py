import uuid
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict


class TimeEntryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    user_id: uuid.UUID
    work_date: date
    clock_in: datetime | None = None
    clock_out: datetime | None = None
    minutes: int
    kind: str
    note: str | None = None
    source: str


class TimeEntryCreate(BaseModel):
    work_date: date
    minutes: int | None = None
    clock_in: datetime | None = None
    clock_out: datetime | None = None
    kind: str = "work"
    note: str | None = None


class TimeEntryUpdate(BaseModel):
    work_date: date | None = None
    minutes: int | None = None
    kind: str | None = None
    note: str | None = None


class TimeBreakOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    entry_id: uuid.UUID
    user_id: uuid.UUID
    started_at: datetime
    ended_at: datetime | None = None


class TimeCorrectionCreate(BaseModel):
    entry_id: uuid.UUID
    requested_clock_in: datetime | None = None
    requested_clock_out: datetime | None = None
    requested_minutes: int | None = None
    reason: str


class TimeCorrectionDecision(BaseModel):
    status: str
    note: str | None = None


class TimeCorrectionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    entry_id: uuid.UUID
    user_id: uuid.UUID
    user_name: str | None = None
    approval_request_id: uuid.UUID | None = None
    requested_clock_in: datetime | None = None
    requested_clock_out: datetime | None = None
    requested_minutes: int | None = None
    reason: str
    status: str
    decided_by_id: uuid.UUID | None = None
    decided_at: datetime | None = None
    decision_note: str | None = None
    created_at: datetime


class TimesheetOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID | None = None
    user_id: uuid.UUID
    user_name: str | None = None
    week_start: date
    status: str
    submitted_at: datetime | None = None
    decided_by_id: uuid.UUID | None = None
    decided_at: datetime | None = None
    note: str | None = None
    total_minutes: int = 0
    expected_minutes: int = 0
    overtime_minutes: int = 0
    leave_days: float = 0
    entries: list[TimeEntryOut] = []


class TimesheetDecision(BaseModel):
    status: str  # approved | rejected
    note: str | None = None


class TimeSummary(BaseModel):
    open_entry: TimeEntryOut | None = None
    active_break: TimeBreakOut | None = None
    today_minutes: int = 0
    today_break_minutes: int = 0
    today_elapsed_minutes: int = 0
    today_completed_work_seconds: int = 0
    today_completed_break_seconds: int = 0
    open_completed_break_seconds: int = 0
    week_minutes: int = 0
    week_expected_minutes: int = 0
    week_overtime_minutes: int = 0
    week_status: str = "open"
    pending_approvals: int = 0
    # Day-timeline data for Calamari-style progress bar (local UI).
    today_entries: list[TimeEntryOut] = []
    today_breaks: list[TimeBreakOut] = []
    daily_expected_minutes: int = 480


class TimeTodayResetOut(BaseModel):
    deleted_entries: int
    reopened_timesheet: bool


class ScheduleBase(BaseModel):
    name: str
    daily_minutes: int = 480
    workdays: list[int] = [0, 1, 2, 3, 4]
    is_default: bool = False
    active: bool = True


class ScheduleCreate(ScheduleBase):
    pass


class ScheduleUpdate(BaseModel):
    name: str | None = None
    daily_minutes: int | None = None
    workdays: list[int] | None = None
    is_default: bool | None = None
    active: bool | None = None


class ScheduleOut(ScheduleBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    assigned_count: int = 0


class AssignSchedule(BaseModel):
    schedule_id: uuid.UUID | None = None
