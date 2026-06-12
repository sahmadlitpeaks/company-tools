import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict


class SourceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    key: str
    default_type: str
    active: bool
    auto_convert: bool = False
    notify_user_id: uuid.UUID | None = None
    rate_limit_per_min: int = 60
    dedup_window_min: int = 10
    spam_threshold: int | None = None
    clean_threshold: int | None = None
    has_signing_secret: bool = False
    created_at: datetime
    submission_count: int = 0


class SourceCreate(BaseModel):
    name: str
    default_type: str = "lead"
    auto_convert: bool = False
    notify_user_id: uuid.UUID | None = None
    rate_limit_per_min: int = 60
    dedup_window_min: int = 10
    spam_threshold: int | None = None
    clean_threshold: int | None = None


class SourceUpdate(BaseModel):
    name: str | None = None
    default_type: str | None = None
    active: bool | None = None
    auto_convert: bool | None = None
    notify_user_id: uuid.UUID | None = None
    rate_limit_per_min: int | None = None
    dedup_window_min: int | None = None
    spam_threshold: int | None = None
    clean_threshold: int | None = None


class SubmissionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    source_id: uuid.UUID | None = None
    source_name: str | None = None
    type: str
    name: str | None = None
    email: str | None = None
    phone: str | None = None
    company: str | None = None
    subject: str | None = None
    message: str | None = None
    page_url: str | None = None
    payload: dict | None = None
    status: str
    spam_score: int = 0
    spam_reasons: list[str] | None = None
    assignee_id: uuid.UUID | None = None
    assignee_name: str | None = None
    converted_lead_id: uuid.UUID | None = None
    converted_ticket_id: uuid.UUID | None = None
    created_at: datetime


class SubmissionUpdate(BaseModel):
    status: str | None = None
    type: str | None = None
    assignee_id: uuid.UUID | None = None


class IntakeSummary(BaseModel):
    new: int = 0
    by_status: dict[str, int] = {}
    by_type: dict[str, int] = {}


# Public payload is free-form; common fields are mapped, the rest kept in payload.
class IntakeIn(BaseModel):
    type: str | None = None
    name: str | None = None
    email: str | None = None
    phone: str | None = None
    company: str | None = None
    subject: str | None = None
    message: str | None = None
    page_url: str | None = None
    fields: dict[str, Any] | None = None
