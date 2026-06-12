import uuid
from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict


class SeatOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    user_id: uuid.UUID
    user_name: str | None = None
    user_title: str | None = None
    status: str
    revoked_at: datetime | None = None
    created_at: datetime


class SubscriptionBase(BaseModel):
    name: str
    vendor: str | None = None
    plan: str | None = None
    url: str | None = None
    status: str = "active"
    scope: str = "person"
    department_id: uuid.UUID | None = None
    cost_type: str = "flat"
    cost: Decimal | None = None
    currency: str = "USD"
    billing_cycle: str = "monthly"
    start_date: date | None = None
    end_date: date | None = None
    auto_renew: bool = True
    owner_id: uuid.UUID | None = None
    company_id: uuid.UUID | None = None
    notes: str | None = None


class SubscriptionCreate(SubscriptionBase):
    # Optional people to seat immediately (for scope=person).
    user_ids: list[uuid.UUID] = []


class SubscriptionUpdate(BaseModel):
    name: str | None = None
    vendor: str | None = None
    plan: str | None = None
    url: str | None = None
    status: str | None = None
    scope: str | None = None
    department_id: uuid.UUID | None = None
    cost_type: str | None = None
    cost: Decimal | None = None
    currency: str | None = None
    billing_cycle: str | None = None
    start_date: date | None = None
    end_date: date | None = None
    auto_renew: bool | None = None
    owner_id: uuid.UUID | None = None
    company_id: uuid.UUID | None = None
    notes: str | None = None


class SubscriptionOut(SubscriptionBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    department_name: str | None = None
    owner_name: str | None = None
    active_seats: int = 0
    # Cost normalised to a monthly figure for spend rollups.
    monthly_cost: Decimal | None = None
    seats: list[SeatOut] = []
    created_at: datetime


class SeatAssign(BaseModel):
    user_ids: list[uuid.UUID]


class SubscriptionSummary(BaseModel):
    total: int = 0
    by_status: dict[str, int] = {}
    monthly_spend: Decimal = Decimal("0")
    renewing_soon: int = 0


class SpendBucket(BaseModel):
    label: str
    monthly: Decimal = Decimal("0")
    count: int = 0


class SubscriptionReport(BaseModel):
    monthly_total: Decimal = Decimal("0")
    annual_total: Decimal = Decimal("0")
    active_seats: int = 0
    by_department: list[SpendBucket] = []
    by_vendor: list[SpendBucket] = []
    by_billing_cycle: list[SpendBucket] = []
    top: list[SpendBucket] = []
