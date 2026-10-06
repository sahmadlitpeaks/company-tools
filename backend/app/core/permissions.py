"""Role-based access control: module catalogue, role defaults, and the
``require_module`` dependency used to gate feature routers server-side.

Effective access for a user is:
  * admin  -> every module (always)
  * else, an explicit per-user ``permissions`` list if set
  * else, the defaults for the user's role
"""
from fastapi import Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.core.database import get_db
from app.models.user import User
from app.services import feature_flags

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
    ("sharepoint_intelligence", "SharePoint Intelligence"),
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

# Named parts of a module that an admin may switch off on their own, leaving
# the rest of the module working. Keys are namespaced ``module.feature``.
#
# Only seams that map to a whole router (or a small, explicit set of routes)
# plus a page are listed here, so that switching one off is enforced on both
# ends rather than merely hiding a button.
FEATURES: dict[str, list[tuple[str, str]]] = {
    "hr": [
        ("hr.payroll", "Payroll"),
        ("hr.benefits", "Benefits"),
        ("hr.reports", "HR Reports"),
        ("hr.automations", "HR Automations"),
    ],
    "crm": [("crm.web_inbox", "Web Inbox")],
    "asset_tracker": [("asset_tracker.phone_lines", "Phone Lines")],
    "approvals": [("approvals.leave", "Leave Requests")],
    "routine_checks": [("routine_checks.templates", "Template Editing")],
}

ALL_FEATURES: list[str] = [key for items in FEATURES.values() for key, _ in items]

# Which module each feature belongs to — a feature is unreachable whenever its
# module is off, whatever the feature's own switch says.
FEATURE_MODULE: dict[str, str] = {
    key: module for module, items in FEATURES.items() for key, _ in items
}

# The dashboard is the home route every signed-in user lands on, and
# ``resolve_permissions`` always grants it; switching it off would strand
# everyone on a "No access" screen.
ALWAYS_ENABLED: set[str] = {"dashboard"}

# Everything an admin is allowed to put in the disabled set.
TOGGLEABLE: set[str] = (set(ALL_MODULES) - ALWAYS_ENABLED) | set(ALL_FEATURES)

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
MANAGER_EXCLUDED: set[str] = {"hr", "recruiting", "people_ops", "sharepoint_intelligence"}
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


OFF_DETAIL = "This area has been turned off by an administrator"
NO_ACCESS_DETAIL = "You don't have access to this area"


async def disabled_keys(db: AsyncSession) -> frozenset[str]:
    """Module and feature keys switched off org-wide (see ``feature_flags``)."""
    return await feature_flags.get_disabled(db)


def is_enabled(key: str, disabled: frozenset[str]) -> bool:
    """Whether ``key`` is switched on, given the org-wide disabled set.

    A feature also needs its parent module to be on — turning off "People / HR"
    takes Payroll with it, without having to list every child.
    """
    if key in ALWAYS_ENABLED:
        return True
    if key in disabled:
        return False
    parent = FEATURE_MODULE.get(key)
    return parent is None or parent not in disabled


def enabled_keys(disabled: frozenset[str]) -> list[str]:
    """Catalogue order, modules first, then the features still switched on."""
    return [k for k in ALL_MODULES + ALL_FEATURES if is_enabled(k, disabled)]


async def ensure_enabled(key: str, db: AsyncSession) -> None:
    """403 when ``key`` is switched off org-wide — for admins too.

    This runs before the permission check so that a disabled module is closed to
    everybody. The admin settings routes are not module-gated, so an
    administrator can always switch it back on.
    """
    if not is_enabled(key, await disabled_keys(db)):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail=OFF_DETAIL
        )


def require_module(module: str):
    """Router/route dependency: 403 unless ``module`` is on and the user has it."""

    async def _guard(
        user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
    ) -> User:
        await ensure_enabled(module, db)
        if module not in user.effective_permissions:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=NO_ACCESS_DETAIL,
            )
        return user

    return _guard


async def active_permissions(user: User, db: AsyncSession) -> set[str]:
    """A user's granted modules, minus anything switched off org-wide.

    For handlers that fan out across modules — global search, the calendar feed,
    attachments — where a switched-off module would otherwise leak its content
    through a surface belonging to a different module.
    """
    disabled = await disabled_keys(db)
    return {m for m in user.effective_permissions if is_enabled(m, disabled)}


def require_enabled(key: str):
    """Route dependency that only asks "is this switched on?".

    For surfaces that are deliberately open to any signed-in user and do their
    own authorization inside the handler (payslips and benefit enrolments, which
    every employee reaches for their own record). Gating those on the ``hr``
    module would take an employee's own payslip away, so the switch must not
    change who may reach them — only whether the feature exists at all.
    """

    async def _guard(
        user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
    ) -> User:
        await ensure_enabled(key, db)
        return user

    return _guard


def require_feature(feature: str):
    """Route dependency for one named part of a module (``module.feature``).

    Access needs three things: the module switched on, the feature switched on,
    and the user holding the module. Features have no separate grant — they
    narrow what a module offers, they do not widen who may reach it.
    """
    module = FEATURE_MODULE[feature]

    async def _guard(
        user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
    ) -> User:
        await ensure_enabled(feature, db)
        if module not in user.effective_permissions:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=NO_ACCESS_DETAIL,
            )
        return user

    return _guard


def is_hr(user: User) -> bool:
    """True for HR administrators — admins or holders of the ``hr`` module.

    HR staff can view everyone's sensitive records (documents, compensation),
    edit any profile, and manage leave types, holidays and review cycles.
    """
    return user.is_admin or "hr" in user.effective_permissions
