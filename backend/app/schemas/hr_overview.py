import uuid
from datetime import date

from pydantic import BaseModel


class CountItem(BaseModel):
    label: str
    count: int = 0


class JoinerItem(BaseModel):
    id: uuid.UUID
    name: str | None = None
    job_title: str | None = None
    hire_date: date | None = None


class HrOverview(BaseModel):
    headcount: int = 0
    on_leave_today: int = 0
    pending_leave: int = 0
    docs_expiring: int = 0
    contracts_expiring: int = 0
    probation_ending: int = 0
    open_review_cycles: int = 0
    open_journeys: int = 0
    by_department: list[CountItem] = []
    by_employment_type: list[CountItem] = []
    recent_joiners: list[JoinerItem] = []
    upcoming_joiners: list[JoinerItem] = []
