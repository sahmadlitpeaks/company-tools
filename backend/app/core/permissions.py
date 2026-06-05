"""Role-based access control: module catalogue, role defaults, and the
``require_module`` dependency used to gate feature routers server-side.

Effective access for a user is:
  * admin  -> every module (always)
  * else, an explicit per-user ``permissions`` list if set
  * else, the defaults for the user's role
"""
from fastapi import Depends, HTTPException, status

from app.auth.deps import get_current_user
from app.models.user import User

# (key, human label) — the order is also used to render the admin matrix.
MODULES: list[tuple[str, str]] = [
    ("dashboard", "Dashboard"),
    ("directory", "Employee Directory"),
    ("cards", "Digital Cards"),
    ("marketing_assets", "Marketing Assets"),
    ("branding", "Brand Center"),
    ("products", "Products & Brochures"),
    ("shared", "Shared Links"),
    ("crm", "Leads (CRM)"),
    ("campaigns", "Campaign Studio"),
    ("asset_tracker", "Asset Tracker"),
    ("tasks", "Tasks"),
    ("approvals", "Approvals"),
    ("service_desk", "Service Desk"),
    ("knowledge", "Knowledge Base"),
    ("announcements", "Announcements"),
    ("qrcodes", "QR Codes"),
    ("landing_pages", "Landing Pages"),
    ("signatures", "Email Signatures"),
    ("shortener", "URL Shortener"),
    ("transfers", "Secure Transfers"),
]

ALL_MODULES: list[str] = [k for k, _ in MODULES]

# Everyday tools a brand-new member gets without any extra grants.
MEMBER_DEFAULTS: list[str] = [
    "dashboard",
    "directory",
    "cards",
    "marketing_assets",
    "products",
    "shared",
    "tasks",
    "approvals",
    "service_desk",
    "knowledge",
    "announcements",
    "qrcodes",
    "landing_pages",
    "signatures",
    "shortener",
    "transfers",
]

ROLE_DEFAULTS: dict[str, list[str]] = {
    "admin": ALL_MODULES,
    # Managers run marketing/sales/ops — everything except system settings.
    "manager": ALL_MODULES,
    "member": MEMBER_DEFAULTS,
}


def resolve_permissions(
    *, role: str, is_admin: bool, permissions: list[str] | None
) -> list[str]:
    """Compute a user's effective module list."""
    if is_admin or role == "admin":
        return list(ALL_MODULES)
    if permissions is not None:
        # Only keep keys we still recognise.
        return [p for p in permissions if p in set(ALL_MODULES)]
    return list(ROLE_DEFAULTS.get(role, MEMBER_DEFAULTS))


def require_module(module: str):
    """Router/route dependency: 403 unless the user may use ``module``."""

    async def _guard(user: User = Depends(get_current_user)) -> User:
        allowed = resolve_permissions(
            role=user.role, is_admin=user.is_admin, permissions=user.permissions
        )
        if module not in allowed:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You don't have access to this area",
            )
        return user

    return _guard
