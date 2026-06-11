import uuid
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict


class CourseCreate(BaseModel):
    title: str
    description: str | None = None
    category: str | None = None
    url: str | None = None
    active: bool = True


class CourseUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    category: str | None = None
    url: str | None = None
    active: bool | None = None


class CourseOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title: str
    description: str | None = None
    category: str | None = None
    url: str | None = None
    active: bool
    assigned_count: int = 0
    created_at: datetime


class AssignIn(BaseModel):
    user_ids: list[uuid.UUID]
    due_date: date | None = None


class AssignmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    course_id: uuid.UUID
    course_title: str | None = None
    user_id: uuid.UUID
    user_name: str | None = None
    status: str
    due_date: date | None = None
    completed_at: datetime | None = None


class CertificationCreate(BaseModel):
    name: str
    issuer: str | None = None
    issued_date: date | None = None
    expiry_date: date | None = None
    credential_id: str | None = None


class CertificationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    user_id: uuid.UUID
    user_name: str | None = None
    name: str
    issuer: str | None = None
    issued_date: date | None = None
    expiry_date: date | None = None
    credential_id: str | None = None
    expired: bool = False
    days_to_expiry: int | None = None
