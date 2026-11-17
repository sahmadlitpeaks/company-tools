import uuid

from pydantic import BaseModel, ConfigDict


class PermissionOut(BaseModel):
    key: str
    group: str
    label: str
    description: str


class CatalogOut(BaseModel):
    platform: list[PermissionOut]
    project: list[PermissionOut]


class RoleCreate(BaseModel):
    name: str
    scope: str
    description: str | None = None
    permissions: list[str] = []


class RoleUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    permissions: list[str] | None = None


class RoleOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    key: str
    name: str
    description: str | None = None
    scope: str
    permissions: list[str] = []
    is_system: bool = False
    # Project roles: members holding it. Platform roles: people + departments.
    usage: int = 0


class UserAccessIn(BaseModel):
    role_ids: list[uuid.UUID] = []
    allow: list[str] = []
    deny: list[str] = []


class UserAccessOut(BaseModel):
    user_id: uuid.UUID
    is_admin: bool
    role_ids: list[uuid.UUID]
    department_id: uuid.UUID | None = None
    department_name: str | None = None
    department_role_ids: list[uuid.UUID] = []
    allow: list[str] = []
    deny: list[str] = []
    platform_permissions: list[str] = []
    modules: list[str] = []
    sources: dict[str, list[str]] = {}


class DepartmentRolesIn(BaseModel):
    role_ids: list[uuid.UUID] = []
