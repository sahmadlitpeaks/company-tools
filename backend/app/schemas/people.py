import uuid
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict


class EmploymentEventCreate(BaseModel):
    event_type: str = "note"
    effective_date: date | None = None
    title: str
    detail: str | None = None


class EmploymentEventOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    user_id: uuid.UUID
    event_type: str
    effective_date: date
    title: str
    detail: str | None = None
    created_by_id: uuid.UUID | None = None
    created_by_name: str | None = None
    created_at: datetime


class OrgNode(BaseModel):
    id: uuid.UUID
    name: str | None = None
    job_title: str | None = None
    avatar_url: str | None = None
    department_name: str | None = None
    report_count: int = 0
    reports: list["OrgNode"] = []


OrgNode.model_rebuild()


class JourneyCreate(BaseModel):
    kind: str  # onboarding | offboarding
    target_user_id: uuid.UUID
    company_id: uuid.UUID | None = None
    note: str | None = None
    announce: bool = False
    announce_message: str | None = None


class AccessGrantCreate(BaseModel):
    name: str
    system: str | None = None
    username: str | None = None
    notes: str | None = None


class AccessGrantOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    user_id: uuid.UUID
    name: str
    system: str | None = None
    username: str | None = None
    notes: str | None = None
    status: str
    granted_by_id: uuid.UUID | None = None
    revoked_by_id: uuid.UUID | None = None
    revoked_at: datetime | None = None
    created_at: datetime


class AssignAssetIn(BaseModel):
    asset_id: uuid.UUID


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


class PersonSubscription(BaseModel):
    """A subscription the offboarding target is covered by."""

    subscription_id: uuid.UUID
    name: str
    vendor: str | None = None
    # seat | department | company  (only `seat` is individually revocable)
    source: str
    seat_id: uuid.UUID | None = None
    seat_status: str | None = None


class AssignedPhone(BaseModel):
    id: uuid.UUID
    number: str


class ProvisionSuggestion(BaseModel):
    """A thing peers in the same department commonly have that a new hire lacks."""

    kind: str  # subscription | access
    ref_id: uuid.UUID | None = None  # subscription_id for subscriptions
    label: str
    detail: str | None = None  # vendor / system
    peer_count: int = 0
    peer_total: int = 0


class ProvisionSuggestions(BaseModel):
    department_name: str | None = None
    peer_total: int = 0
    auto_covered: list[PersonSubscription] = []
    subscriptions: list[ProvisionSuggestion] = []
    access: list[ProvisionSuggestion] = []


class JourneyOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    kind: str
    status: str
    note: str | None = None
    target_user_id: uuid.UUID | None = None
    target_name: str | None = None
    company_id: uuid.UUID | None = None
    company_name: str | None = None
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
    assigned_phones: list[AssignedPhone] = []
    access_grants: list[AccessGrantOut] = []
    subscriptions: list[PersonSubscription] = []


class AccessAction(BaseModel):
    # disable | activate | revoke_access
    action: str
