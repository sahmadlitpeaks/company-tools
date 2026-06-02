import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    email: str
    display_name: str | None = None
    given_name: str | None = None
    surname: str | None = None
    job_title: str | None = None
    department: str | None = None
    office_location: str | None = None
    mobile_phone: str | None = None
    business_phone: str | None = None
    avatar_url: str | None = None
    is_active: bool
    is_admin: bool
    created_at: datetime


class UserUpdate(BaseModel):
    display_name: str | None = None
    job_title: str | None = None
    department: str | None = None
    mobile_phone: str | None = None
    business_phone: str | None = None
    is_active: bool | None = None
    is_admin: bool | None = None
