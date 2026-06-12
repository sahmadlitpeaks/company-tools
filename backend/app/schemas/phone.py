import uuid
from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict


# ---- Phone lines ----
class PhoneLineBase(BaseModel):
    number: str
    carrier: str | None = None
    plan_name: str | None = None
    sim_number: str | None = None
    monthly_cost: Decimal | None = None
    data_allowance: str | None = None
    company_id: uuid.UUID | None = None
    contract_start: date | None = None
    contract_end: date | None = None
    notes: str | None = None


class PhoneLineCreate(PhoneLineBase):
    status: str = "available"
    assigned_to_id: uuid.UUID | None = None


class PhoneLineUpdate(BaseModel):
    number: str | None = None
    carrier: str | None = None
    plan_name: str | None = None
    sim_number: str | None = None
    monthly_cost: Decimal | None = None
    data_allowance: str | None = None
    status: str | None = None
    company_id: uuid.UUID | None = None
    assigned_to_id: uuid.UUID | None = None
    contract_start: date | None = None
    contract_end: date | None = None
    notes: str | None = None


class PhoneLineOut(PhoneLineBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    status: str
    assigned_to_id: uuid.UUID | None = None
    assigned_to_name: str | None = None
    assigned_to_title: str | None = None
    bill_count: int = 0
    created_at: datetime


class PhoneLineEventOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    line_id: uuid.UUID
    event_type: str
    user_id: uuid.UUID | None = None
    user_name: str | None = None
    note: str | None = None
    performed_by_id: uuid.UUID | None = None
    performed_by_name: str | None = None
    created_at: datetime


class PhoneBillCreate(BaseModel):
    period: str  # "YYYY-MM"
    amount: Decimal | None = None
    data_used: str | None = None
    status: str = "unpaid"
    note: str | None = None


class PhoneBillOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    line_id: uuid.UUID
    period: str
    amount: Decimal | None = None
    data_used: str | None = None
    status: str
    note: str | None = None
    created_at: datetime


class PhoneLineDetail(PhoneLineOut):
    events: list[PhoneLineEventOut] = []
    bills: list[PhoneBillOut] = []


class PhoneAssignRequest(BaseModel):
    user_id: uuid.UUID
    note: str | None = None


class PhoneUnassignRequest(BaseModel):
    note: str | None = None


class PhoneStatusRequest(BaseModel):
    status: str  # available | suspended | cancelled | assigned
    note: str | None = None


class PhoneSummary(BaseModel):
    total: int
    by_status: dict[str, int]
    assigned: int
    monthly_cost: Decimal
