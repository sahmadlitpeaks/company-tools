import uuid
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict


class GoalOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    user_id: uuid.UUID
    title: str
    description: str | None = None
    status: str
    progress: int
    due_date: date | None = None
    created_by_id: uuid.UUID | None = None
    created_at: datetime


class GoalCreate(BaseModel):
    title: str
    description: str | None = None
    status: str = "open"
    progress: int = 0
    due_date: date | None = None


class GoalUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    status: str | None = None
    progress: int | None = None
    due_date: date | None = None


class CycleOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    period: str | None = None
    status: str
    due_date: date | None = None
    created_at: datetime
    review_count: int = 0
    submitted_count: int = 0


class CycleCreate(BaseModel):
    name: str
    period: str | None = None
    due_date: date | None = None


class CycleUpdate(BaseModel):
    name: str | None = None
    period: str | None = None
    status: str | None = None
    due_date: date | None = None


class ReviewOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    cycle_id: uuid.UUID
    cycle_name: str | None = None
    user_id: uuid.UUID
    user_name: str | None = None
    reviewer_id: uuid.UUID | None = None
    reviewer_name: str | None = None
    status: str
    rating: int | None = None
    summary: str | None = None
    submitted_at: date | None = None
    created_at: datetime


class ReviewCreate(BaseModel):
    cycle_id: uuid.UUID
    user_id: uuid.UUID
    reviewer_id: uuid.UUID | None = None


class ReviewUpdate(BaseModel):
    rating: int | None = None
    summary: str | None = None
    status: str | None = None


# ---- 360 feedback on a review ----
class FeedbackRequestIn(BaseModel):
    author_id: uuid.UUID
    relation: str = "peer"


class FeedbackSubmitIn(BaseModel):
    rating: int | None = None
    strengths: str | None = None
    improvements: str | None = None


class ReviewFeedbackOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    review_id: uuid.UUID
    author_id: uuid.UUID
    author_name: str | None = None
    relation: str
    status: str
    rating: int | None = None
    strengths: str | None = None
    improvements: str | None = None
    submitted_at: datetime | None = None
    # Context for the "assigned to me" view.
    subject_name: str | None = None
    cycle_name: str | None = None


# ---- 1:1 meetings ----
class AgendaItem(BaseModel):
    text: str
    done: bool = False


class OneOnOneCreate(BaseModel):
    employee_id: uuid.UUID
    scheduled_at: datetime
    agenda: list[AgendaItem] = []
    shared_notes: str | None = None


class OneOnOneUpdate(BaseModel):
    scheduled_at: datetime | None = None
    status: str | None = None
    agenda: list[AgendaItem] | None = None
    shared_notes: str | None = None


class OneOnOneOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    manager_id: uuid.UUID
    manager_name: str | None = None
    employee_id: uuid.UUID
    employee_name: str | None = None
    scheduled_at: datetime
    status: str
    agenda: list[AgendaItem] = []
    shared_notes: str | None = None


# ---- Continuous feedback ----
class ContinuousFeedbackIn(BaseModel):
    to_user_id: uuid.UUID
    body: str


class ContinuousFeedbackOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    from_user_id: uuid.UUID | None = None
    from_name: str | None = None
    to_user_id: uuid.UUID
    to_name: str | None = None
    body: str
    created_at: datetime
