"""Contracts for the Jira-style project tracker (see app/models/pm.py)."""
import uuid
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field


# ---- Projects ----
class PmProjectCreate(BaseModel):
    key: str = Field(min_length=2, max_length=10)
    name: str = Field(min_length=1, max_length=255)
    description: str | None = None
    lead_id: uuid.UUID | None = None
    start_date: date | None = None
    target_date: date | None = None


class PmProjectUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = None
    lead_id: uuid.UUID | None = None
    status: str | None = None
    sprints_enabled: bool | None = None
    start_date: date | None = None
    target_date: date | None = None


class PmProjectOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    key: str
    name: str
    description: str | None = None
    lead_id: uuid.UUID | None = None
    lead_name: str | None = None
    status: str
    sprints_enabled: bool = True
    start_date: date | None = None
    target_date: date | None = None
    created_at: datetime
    # The caller's role on this project; "admin" for platform admins.
    my_role: str | None = None
    issue_count: int = 0
    done_count: int = 0
    member_count: int = 0


class PmMemberIn(BaseModel):
    user_id: uuid.UUID
    role: str = "member"


class PmMemberUpdate(BaseModel):
    role: str


class PmMemberOut(BaseModel):
    user_id: uuid.UUID
    name: str
    email: str | None = None
    role: str


class PmPersonOut(BaseModel):
    id: uuid.UUID
    name: str
    email: str | None = None


# ---- Issues ----
class PmIssueCreate(BaseModel):
    issue_type: str = "task"
    summary: str = Field(min_length=1, max_length=255)
    description: str | None = None
    status: str = "todo"
    priority: str = "medium"
    story_points: float | None = Field(default=None, ge=0, le=1000)
    labels: list[str] = Field(default_factory=list)
    reporter_id: uuid.UUID | None = None
    assignee_id: uuid.UUID | None = None
    parent_id: uuid.UUID | None = None
    sprint_id: uuid.UUID | None = None
    start_date: date | None = None
    due_date: date | None = None


class PmIssueUpdate(BaseModel):
    issue_type: str | None = None
    summary: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = None
    status: str | None = None
    priority: str | None = None
    story_points: float | None = Field(default=None, ge=0, le=1000)
    labels: list[str] | None = None
    reporter_id: uuid.UUID | None = None
    assignee_id: uuid.UUID | None = None
    parent_id: uuid.UUID | None = None
    sprint_id: uuid.UUID | None = None
    start_date: date | None = None
    due_date: date | None = None
    rank: float | None = None


class PmIssueRef(BaseModel):
    id: uuid.UUID
    key: str
    summary: str
    issue_type: str
    status: str


class PmIssueOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    key: str = ""
    project_id: uuid.UUID
    number: int
    issue_type: str
    summary: str
    description: str | None = None
    status: str
    priority: str
    story_points: float | None = None
    labels: list[str] | None = None
    reporter_id: uuid.UUID | None = None
    reporter_name: str | None = None
    assignee_id: uuid.UUID | None = None
    assignee_name: str | None = None
    parent_id: uuid.UUID | None = None
    parent: PmIssueRef | None = None
    sprint_id: uuid.UUID | None = None
    sprint_name: str | None = None
    start_date: date | None = None
    due_date: date | None = None
    resolved_at: datetime | None = None
    rank: float = 0
    created_at: datetime
    updated_at: datetime
    # Children (stories under an epic, sub-tasks under an issue).
    child_count: int = 0
    child_done: int = 0
    comment_count: int = 0


class PmLinkOut(BaseModel):
    id: uuid.UUID
    # blocks | is_blocked_by | relates
    relation: str
    issue: PmIssueRef


class PmWatcherOut(BaseModel):
    user_id: uuid.UUID
    name: str


class PmIssueDetail(PmIssueOut):
    project_key: str = ""
    project_name: str = ""
    my_role: str | None = None
    watching: bool = False
    children: list[PmIssueOut] = Field(default_factory=list)
    links: list[PmLinkOut] = Field(default_factory=list)
    watchers: list[PmWatcherOut] = Field(default_factory=list)


class PmLinkCreate(BaseModel):
    target_id: uuid.UUID
    # blocks | is_blocked_by | relates
    relation: str


class PmWatcherIn(BaseModel):
    user_id: uuid.UUID


# ---- Comments and history ----
class PmCommentIn(BaseModel):
    body: str = Field(min_length=1, max_length=20000)


class PmCommentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    issue_id: uuid.UUID
    author_id: uuid.UUID | None = None
    author_name: str | None = None
    body: str
    created_at: datetime
    updated_at: datetime


class PmHistoryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    actor_id: uuid.UUID | None = None
    actor_name: str | None = None
    field: str
    old_value: str | None = None
    new_value: str | None = None
    created_at: datetime


# ---- Sprints ----
class PmSprintCreate(BaseModel):
    name: str | None = Field(default=None, max_length=120)
    goal: str | None = None
    start_date: date | None = None
    end_date: date | None = None


class PmSprintUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    goal: str | None = None
    start_date: date | None = None
    end_date: date | None = None


class PmSprintStart(BaseModel):
    start_date: date
    end_date: date
    goal: str | None = None


class PmSprintComplete(BaseModel):
    # "backlog" or the id of a future sprint for unfinished issues.
    move_to: str = "backlog"


class PmSprintOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    project_id: uuid.UUID
    name: str
    goal: str | None = None
    status: str
    start_date: date | None = None
    end_date: date | None = None
    started_at: datetime | None = None
    completed_at: datetime | None = None
    committed_points: float | None = None
    completed_points: float | None = None
    issue_count: int = 0
    done_count: int = 0
    points: float = 0
    done_points: float = 0
