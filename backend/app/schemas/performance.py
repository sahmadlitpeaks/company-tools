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
