import uuid
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict


class CrmLeadCreate(BaseModel):
    name: str | None = None
    email: str | None = None
    phone: str | None = None
    company: str | None = None
    source: str = "manual"
    source_detail: str | None = None
    status: str = "new"
    owner_id: uuid.UUID | None = None
    value: Decimal | None = None
    notes: str | None = None
    company_id: uuid.UUID | None = None


class CrmLeadUpdate(BaseModel):
    name: str | None = None
    email: str | None = None
    phone: str | None = None
    company: str | None = None
    status: str | None = None
    owner_id: uuid.UUID | None = None
    value: Decimal | None = None
    notes: str | None = None
    company_id: uuid.UUID | None = None


class CrmLeadOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    company_id: uuid.UUID | None = None
    name: str | None = None
    email: str | None = None
    phone: str | None = None
    company: str | None = None
    source: str
    source_detail: str | None = None
    status: str
    owner_id: uuid.UUID | None = None
    owner_name: str | None = None
    value: Decimal | None = None
    notes: str | None = None
    created_at: datetime


class CrmSummary(BaseModel):
    total: int
    by_status: dict[str, int]
    by_source: dict[str, int]
    won_value: Decimal
    open_value: Decimal
