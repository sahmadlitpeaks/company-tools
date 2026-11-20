"""Roles and permission grants (BRD section 7, PRM-01/02/03/07/09/10).

* ``GET /access/catalog`` - every permission the code enforces, by scope.
* ``/access/roles`` - create, edit, clone and delete roles (``roles.manage``).
* ``/access/users/{id}`` - a person's platform roles, overrides and effective
  permissions with where each one comes from.
* ``/access/departments/{id}/roles`` - roles every member of a department holds.

Every change is written to the audit log. Nobody can grant a platform
permission they do not hold themselves; platform administrators hold them all.
"""
import re
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.core.access_catalog import (
    CATALOG,
    PLATFORM_ACTION_KEYS,
    SCOPES,
    keys_for_scope,
    ordered,
)
from app.core.database import get_db
from app.models.department import Department
from app.models.pm import PmProjectMember
from app.models.role import Role, UserPermissionOverride, department_roles, user_platform_roles
from app.models.user import User
from app.schemas.access import (
    CatalogOut,
    DepartmentRolesIn,
    PermissionOut,
    RoleCreate,
    RoleOut,
    RoleUpdate,
    UserAccessIn,
    UserAccessOut,
)
from app.services.access import (
    ensure_another_owner,
    has_permission,
    is_owner,
    missing_detail,
    platform_actions,
    require_permission,
)
from app.services.activity import record

router = APIRouter(prefix="/access", tags=["access"])


def _name(user: User) -> str:
    return user.display_name or user.email or str(user.id)


# ----------------------------------------------------------------- catalogue
@router.get("/catalog", response_model=CatalogOut)
async def catalog(_: User = Depends(get_current_user)):
    out: dict[str, list[PermissionOut]] = {scope: [] for scope in SCOPES}
    for perm in CATALOG:
        out[perm.scope].append(PermissionOut(
            key=perm.key, group=perm.group, label=perm.label, description=perm.description,
        ))
    return CatalogOut(**out)


# --------------------------------------------------------------------- roles
async def _usage(db: AsyncSession, role: Role) -> int:
    if role.scope == "project":
        return int(await db.scalar(select(func.count()).select_from(PmProjectMember)
                                   .where(PmProjectMember.role == role.key)) or 0)
    users = await db.scalar(select(func.count()).select_from(user_platform_roles)
                            .where(user_platform_roles.c.role_id == role.id)) or 0
    depts = await db.scalar(select(func.count()).select_from(department_roles)
                            .where(department_roles.c.role_id == role.id)) or 0
    return int(users) + int(depts)


async def _role_out(db: AsyncSession, role: Role) -> RoleOut:
    out = RoleOut.model_validate(role)
    out.permissions = ordered(role.permissions or [], role.scope)
    out.usage = await _usage(db, role)
    return out


def _held(user: User) -> set[str]:
    return set(platform_actions(user)) | set(user.effective_permissions)


def _check_permissions(user: User, scope: str, permissions: list[str]) -> list[str]:
    unknown = set(permissions) - keys_for_scope(scope)
    if unknown:
        raise HTTPException(422, f"Unknown {scope} permissions: {', '.join(sorted(unknown))}")
    if scope == "platform" and not is_owner(user):
        beyond = set(permissions) - _held(user)
        if beyond:
            raise HTTPException(
                403, f"You can't grant permissions you don't hold yourself: {', '.join(sorted(beyond))}"
            )
    return ordered(permissions, scope)


async def _unique_key(db: AsyncSession, name: str) -> str:
    base = re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")[:48] or "role"
    key, n = base, 2
    while await db.scalar(select(Role.id).where(Role.key == key)):
        key, n = f"{base}_{n}", n + 1
    return key


async def _get_role(db: AsyncSession, role_id: uuid.UUID) -> Role:
    role = await db.get(Role, role_id)
    if not role:
        raise HTTPException(404, "Role not found")
    return role


@router.get("/roles", response_model=list[RoleOut])
async def list_roles(
    scope: str | None = Query(None, description="platform | project"),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    stmt = select(Role).order_by(Role.scope, Role.is_system.desc(), Role.name)
    if scope:
        if scope not in SCOPES:
            raise HTTPException(422, "Scope must be platform or project.")
        stmt = stmt.where(Role.scope == scope)
    return [await _role_out(db, role) for role in (await db.scalars(stmt)).all()]


@router.post("/roles", response_model=RoleOut, status_code=201)
async def create_role(
    payload: RoleCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("roles.manage")),
):
    if payload.scope not in SCOPES:
        raise HTTPException(422, "Scope must be platform or project.")
    name = payload.name.strip()
    if not name:
        raise HTTPException(422, "Enter a role name.")
    role = Role(
        key=await _unique_key(db, name), name=name, description=(payload.description or "").strip() or None,
        scope=payload.scope, permissions=_check_permissions(user, payload.scope, payload.permissions),
        is_system=False,
    )
    db.add(role)
    await db.flush()
    record(db, user=user, action="created", entity_type="role", entity_id=role.id,
           summary=f"{_name(user)} created {role.scope} role '{role.name}' with: "
                   f"{', '.join(role.permissions) or 'no permissions'}")
    await db.commit()
    await db.refresh(role)
    return await _role_out(db, role)


