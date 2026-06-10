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
    entries: list[TimeEntryOut] = []


class TimesheetDecision(BaseModel):
    status: str  # approved | rejected
    note: str | None = None


class TimeSummary(BaseModel):
    open_entry: TimeEntryOut | None = None
    today_minutes: int = 0
    week_minutes: int = 0
    week_status: str = "open"
    pending_approvals: int = 0
