import uuid
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict


# ---- Template items ----
class TemplateItemIn(BaseModel):
    section: str | None = None
    title: str
    sort: int = 0
    response_type: str = "ok_issue"
    photo_required: bool = False
    asset_id: uuid.UUID | None = None
    auto_ticket_on_issue: bool = True
    ticket_priority: str = "normal"


class TemplateItemOut(TemplateItemIn):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    template_id: uuid.UUID


# ---- Templates ----
class ChecklistTemplateCreate(BaseModel):
    name: str
    description: str | None = None
    active: bool = True
    team: str = "it"
    schedule: str = "daily"
    days_of_week: list[int] | None = None
    day_of_month: int | None = None
    due_time: str | None = None
    grace_minutes: int = 60
    assignee_id: uuid.UUID | None = None
    assignee_department_id: uuid.UUID | None = None
    reviewer_id: uuid.UUID | None = None
    company_id: uuid.UUID | None = None
    requires_verification: bool = True
    items: list[TemplateItemIn] = []


class ChecklistTemplateUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    active: bool | None = None
    team: str | None = None
    schedule: str | None = None
    days_of_week: list[int] | None = None
    day_of_month: int | None = None
    due_time: str | None = None
    grace_minutes: int | None = None
    assignee_id: uuid.UUID | None = None
    assignee_department_id: uuid.UUID | None = None
    reviewer_id: uuid.UUID | None = None
    company_id: uuid.UUID | None = None
    requires_verification: bool | None = None
    # When provided, replaces the whole item list (same contract as the
    # onboarding template editor).
    items: list[TemplateItemIn] | None = None


class ChecklistTemplateOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    description: str | None = None
    active: bool
    team: str
    schedule: str
    days_of_week: list[int] | None = None
    day_of_month: int | None = None
    due_time: str | None = None
    grace_minutes: int
    assignee_id: uuid.UUID | None = None
    assignee_name: str | None = None
    assignee_department_id: uuid.UUID | None = None
    assignee_department_name: str | None = None
    reviewer_id: uuid.UUID | None = None
    reviewer_name: str | None = None
    company_id: uuid.UUID | None = None
    requires_verification: bool
    item_count: int = 0
    next_run_date: date | None = None
    created_at: datetime
    items: list[TemplateItemOut] = []


# ---- Runs ----
class RunItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    task_id: uuid.UUID
    section: str | None = None
    title: str
    sort: int
    status: str
    note: str | None = None
    response_type: str
    value: str | None = None
    photo_required: bool
    done: bool
    asset_id: uuid.UUID | None = None
    asset_name: str | None = None
    ticket_id: uuid.UUID | None = None
    ticket_number: int | None = None
    responded_by_id: uuid.UUID | None = None
    responded_by_name: str | None = None
    responded_at: datetime | None = None
    photo_count: int = 0


class RunItemUpdate(BaseModel):
    status: str | None = None
    note: str | None = None
    value: str | None = None


class RunOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title: str
    status: str
    run_date: date | None = None
    due_date: date | None = None
    template_id: uuid.UUID | None = None
    template_name: str | None = None
    team: str | None = None
    assignee_id: uuid.UUID | None = None
    assignee_name: str | None = None
    reviewer_id: uuid.UUID | None = None
    reviewer_name: str | None = None
    started_at: datetime | None = None
    submitted_at: datetime | None = None
    verified_at: datetime | None = None
    verified_by_id: uuid.UUID | None = None
    verified_by_name: str | None = None
    review_note: str | None = None
    created_at: datetime
    items_total: int = 0
    items_answered: int = 0
    issues: int = 0
    # Derived: due (with grace) has passed and the run was never submitted.
    is_late: bool = False


class RunDetail(RunOut):
    description: str | None = None
    items: list[RunItemOut] = []


class RunVerify(BaseModel):
    # verify | reject (send back to the checker)
    decision: str = "verify"
    note: str | None = None


class GenerateRequest(BaseModel):
    """Materialise runs for a specific date (defaults to today)."""

    on: date | None = None


class GenerateResult(BaseModel):
    created: int = 0
    run_ids: list[uuid.UUID] = []


# ---- Manager reporting ----
class TemplateCompliance(BaseModel):
    template_id: uuid.UUID
    template_name: str
    team: str
    runs: int = 0
    verified: int = 0
    submitted: int = 0
    open: int = 0
    late: int = 0
    issues: int = 0
    completion_rate: float = 0.0


class IssueHotspot(BaseModel):
    """A checkpoint that keeps failing — the signal paper can't give you."""

    title: str
    section: str | None = None
    asset_id: uuid.UUID | None = None
    asset_name: str | None = None
    issue_count: int = 0
    last_seen: date | None = None


class ComplianceSummary(BaseModel):
    from_date: date
    to_date: date
    runs: int = 0
    verified: int = 0
    late: int = 0
    issues: int = 0
    completion_rate: float = 0.0
    by_template: list[TemplateCompliance] = []
    hotspots: list[IssueHotspot] = []
