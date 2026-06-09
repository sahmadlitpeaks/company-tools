import uuid
from datetime import date, datetime

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
    date_of_birth: date | None = None
    bamboo_id: str | None = None
    manager_id: uuid.UUID | None = None
    manager_name: str | None = None
    employment_type: str | None = None
    hire_date: date | None = None
    probation_end_date: date | None = None
    contract_end_date: date | None = None
    emergency_contact_name: str | None = None
    emergency_contact_phone: str | None = None
    emergency_contact_relationship: str | None = None
    is_active: bool
    is_admin: bool
    must_change_password: bool = False
    role: str = "member"
    status: str = "active"
    permissions: list[str] | None = None
    department_id: uuid.UUID | None = None
    department_name: str | None = None
    extra_permissions: list[str] | None = None
    revoked_permissions: list[str] | None = None
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
    date_of_birth: date | None = None
    manager_id: uuid.UUID | None = None
    employment_type: str | None = None
    hire_date: date | None = None
    probation_end_date: date | None = None
    contract_end_date: date | None = None
    emergency_contact_name: str | None = None
    emergency_contact_phone: str | None = None
    emergency_contact_relationship: str | None = None
    is_active: bool | None = None
    role: str | None = None
    status: str | None = None
    permissions: list[str] | None = None
    department_id: uuid.UUID | None = None
    extra_permissions: list[str] | None = None
    revoked_permissions: list[str] | None = None


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
    # Optional initial password so the new user can sign in without SSO. They'll
    # be prompted to change it on first login.
    password: str | None = None


class SetPasswordIn(BaseModel):
    password: str


class ManagedBrandsUpdate(BaseModel):
    brand_ids: list[uuid.UUID] = []
