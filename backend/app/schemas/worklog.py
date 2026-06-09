import uuid
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict


# ---- Work log ----
class WorkLogCreate(BaseModel):
    minutes: int
    description: str
    kind: str = "other"
    work_date: date | None = None
    entity_type: str | None = None
    entity_id: uuid.UUID | None = None


class WorkLogUpdate(BaseModel):
    minutes: int | None = None
    description: str | None = None
    kind: str | None = None
    work_date: date | None = None


class WorkLogOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    user_id: uuid.UUID
    user_name: str | None = None
    work_date: date
    minutes: int
    description: str
    kind: str
    entity_type: str | None = None
    entity_id: uuid.UUID | None = None
    entity_label: str | None = None
    created_at: datetime


class WorkLogSummary(BaseModel):
    total_minutes: int = 0
    entries: int = 0
    by_kind: dict[str, int] = {}
    by_day: dict[str, int] = {}
    by_user: dict[str, int] = {}


# ---- Workspace (My Docs) ----
class WorkspaceCreate(BaseModel):
    kind: str = "note"  # note | link
    title: str
    body: str | None = None
    url: str | None = None
    tags: str | None = None
    pinned: bool = False
    shared: bool = False


class WorkspaceUpdate(BaseModel):
    title: str | None = None
    body: str | None = None
    url: str | None = None
    tags: str | None = None
    pinned: bool | None = None
    shared: bool | None = None


class WorkspaceItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    owner_id: uuid.UUID
    owner_name: str | None = None
    kind: str
    title: str
    body: str | None = None
    url: str | None = None
    content_type: str | None = None
    size_bytes: int = 0
    tags: str | None = None
    pinned: bool
    shared: bool
    created_at: datetime
    updated_at: datetime
