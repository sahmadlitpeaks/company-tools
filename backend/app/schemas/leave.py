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
    accrual_period: str = "annual"
    allow_half_day: bool = True
    active: bool
    sort: int


class LeaveTypeCreate(BaseModel):
    name: str
    color: str = "#6366f1"
    paid: bool = True
    default_days: int = 0
    carryover_max: int = 0
    accrual_period: str = "annual"
    allow_half_day: bool = True
    sort: int = 0


class LeaveTypeUpdate(BaseModel):
    name: str | None = None
    color: str | None = None
    paid: bool | None = None
    default_days: int | None = None
    carryover_max: int | None = None
    accrual_period: str | None = None
    allow_half_day: bool | None = None
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
    entitlement_days: float  # base entitlement + applied carryover
    carryover_days: float = 0  # carried from the prior year (capped)
    accrued_days: float  # earned to-date per the accrual schedule
    used_days: float
    pending_days: float
    remaining_days: float


class LeaveBalanceOut(BaseModel):
    user_id: uuid.UUID
    user_name: str | None = None
    year: int
    # Totals across paid leave types (back-compat with the old shape).
    entitlement_days: float
    used_days: float
    remaining_days: float
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