@router.patch("/roles/{role_id}", response_model=RoleOut)
async def update_role(
    role_id: uuid.UUID,
    payload: RoleUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("roles.manage")),
):
    role = await _get_role(db, role_id)
    if role.is_protected:
        raise HTTPException(409, "The Owner role always holds every permission and can't be edited.")
    before = (role.name, list(role.permissions or []))
    data = payload.model_dump(exclude_unset=True)
    if "name" in data:
        if not (data["name"] or "").strip():
            raise HTTPException(422, "Enter a role name.")
        role.name = data["name"].strip()
    if "description" in data:
        role.description = (data["description"] or "").strip() or None
    if data.get("permissions") is not None:
        role.permissions = _check_permissions(user, role.scope, data["permissions"])
    added = sorted(set(role.permissions) - set(before[1]))
    removed = sorted(set(before[1]) - set(role.permissions))
    record(db, user=user, action="updated", entity_type="role", entity_id=role.id,
           summary=f"{_name(user)} updated role '{before[0]}'"
                   + (f" (renamed to '{role.name}')" if role.name != before[0] else "")
                   + (f"; added {', '.join(added)}" if added else "")
                   + (f"; removed {', '.join(removed)}" if removed else ""))
    await db.commit()
    await db.refresh(role)
    return await _role_out(db, role)


@router.post("/roles/{role_id}/clone", response_model=RoleOut, status_code=201)
async def clone_role(
    role_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("roles.manage")),
):
    source = await _get_role(db, role_id)
    if source.is_protected:
        raise HTTPException(409, "The Owner role can't be copied.")
    name = f"{source.name} (copy)"
    role = Role(key=await _unique_key(db, name), name=name, description=source.description,
                scope=source.scope, permissions=_check_permissions(user, source.scope, source.permissions or []),
                is_system=False)
    db.add(role)
    await db.flush()
    record(db, user=user, action="created", entity_type="role", entity_id=role.id,
           summary=f"{_name(user)} cloned role '{source.name}' as '{role.name}'")
    await db.commit()
    await db.refresh(role)
    return await _role_out(db, role)


@router.delete("/roles/{role_id}", status_code=204)
async def delete_role(
    role_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("roles.manage")),
):
    role = await _get_role(db, role_id)
    if role.is_system or role.is_protected:
        raise HTTPException(409, "Starter roles can be edited but not deleted.")
    usage = await _usage(db, role)
    if usage:
        raise HTTPException(409, f"This role is still in use ({usage}). Reassign it before deleting.")
    record(db, user=user, action="deleted", entity_type="role", entity_id=role.id,
           summary=f"{_name(user)} deleted role '{role.name}'")
    await db.delete(role)
    await db.commit()


# ------------------------------------------------------------- user access
async def _platform_roles(db: AsyncSession, ids: list[uuid.UUID]) -> list[Role]:
    roles = list((await db.scalars(select(Role).where(Role.id.in_(ids)))).all()) if ids else []
    if len(roles) != len(set(ids)) or any(r.scope != "platform" for r in roles):
        raise HTTPException(422, "Choose platform roles only.")
    return roles


def _sources(target: User) -> dict[str, list[str]]:
    """Where each platform permission comes from (PRM-07)."""
    sources: dict[str, list[str]] = {}

    def add(key: str, label: str) -> None:
        sources.setdefault(key, []).append(label)

    if target.is_admin:
        for key in PLATFORM_ACTION_KEYS:
            add(key, "Platform administrator")
    elif is_owner(target):
        for key in PLATFORM_ACTION_KEYS:
            add(key, "Role: Owner")
    for role in target.platform_roles or []:
        for key in role.permissions or []:
            add(key, f"Role: {role.name}")
    dept = target.access_department
    if dept is not None:
        for role in dept.roles or []:
            for key in role.permissions or []:
                add(key, f"Department {dept.name}: {role.name}")
    for o in target.permission_overrides or []:
        add(o.permission, "Allowed for this person" if o.allow else "Denied for this person")
    return sources


async def _user_access(db: AsyncSession, target: User) -> UserAccessOut:
    dept = target.access_department
    return UserAccessOut(
        user_id=target.id,
        is_admin=is_owner(target),
        role_ids=[r.id for r in target.platform_roles or []],
        department_id=dept.id if dept else None,
        department_name=dept.name if dept else None,
        department_role_ids=[r.id for r in dept.roles or []] if dept else [],
        allow=ordered([o.permission for o in target.permission_overrides or [] if o.allow], "platform"),
        deny=ordered([o.permission for o in target.permission_overrides or [] if not o.allow], "platform"),
        platform_permissions=platform_actions(target),
        modules=target.effective_permissions,
        sources=_sources(target),
    )


