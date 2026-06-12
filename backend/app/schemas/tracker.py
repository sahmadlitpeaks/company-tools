import uuid
from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict


# ---- Tracked assets ----
class TrackedAssetBase(BaseModel):
    asset_tag: str
    name: str
    category: str | None = None
    location: str | None = None
    serial_number: str | None = None
    notes: str | None = None
    condition: str | None = None
    company_id: uuid.UUID | None = None
    purchase_date: date | None = None
    purchase_cost: Decimal | None = None
    vendor: str | None = None
    warranty_expiry: date | None = None
    useful_life_years: int | None = None
    next_maintenance_date: date | None = None
    maintenance_interval_days: int | None = None


class TrackedAssetCreate(TrackedAssetBase):
    status: str = "available"
    assigned_to_id: uuid.UUID | None = None


class TrackedAssetUpdate(BaseModel):
    asset_tag: str | None = None
    name: str | None = None
    category: str | None = None
    status: str | None = None
    location: str | None = None
    serial_number: str | None = None
    notes: str | None = None
    condition: str | None = None
    company_id: uuid.UUID | None = None
    assigned_to_id: uuid.UUID | None = None
    purchase_date: date | None = None
    purchase_cost: Decimal | None = None
    vendor: str | None = None
    warranty_expiry: date | None = None
    useful_life_years: int | None = None
    next_maintenance_date: date | None = None
    maintenance_interval_days: int | None = None


class TrackedAssetOut(TrackedAssetBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    status: str
    assigned_to_id: uuid.UUID | None = None
    assigned_to_name: str | None = None
    assigned_to_title: str | None = None
    # Straight-line depreciated value as of today (None if cost/life unknown).
    current_book_value: Decimal | None = None
    disposal_date: date | None = None
    salvage_value: Decimal | None = None
    disposal_notes: str | None = None
    attachment_count: int = 0
    created_at: datetime


class NamedItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str


class NamedItemCreate(BaseModel):
    name: str


class RetireRequest(BaseModel):
    disposal_date: date | None = None
    salvage_value: Decimal | None = None
    disposal_notes: str | None = None


class ConditionRequest(BaseModel):
    condition: str
    note: str | None = None


class BulkAssetAction(BaseModel):
    ids: list[uuid.UUID]
    action: str  # checkin | retire | set_location | set_category | delete
    value: str | None = None


class AssetAttachmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    asset_id: uuid.UUID
    kind: str
    name: str
    content_type: str | None = None
    size_bytes: int
    created_at: datetime


class AssignmentSpan(BaseModel):
    user_id: uuid.UUID | None = None
    user_name: str | None = None
    checked_out_at: datetime
    checked_in_at: datetime | None = None
    note: str | None = None


class AssetSummary(BaseModel):
    total: int
    by_status: dict[str, int]
    total_purchase_cost: Decimal
    total_book_value: Decimal


# ---- Events / actions ----
class AssetEventOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    asset_id: uuid.UUID
    event_type: str
    user_id: uuid.UUID | None = None
    user_name: str | None = None
    note: str | None = None
    cost: Decimal | None = None
    performed_by_id: uuid.UUID | None = None
    performed_by_name: str | None = None
    created_at: datetime


class CheckoutRequest(BaseModel):
    user_id: uuid.UUID
    note: str | None = None


class CheckinRequest(BaseModel):
    note: str | None = None


class MaintenanceRequest(BaseModel):
    note: str
    cost: Decimal | None = None
    # When true the asset is moved into the "maintenance" status.
    set_in_maintenance: bool = False
    # Optionally schedule the next service this many days out.
    schedule_next_days: int | None = None
