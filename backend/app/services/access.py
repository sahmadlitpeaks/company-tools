"""Platform permission resolution (BRD section 7).

Effective platform permissions = the union of the person's platform roles and
their department's roles, plus per-person allows, minus per-person denies. A
deny always wins. Platform administrators (``User.is_admin``) still hold every
permission until the admin flag is retired (PRM-13).

Module keys held through a role open that module exactly like a legacy module
grant; they are merged into ``User.effective_permissions``.
"""
from fastapi import Depends, HTTPException, status
from sqlalchemy import inspect as sa_inspect

from app.auth.deps import get_current_user
from app.core.access_catalog import (
    BY_KEY,
    PLATFORM_ACTION_KEYS,
    PLATFORM_KEYS,
    PLATFORM_MODULE_KEYS,
    ordered,
)
from app.models.user import User


def _loaded(obj, attr: str, default=None):
    """An eagerly loaded relationship, or ``default`` when it isn't loaded.

    A User detached from its session (e.g. handed between sessions) can't lazy
    load; treating unloaded grants as absent fails closed rather than erroring.
    """
    if obj is None:
        return default
    if attr in sa_inspect(obj).unloaded:
        return default
    return getattr(obj, attr)


def _role_permissions(user: User) -> set[str]:
    perms: set[str] = set()
    for role in _loaded(user, "platform_roles", []) or []:
        perms |= set(role.permissions or [])
    dept = _loaded(user, "access_department")
    for role in _loaded(dept, "roles", []) or []:
        perms |= set(role.permissions or [])
    return perms & PLATFORM_KEYS


def _overrides(user: User) -> tuple[set[str], set[str]]:
    overrides = _loaded(user, "permission_overrides", []) or []
    allow = {o.permission for o in overrides if o.allow}
    deny = {o.permission for o in overrides if not o.allow}
    return allow & PLATFORM_KEYS, deny & PLATFORM_KEYS


def role_module_grants(user: User, kind: str) -> list[str]:
    """Module keys added ("allow") or removed ("deny") by roles and overrides."""
    allow, deny = _overrides(user)
    if kind == "allow":
        return sorted((_role_permissions(user) | allow) & PLATFORM_MODULE_KEYS)
    return sorted(deny & PLATFORM_MODULE_KEYS)


def is_owner(user: User) -> bool:
    """Owners hold every permission: the protected Owner role, or the legacy admin flag."""
    return bool(user.is_admin) or any(
        getattr(r, "is_protected", False) for r in _loaded(user, "platform_roles", []) or []
    )


def platform_actions(user: User) -> list[str]:
    if is_owner(user):
        return ordered(PLATFORM_ACTION_KEYS, "platform")
    allow, deny = _overrides(user)
    return ordered(((_role_permissions(user) | allow) - deny) & PLATFORM_ACTION_KEYS, "platform")


def has_permission(user: User, key: str) -> bool:
    if key in PLATFORM_MODULE_KEYS:
        return key in user.effective_permissions
    return key in platform_actions(user)


def missing_detail(key: str) -> str:
    label = BY_KEY[key].label if key in BY_KEY else key
    return f"You need the “{label}” permission ({key}) to do this."


def require_permission(key: str):
    """Route dependency: 403 unless the caller holds platform permission ``key``."""
    if key not in PLATFORM_KEYS:
        raise ValueError(f"Unknown platform permission: {key}")

    async def _guard(user: User = Depends(get_current_user)) -> User:
        if not has_permission(user, key):
            raise HTTPException(status.HTTP_403_FORBIDDEN, missing_detail(key))
        return user

    return _guard


async def active_owner_ids(db) -> set:
    """Active accounts that are Owners (PRM-10: there is always at least one)."""
    from sqlalchemy import or_, select

    from app.models.role import Role, user_platform_roles

    owner_role = select(user_platform_roles.c.user_id).join(
        Role, Role.id == user_platform_roles.c.role_id).where(Role.is_protected.is_(True))
    rows = await db.scalars(select(User.id).where(
        User.is_active.is_(True), User.status == "active",
        or_(User.is_admin.is_(True), User.id.in_(owner_role)),
    ))
    return set(rows.all())


async def ensure_another_owner(db, user_id) -> None:
    if not (await active_owner_ids(db)) - {user_id}:
        raise HTTPException(status.HTTP_409_CONFLICT, "The platform must keep at least one active Owner.")
