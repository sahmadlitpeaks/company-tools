"""Platform permission resolution (BRD section 7).

Effective platform permissions = the union of the person's platform roles and
their department's roles, plus per-person allows, minus per-person denies. A
deny always wins. Platform administrators (``User.is_admin``) still hold every
permission until the admin flag is retired (PRM-13).

Module keys held through a role open that module exactly like a legacy module
grant; they are merged into ``User.effective_permissions``.
"""
from fastapi import Depends, HTTPException, status

from app.auth.deps import get_current_user
from app.core.access_catalog import (
    BY_KEY,
    PLATFORM_ACTION_KEYS,
    PLATFORM_KEYS,
    PLATFORM_MODULE_KEYS,
    ordered,
)
from app.models.user import User


def _role_permissions(user: User) -> set[str]:
    perms: set[str] = set()
    for role in user.platform_roles or []:
        perms |= set(role.permissions or [])
    dept = user.access_department
    if dept is not None:
        for role in dept.roles or []:
            perms |= set(role.permissions or [])
    return perms & PLATFORM_KEYS


def _overrides(user: User) -> tuple[set[str], set[str]]:
    allow = {o.permission for o in user.permission_overrides or [] if o.allow}
    deny = {o.permission for o in user.permission_overrides or [] if not o.allow}
    return allow & PLATFORM_KEYS, deny & PLATFORM_KEYS


def role_module_grants(user: User, kind: str) -> list[str]:
    """Module keys added ("allow") or removed ("deny") by roles and overrides."""
    allow, deny = _overrides(user)
    if kind == "allow":
        return sorted((_role_permissions(user) | allow) & PLATFORM_MODULE_KEYS)
    return sorted(deny & PLATFORM_MODULE_KEYS)


def platform_actions(user: User) -> list[str]:
    if user.is_admin:
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
