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
    ("branding", "Company Center"),
    ("products", "Products & Brochures"),
    ("shared", "Shared Links"),
    ("crm", "Leads (CRM)"),
    ("campaigns", "Campaign Studio"),
    ("asset_tracker", "Asset Tracker"),
    ("subscriptions", "Subscriptions"),
    ("attendance", "Time Tracking"),
    ("tasks", "Tasks"),
    ("routine_checks", "Routine Checks"),
    ("approvals", "Approvals"),
    ("service_desk", "Service Desk"),
    ("knowledge", "Knowledge Base"),
    ("announcements", "Announcements"),
    ("people_ops", "Onboarding & Offboarding"),
    ("hr", "People / HR"),
    ("recruiting", "Recruiting / ATS"),
    ("worklog", "Work Log"),
    ("workspace", "My Docs"),
    ("qrcodes", "QR Codes"),
    ("landing_pages", "Landing Pages"),
    ("signatures", "Email Signatures"),
    ("shortener", "URL Shortener"),
    ("transfers", "Secure Transfers"),
    ("cafe", "Café Ordering"),
    ("bookings", "Room & Desk Booking"),
    ("visitors", "Visitor Management"),
    ("purchases", "Purchase Requests"),
    ("calendar", "Company Calendar"),
    ("ideas", "Feedback & Ideas"),
    ("ai_help", "AI Help"),
    ("lost_found", "Lost & Found"),
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
    "worklog",
    "attendance",
    "workspace",
    "qrcodes",
    "landing_pages",
    "signatures",
    "shortener",
    "transfers",
    "cafe",
    "bookings",
    "visitors",
    "purchases",
    "calendar",
    "ideas",
    "ai_help",
    "lost_found",
]

# Sensitive people-domain modules a manager must NOT receive just for being a
# manager: HR (salaries, payslips via ``is_hr``, HR documents/passports),
# recruiting, and onboarding/offboarding. Grant these explicitly — e.g. to an
# HR department or per person — rather than by role. Without this exclusion a
# plain manager could read every employee's compensation and HR files, which
# the compensation/payroll/hr_documents modules explicitly intend to forbid.
MANAGER_EXCLUDED: set[str] = {"hr", "recruiting", "people_ops"}
MANAGER_DEFAULTS: list[str] = [m for m in ALL_MODULES if m not in MANAGER_EXCLUDED]

ROLE_DEFAULTS: dict[str, list[str]] = {
    "admin": ALL_MODULES,
    # Managers run marketing / sales / ops — everything except system settings
    # and the sensitive HR/people domains (see MANAGER_EXCLUDED).
    "manager": MANAGER_DEFAULTS,
    "member": MEMBER_DEFAULTS,
}


def resolve_permissions(
    *,
    role: str,
    is_admin: bool,
    permissions: list[str] | None = None,
    department_perms: list[str] | None = None,
    extra: list[str] | None = None,
    revoked: list[str] | None = None,
) -> list[str]:
    """Compute a user's effective module list.

    Admins get everything. Otherwise the base set is the user's explicit
    ``permissions`` (legacy override) if set, else their department's
    permissions, else the role defaults. Per-person ``extra`` grants are added
    and ``revoked`` modules removed; the dashboard is always included.
    """
    if is_admin or role == "admin":
        return list(ALL_MODULES)
    if permissions is not None:
        base = set(permissions)
    elif department_perms is not None:
        base = set(department_perms)
    else:
        base = set(ROLE_DEFAULTS.get(role, MEMBER_DEFAULTS))
    base |= set(extra or [])
    base -= set(revoked or [])
    base.add("dashboard")
    return [m for m in ALL_MODULES if m in base]


def require_module(module: str):
    """Router/route dependency: 403 unless the user may use ``module``."""

    async def _guard(user: User = Depends(get_current_user)) -> User:
        if module not in user.effective_permissions:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You don't have access to this area",
            )
        return user

    return _guard


def is_hr(user: User) -> bool:
    """True for HR administrators — admins or holders of the ``hr`` module.

    HR staff can view everyone's sensitive records (documents, compensation),
    edit any profile, and manage leave types, holidays and review cycles.
    """
    return user.is_admin or "hr" in user.effective_permissions
