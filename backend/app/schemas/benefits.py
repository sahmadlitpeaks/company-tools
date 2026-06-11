import uuid
from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict


class PlanBase(BaseModel):
    name: str
    category: str = "health"
    carrier: str | None = None
    description: str | None = None
    currency: str = "USD"
    employee_cost: Decimal = Decimal("0")
    employer_cost: Decimal = Decimal("0")
    active: bool = True
    enrollment_open: bool = True
    sort: int = 0


class PlanCreate(PlanBase):
    pass


class PlanUpdate(BaseModel):
    name: str | None = None
    category: str | None = None
    carrier: str | None = None
    description: str | None = None
    currency: str | None = None
    employee_cost: Decimal | None = None
    employer_cost: Decimal | None = None
    active: bool | None = None
    enrollment_open: bool | None = None
    sort: int | None = None


class PlanOut(PlanBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    enrolled_count: int = 0
    created_at: datetime


class EnrollmentCreate(BaseModel):
    plan_id: uuid.UUID
    user_id: uuid.UUID
    status: str = "enrolled"
    coverage_level: str = "employee"
    elected_cost: Decimal | None = None
    effective_date: date | None = None
    end_date: date | None = None
    note: str | None = None


class EnrollmentUpdate(BaseModel):
    status: str | None = None
    coverage_level: str | None = None
    elected_cost: Decimal | None = None
    effective_date: date | None = None
    end_date: date | None = None
    note: str | None = None


class EnrollmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    plan_id: uuid.UUID
    plan_name: str | None = None
    category: str | None = None
    user_id: uuid.UUID
    employee_name: str | None = None
    status: str
    coverage_level: str
    elected_cost: Decimal
    currency: str | None = None
    effective_date: date
    end_date: date | None = None
    note: str | None = None


class DependentCreate(BaseModel):
    name: str
    relationship_type: str = "child"
    date_of_birth: date | None = None


class DependentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    user_id: uuid.UUID
    name: str
    relationship_type: str
    date_of_birth: date | None = None
