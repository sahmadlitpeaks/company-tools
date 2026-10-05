import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict


class DepartmentCreate(BaseModel):
    name: str
    description: str | None = None
    permissions: list[str] = []


class DepartmentUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    permissions: list[str] | None = None


class DepartmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    description: str | None = None
    permissions: list[str] = []
    member_count: int = 0
    created_at: datetime


class DepartmentMemberAdd(BaseModel):
    user_id: uuid.UUID


class DepartmentMemberOut(BaseModel):
    id: uuid.UUID
    display_name: str | None = None
    email: str | None = None
    role: str
    status: str
    is_active: bool
