import uuid
from datetime import date

from pydantic import BaseModel, ConfigDict


class LeaveTypeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    color: str
    paid: bool
    default_days: int
    carryover_max: int
    active: bool
    sort: int


class LeaveTypeCreate(BaseModel):
    name: str
    color: str = "#6366f1"
    paid: bool = True
    default_days: int = 0
    carryover_max: int = 0
    sort: int = 0


class LeaveTypeUpdate(BaseModel):
    name: str | None = None
    color: str | None = None
    paid: bool | None = None
    default_days: int | None = None
    carryover_max: int | None = None
    active: bool | None = None
    sort: int | None = None


class HolidayOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    day: date
    name: str


class HolidayCreate(BaseModel):
    day: date
    name: str


class LeaveTypeBalance(BaseModel):
    leave_type_id: uuid.UUID
    name: str
    color: str
    paid: bool
    entitlement_days: int
    accrued_days: int  # pro-rata of entitlement for the year-to-date
    used_days: int
    pending_days: int
    remaining_days: int


class LeaveBalanceOut(BaseModel):
    user_id: uuid.UUID
    user_name: str | None = None
    year: int
    # Totals across paid leave types (back-compat with the old shape).
    entitlement_days: int
    used_days: int
    remaining_days: int
    by_type: list[LeaveTypeBalance] = []


class LeaveEntitlementIn(BaseModel):
    entitlement_days: int
    leave_type_id: uuid.UUID | None = None
    year: int | None = None


class WhosOutItem(BaseModel):
    user_id: uuid.UUID | None = None
    user_name: str | None = None
    title: str
    leave_type_name: str | None = None
    color: str | None = None
    start_date: date | None = None
    end_date: date | None = None


class CalendarDay(BaseModel):
    day: date
    name: str
    kind: str  # holiday | weekend (weekends omitted by default)
