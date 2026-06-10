import uuid
from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict


class JobBase(BaseModel):
    title: str
    department_id: uuid.UUID | None = None
    company_id: uuid.UUID | None = None
    location: str | None = None
    employment_type: str | None = None
    description: str | None = None
    status: str = "open"
    openings: int = 1
    hiring_manager_id: uuid.UUID | None = None


class JobCreate(JobBase):
    pass


class JobUpdate(BaseModel):
    title: str | None = None
    department_id: uuid.UUID | None = None
    company_id: uuid.UUID | None = None
    location: str | None = None
    employment_type: str | None = None
    description: str | None = None
    status: str | None = None
    openings: int | None = None
    hiring_manager_id: uuid.UUID | None = None


class JobOut(JobBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    department_name: str | None = None
    hiring_manager_name: str | None = None
    candidate_count: int = 0
    hired_count: int = 0
    created_at: datetime


class CandidateCreate(BaseModel):
    name: str
    email: str | None = None
    phone: str | None = None
    source: str | None = None
    notes: str | None = None


class CandidateUpdate(BaseModel):
    name: str | None = None
    email: str | None = None
    phone: str | None = None
    source: str | None = None
    stage: str | None = None
    status: str | None = None
    rating: int | None = None
    notes: str | None = None


class CandidateOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    job_id: uuid.UUID
    job_title: str | None = None
    name: str
    email: str | None = None
    phone: str | None = None
    resume_path: str | None = None
    source: str | None = None
    stage: str
    status: str
    rating: int | None = None
    notes: str | None = None
    user_id: uuid.UUID | None = None
    interview_count: int = 0
    created_at: datetime


class ActivityOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    kind: str
    body: str
    author_id: uuid.UUID | None = None
    author_name: str | None = None
    created_at: datetime


class NoteIn(BaseModel):
    body: str


class InterviewCreate(BaseModel):
    scheduled_at: datetime
    duration_minutes: int = 60
    mode: str = "video"
    location: str | None = None
    interviewer_id: uuid.UUID | None = None


class InterviewUpdate(BaseModel):
    scheduled_at: datetime | None = None
    duration_minutes: int | None = None
    mode: str | None = None
    location: str | None = None
    interviewer_id: uuid.UUID | None = None
    rating: int | None = None
    recommendation: str | None = None
    feedback: str | None = None


class InterviewOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    candidate_id: uuid.UUID
    scheduled_at: datetime
    duration_minutes: int
    mode: str
    location: str | None = None
    interviewer_id: uuid.UUID | None = None
    interviewer_name: str | None = None
    rating: int | None = None
    recommendation: str | None = None
    feedback: str | None = None
    created_at: datetime


class OfferCreate(BaseModel):
    amount: Decimal | None = None
    currency: str = "USD"
    pay_period: str = "monthly"
    start_date: date | None = None
    note: str | None = None


class OfferUpdate(BaseModel):
    amount: Decimal | None = None
    currency: str | None = None
    pay_period: str | None = None
    start_date: date | None = None
    status: str | None = None
    note: str | None = None


class OfferOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    candidate_id: uuid.UUID
    amount: Decimal | None = None
    currency: str
    pay_period: str
    start_date: date | None = None
    status: str
    note: str | None = None
    created_at: datetime


class HireIn(BaseModel):
    # Optional overrides used when creating the employee record.
    email: str | None = None
    start_onboarding: bool = True
    template_id: uuid.UUID | None = None


class CandidateDetail(CandidateOut):
    activities: list[ActivityOut] = []
    interviews: list[InterviewOut] = []
    offers: list[OfferOut] = []
