import uuid
from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict


class PayBandOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    level: str | None = None
    min_amount: Decimal | None = None
    max_amount: Decimal | None = None
    currency: str
    note: str | None = None


class PayBandCreate(BaseModel):
    name: str
    level: str | None = None
    min_amount: Decimal | None = None
    max_amount: Decimal | None = None
    currency: str = "USD"
    note: str | None = None


class PayBandUpdate(BaseModel):
    name: str | None = None
    level: str | None = None
    min_amount: Decimal | None = None
    max_amount: Decimal | None = None
    currency: str | None = None
    note: str | None = None


class CompensationRecordOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    user_id: uuid.UUID
    record_type: str
    amount: Decimal
    currency: str
    pay_period: str
    effective_date: date
    band_id: uuid.UUID | None = None
    band_name: str | None = None
    note: str | None = None
    created_by_id: uuid.UUID | None = None
    created_at: datetime


class CompensationCreate(BaseModel):
    record_type: str = "salary"
    amount: Decimal
    currency: str = "USD"
    pay_period: str = "annual"
    effective_date: date | None = None
    band_id: uuid.UUID | None = None
    note: str | None = None


class CompensationSummary(BaseModel):
    """Current salary snapshot for an employee (latest salary record)."""

    user_id: uuid.UUID
    amount: Decimal | None = None
    currency: str | None = None
    pay_period: str | None = None
    effective_date: date | None = None
    band_name: str | None = None
    # Annualised figure for comparison (monthly*12, hourly*2080).
    annualised: Decimal | None = None