async def _load_user(db: AsyncSession, user_id: uuid.UUID, *, fresh: bool = False) -> User:
    stmt = select(User).where(User.id == user_id)
    if fresh:
        stmt = stmt.execution_options(populate_existing=True)
    target = await db.scalar(stmt)
    if not target:
        raise HTTPException(404, "User not found")
    return target


@router.get("/users/{user_id}", response_model=UserAccessOut)
async def get_user_access(
    user_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.id != user_id and not has_permission(user, "roles.manage"):
        raise HTTPException(403, missing_detail("roles.manage"))
    return await _user_access(db, await _load_user(db, user_id))


@router.put("/users/{user_id}", response_model=UserAccessOut)
async def set_user_access(
    user_id: uuid.UUID,
    payload: UserAccessIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("roles.manage")),
):
    target = await _load_user(db, user_id)
    roles = await _platform_roles(db, payload.role_ids)
    allow, deny = set(payload.allow), set(payload.deny)
    if allow & deny:
        raise HTTPException(422, "A permission can't be both allowed and denied.")
    unknown = (allow | deny) - PLATFORM_ACTION_KEYS
    if unknown:
        raise HTTPException(
            422, f"Unknown permissions: {', '.join(sorted(unknown))}. "
                 "Module access is changed in the person's module list."
        )
    granted = {p for r in roles for p in r.permissions or []} | allow
    had_owner = any(r.is_protected for r in target.platform_roles or [])
    gets_owner = any(r.is_protected for r in roles)
    if had_owner != gets_owner:
        if not is_owner(user):
            raise HTTPException(403, "Only an Owner can grant or remove the Owner role.")
        if had_owner and not target.is_admin:
            await ensure_another_owner(db, target.id)
    added_roles = {r.id for r in roles} - {r.id for r in target.platform_roles or []}
    newly = {p for r in roles if r.id in added_roles for p in r.permissions or []} | (
        allow - {o.permission for o in target.permission_overrides or [] if o.allow})
    if not is_owner(user) and newly - _held(user):
        raise HTTPException(
            403, f"You can't grant permissions you don't hold yourself: {', '.join(sorted(newly - _held(user)))}"
        )
    if is_owner(target) and not is_owner(user):
        raise HTTPException(403, "Only an Owner can change an Owner's access.")
    before = await _user_access(db, target)
    target.platform_roles = roles
    await db.execute(delete(UserPermissionOverride).where(UserPermissionOverride.user_id == target.id))
    for key in sorted(allow):
        db.add(UserPermissionOverride(user_id=target.id, permission=key, allow=True))
    for key in sorted(deny):
        db.add(UserPermissionOverride(user_id=target.id, permission=key, allow=False))
    record(db, user=user, action="updated", entity_type="user", entity_id=target.id,
           summary=f"{_name(user)} changed {_name(target)}'s platform access: roles "
                   f"{sorted(r.name for r in roles)} (was {len(before.role_ids)} role(s)); "
                   f"allow {sorted(allow)} (was {before.allow}); deny {sorted(deny)} (was {before.deny}); "
                   f"granted {sorted(granted)}")
    await db.commit()
    return await _user_access(db, await _load_user(db, user_id, fresh=True))


# --------------------------------------------------------- department roles
@router.get("/departments/{department_id}/roles", response_model=list[RoleOut])
async def get_department_roles(
    department_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_permission("roles.manage")),
):
    dept = await db.get(Department, department_id)
    if not dept:
        raise HTTPException(404, "Department not found")
    return [await _role_out(db, role) for role in dept.roles or []]


@router.put("/departments/{department_id}/roles", response_model=list[RoleOut])
async def set_department_roles(
    department_id: uuid.UUID,
    payload: DepartmentRolesIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("roles.manage")),
):
    dept = await db.get(Department, department_id)
    if not dept:
        raise HTTPException(404, "Department not found")
    roles = await _platform_roles(db, payload.role_ids)
    if any(r.is_protected for r in roles):
        raise HTTPException(422, "The Owner role is granted to named people, not departments.")
    added = [r for r in roles if r.id not in {x.id for x in dept.roles or []}]
    newly = {p for r in added for p in r.permissions or []}
    if not is_owner(user) and newly - _held(user):
        raise HTTPException(
            403, f"You can't grant permissions you don't hold yourself: {', '.join(sorted(newly - _held(user)))}"
        )
    before = sorted(r.name for r in dept.roles or [])
    dept.roles = roles
    record(db, user=user, action="updated", entity_type="department", entity_id=dept.id,
           summary=f"{_name(user)} changed department {dept.name}'s roles from {before} "
                   f"to {sorted(r.name for r in roles)}")
    await db.commit()
    return [await _role_out(db, role) for role in roles]
