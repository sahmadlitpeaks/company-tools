import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    email: str | None = None
    personal_email: str | None = None
    display_name: str | None = None
    given_name: str | None = None
    surname: str | None = None
    job_title: str | None = None
    department: str | None = None
    office_location: str | None = None
    mobile_phone: str | None = None
    business_phone: str | None = None
    avatar_url: str | None = None
    passport_no: str | None = None
    nationality: str | None = None
    bamboo_id: str | None = None
    is_active: bool
    is_admin: bool
    role: str = "member"
    status: str = "active"
    permissions: list[str] | None = None
    effective_permissions: list[str] = []
    managed_brand_ids: list[uuid.UUID] = []
    created_at: datetime


class UserUpdate(BaseModel):
    display_name: str | None = None
    given_name: str | None = None
    surname: str | None = None
    email: str | None = None
    personal_email: str | None = None
    job_title: str | None = None
    department: str | None = None
    office_location: str | None = None
    mobile_phone: str | None = None
    business_phone: str | None = None
    passport_no: str | None = None
    nationality: str | None = None
    is_active: bool | None = None
    role: str | None = None
    status: str | None = None
    permissions: list[str] | None = None


class UserCreate(BaseModel):
    """Manually add an employee who isn't (yet) in Azure (new joiner)."""

    given_name: str | None = None
    surname: str | None = None
    display_name: str | None = None
    # Official email is optional at onboarding (often not yet assigned).
    email: str | None = None
    personal_email: str | None = None
    job_title: str | None = None
    department: str | None = None
    office_location: str | None = None
    mobile_phone: str | None = None
    business_phone: str | None = None
    passport_no: str | None = None
    nationality: str | None = None
    role: str = "member"
    status: str = "active"


class ManagedBrandsUpdate(BaseModel):
    brand_ids: list[uuid.UUID] = []
