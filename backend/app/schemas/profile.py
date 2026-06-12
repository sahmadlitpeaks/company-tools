import uuid
from datetime import date, datetime

from pydantic import BaseModel


class ProfileUpdate(BaseModel):
    # Name fields — editable by HR/admins.
    display_name: str | None = None
    given_name: str | None = None
    surname: str | None = None
    job_title: str | None = None
    hr_department: str | None = None  # free-text label -> user.department
    office_location: str | None = None
    mobile_phone: str | None = None
    business_phone: str | None = None
    personal_email: str | None = None
    nationality: str | None = None
    passport_no: str | None = None
    date_of_birth: date | None = None
    # Employment record
    employment_type: str | None = None
    hire_date: date | None = None
    probation_end_date: date | None = None
    contract_end_date: date | None = None
    emergency_contact_name: str | None = None
    emergency_contact_phone: str | None = None
    emergency_contact_relationship: str | None = None
    # Admin-only fields below; ignored for non-admin editors.
    manager_id: uuid.UUID | None = None
    department_id: uuid.UUID | None = None
    role: str | None = None
    status: str | None = None


class ProfileEvent(BaseModel):
    id: uuid.UUID
    event_type: str
    effective_date: date
    title: str
    detail: str | None = None
    created_at: datetime


class ProfileItem(BaseModel):
    id: uuid.UUID
    label: str
    sub: str | None = None
    status: str | None = None


class ProfileSubscription(BaseModel):
    subscription_id: uuid.UUID
    name: str
    vendor: str | None = None
    source: str  # seat | department | company
    seat_status: str | None = None


class ProfileTask(BaseModel):
    id: uuid.UUID
    title: str
    status: str
    priority: str | None = None
    due_date: date | None = None


class ProfileJourney(BaseModel):
    id: uuid.UUID
    kind: str
    status: str
    total_tasks: int = 0
    done_tasks: int = 0
    created_at: datetime


class ProfileOut(BaseModel):
    id: uuid.UUID
    name: str | None = None
    email: str | None = None
    job_title: str | None = None
    role: str
    status: str
    is_admin: bool = False
    department_name: str | None = None  # access department
    hr_department: str | None = None    # free-text HR label
    office_location: str | None = None
    mobile_phone: str | None = None
    business_phone: str | None = None
    avatar_url: str | None = None
    created_at: datetime

    # Employment record
    manager_id: uuid.UUID | None = None
    manager_name: str | None = None
    employment_type: str | None = None
    hire_date: date | None = None
    probation_end_date: date | None = None
    contract_end_date: date | None = None
    direct_reports: list[ProfileItem] = []

    # Sensitive HR details — only populated for admins/HR or the person.
    personal_email: str | None = None
    nationality: str | None = None
    passport_no: str | None = None
    date_of_birth: date | None = None
    emergency_contact_name: str | None = None
    emergency_contact_phone: str | None = None
    emergency_contact_relationship: str | None = None

    # Access & belongings
    modules: list[str] = []
    access_grants: list[ProfileItem] = []
    subscriptions: list[ProfileSubscription] = []
    assets: list[ProfileItem] = []
    phones: list[ProfileItem] = []
    open_tasks: list[ProfileTask] = []
    journeys: list[ProfileJourney] = []
    events: list[ProfileEvent] = []

    # What the viewer is allowed to do/see.
    can_manage: bool = False
    can_see_sensitive: bool = False
