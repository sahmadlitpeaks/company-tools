import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict


class JourneyCreate(BaseModel):
    kind: str  # onboarding | offboarding
    target_user_id: uuid.UUID
    note: str | None = None
    announce: bool = False
    announce_message: str | None = None


class TaskCreate(BaseModel):
    title: str
    category: str = "other"
    owner_id: uuid.UUID | None = None


class TaskUpdate(BaseModel):
    title: str | None = None
    category: str | None = None
    status: str | None = None  # pending | done | na
    owner_id: uuid.UUID | None = None


class JourneyTaskOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    journey_id: uuid.UUID
    title: str
    category: str
    status: str
    owner_id: uuid.UUID | None = None
    owner_name: str | None = None
    done_by_id: uuid.UUID | None = None
    done_by_name: str | None = None
    done_at: datetime | None = None
    sort: int = 0


class TargetAccess(BaseModel):
    id: uuid.UUID
    name: str | None = None
    email: str
    status: str
    role: str
    is_admin: bool
    effective_permissions: list[str] = []


class AssignedAsset(BaseModel):
    id: uuid.UUID
    asset_tag: str
    name: str


class JourneyOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    kind: str
    status: str
    note: str | None = None
    target_user_id: uuid.UUID | None = None
    target_name: str | None = None
    created_by_id: uuid.UUID | None = None
    created_by_name: str | None = None
    completed_at: datetime | None = None
    created_at: datetime
    total_tasks: int = 0
    done_tasks: int = 0


class JourneyDetail(JourneyOut):
    tasks: list[JourneyTaskOut] = []
    target: TargetAccess | None = None
    assigned_assets: list[AssignedAsset] = []


class AccessAction(BaseModel):
    # disable | activate | revoke_access
    action: str
