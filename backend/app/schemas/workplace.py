import uuid
from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict


# ---- Tasks ----
class TaskCreate(BaseModel):
    title: str
    description: str | None = None
    status: str = "todo"
    priority: str = "normal"
    due_date: date | None = None
    assignee_id: uuid.UUID | None = None
    brand_id: uuid.UUID | None = None


class TaskUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    status: str | None = None
    priority: str | None = None
    due_date: date | None = None
    assignee_id: uuid.UUID | None = None
    brand_id: uuid.UUID | None = None


class TaskOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title: str
    description: str | None = None
    status: str
    priority: str
    due_date: date | None = None
    assignee_id: uuid.UUID | None = None
    assignee_name: str | None = None
    created_by_id: uuid.UUID | None = None
    created_by_name: str | None = None
    brand_id: uuid.UUID | None = None
    completed_at: datetime | None = None
    created_at: datetime


# ---- Approvals ----
class ApprovalCreate(BaseModel):
    type: str = "general"
    title: str
    details: str | None = None
    amount: Decimal | None = None
    start_date: date | None = None
    end_date: date | None = None
    approver_id: uuid.UUID | None = None
    brand_id: uuid.UUID | None = None


class ApprovalDecision(BaseModel):
    status: str  # approved | rejected
    note: str | None = None


class ApprovalOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    type: str
    title: str
    details: str | None = None
    amount: Decimal | None = None
    start_date: date | None = None
    end_date: date | None = None
    status: str
    requester_id: uuid.UUID | None = None
    requester_name: str | None = None
    approver_id: uuid.UUID | None = None
    approver_name: str | None = None
    decided_by_id: uuid.UUID | None = None
    decided_by_name: str | None = None
    decided_at: datetime | None = None
    decision_note: str | None = None
    brand_id: uuid.UUID | None = None
    created_at: datetime


# ---- Service desk ----
class TicketCreate(BaseModel):
    subject: str
    description: str | None = None
    category: str = "it"
    priority: str = "normal"
    asset_id: uuid.UUID | None = None
    brand_id: uuid.UUID | None = None


class TicketUpdate(BaseModel):
    subject: str | None = None
    description: str | None = None
    category: str | None = None
    priority: str | None = None
    status: str | None = None
    assignee_id: uuid.UUID | None = None
    asset_id: uuid.UUID | None = None
    brand_id: uuid.UUID | None = None


class TicketCommentCreate(BaseModel):
    body: str


class TicketCommentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    ticket_id: uuid.UUID
    author_id: uuid.UUID | None = None
    author_name: str | None = None
    body: str
    created_at: datetime


class TicketOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    subject: str
    description: str | None = None
    category: str
    priority: str
    status: str
    requester_id: uuid.UUID | None = None
    requester_name: str | None = None
    assignee_id: uuid.UUID | None = None
    assignee_name: str | None = None
    asset_id: uuid.UUID | None = None
    brand_id: uuid.UUID | None = None
    resolved_at: datetime | None = None
    comment_count: int = 0
    created_at: datetime


class TicketDetail(TicketOut):
    comments: list[TicketCommentOut] = []


# ---- Knowledge base ----
class ArticleCreate(BaseModel):
    title: str
    category: str | None = None
    body: str = ""
    is_published: bool = True
    pinned: bool = False
    brand_id: uuid.UUID | None = None


class ArticleUpdate(BaseModel):
    title: str | None = None
    category: str | None = None
    body: str | None = None
    is_published: bool | None = None
    pinned: bool | None = None
    brand_id: uuid.UUID | None = None


class ArticleOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title: str
    category: str | None = None
    body: str
    is_published: bool
    pinned: bool
    view_count: int
    author_id: uuid.UUID | None = None
    author_name: str | None = None
    brand_id: uuid.UUID | None = None
    updated_at: datetime
    created_at: datetime


class ArticleSummary(BaseModel):
    """List view — omits the (potentially large) body."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title: str
    category: str | None = None
    is_published: bool
    pinned: bool
    view_count: int
    author_name: str | None = None
    updated_at: datetime


# ---- My Work (personal home aggregation) ----
class WorkSummary(BaseModel):
    tasks_open: int = 0
    tasks_overdue: int = 0
    approvals_pending: int = 0
    approvals_to_review: int = 0
    tickets_open: int = 0
    tickets_assigned: int = 0
    announcements_unread: int = 0
    my_tasks: list[TaskOut] = []
    my_approvals: list[ApprovalOut] = []
    review_approvals: list[ApprovalOut] = []
    my_tickets: list[TicketOut] = []
