import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

LeadStatus = Literal["new", "contacted", "qualified", "proposal", "negotiation", "won", "lost"]
LeadPriority = Literal["high", "medium", "low"]
ActivityKind = Literal["note", "call", "email", "meeting"]


def normalize_tags(tags: list[str] | None) -> list[str] | None:
    """Lowercase, trim and de-duplicate tags, keeping their first-seen order."""
    if tags is None:
        return None
    seen: list[str] = []
    for tag in tags:
        clean = " ".join(str(tag).replace('"', "").split()).lower()[:40]
        if clean and clean not in seen:
            seen.append(clean)
    return seen[:20] or None


class _LeadFields(BaseModel):
    name: str | None = Field(None, max_length=255)
    email: str | None = Field(None, max_length=320)
    phone: str | None = Field(None, max_length=64)
    company: str | None = Field(None, max_length=255)
    owner_id: uuid.UUID | None = None
    value: Decimal | None = Field(None, ge=0, max_digits=12, decimal_places=2)
    notes: str | None = None
    company_id: uuid.UUID | None = None
    priority: LeadPriority | None = None
    tags: list[str] | None = None
    follow_up_date: date | None = None
    next_step: str | None = Field(None, max_length=255)
    expected_close_date: date | None = None
    lost_reason: str | None = Field(None, max_length=255)

    @field_validator("tags")
    @classmethod
    def _tags(cls, value: list[str] | None) -> list[str] | None:
        return normalize_tags(value)


class CrmLeadCreate(_LeadFields):
    source: str = "manual"
    source_detail: str | None = Field(None, max_length=255)
    status: LeadStatus = "new"


class CrmLeadUpdate(_LeadFields):
    status: LeadStatus | None = None


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
    priority: str | None = None
    tags: list[str] | None = None
    follow_up_date: date | None = None
    next_step: str | None = None
    expected_close_date: date | None = None
    lost_reason: str | None = None
    last_contacted_at: datetime | None = None
    # Website provenance, present on leads that arrived through the intake
    # pipeline. `fields` carries everything the form asked that has no column.
    intake_form_id: uuid.UUID | None = None
    page_url: str | None = None
    fields: list[dict] | None = None
    created_at: datetime
    updated_at: datetime | None = None
    # Whether the requesting user may delete this lead (admins and its owner).
    can_delete: bool = False


class CrmSummary(BaseModel):
    total: int
    by_status: dict[str, int]
    by_source: dict[str, int]
    won_value: Decimal
    open_value: Decimal
    # Open leads whose follow-up date is before / on today (UTC).
    overdue: int = 0
    due_today: int = 0


class CrmActivityCreate(BaseModel):
    kind: ActivityKind = "note"
    body: str = Field(..., min_length=1, max_length=10000)

    @field_validator("body")
    @classmethod
    def _body(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Write something to log")
        return value.strip()


class CrmActivityOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    lead_id: uuid.UUID
    kind: str
    body: str
    author_id: uuid.UUID | None = None
    author_name: str | None = None
    created_at: datetime
    can_delete: bool = False


class CrmBulkAction(BaseModel):
    ids: list[uuid.UUID] = Field(..., min_length=1, max_length=500)
    action: Literal["assign", "status", "delete"]
    owner_id: uuid.UUID | None = None
    status: LeadStatus | None = None
    lost_reason: str | None = Field(None, max_length=255)


# Columns an import can fill. `notes` may take several source columns.
ImportField = Literal[
    "name", "email", "phone", "company", "value", "notes", "status", "priority",
    "tags", "next_step", "follow_up_date", "expected_close_date", "lost_reason",
]


class CrmImportIssue(BaseModel):
    row: int
    message: str


class CrmImportRow(BaseModel):
    row: int
    name: str | None = None
    email: str | None = None
    phone: str | None = None
    company: str | None = None
    status: str
    # new | duplicate_in_file | exists | invalid
    match: str


class CrmImportPreview(BaseModel):
    sheets: list[str]
    sheet: str | None = None
    columns: list[str]
    mapping: dict[str, ImportField | None]
    total_rows: int
    valid_rows: int
    duplicates_in_file: int
    existing_matches: int
    errors: list[CrmImportIssue]
    warnings: list[CrmImportIssue]
    sample: list[CrmImportRow]


class CrmImportResult(BaseModel):
    created: int
    merged: int = 0
    skipped: int = 0
    errors: list[CrmImportIssue] = []
