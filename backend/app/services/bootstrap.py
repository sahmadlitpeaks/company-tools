"""Ensure a usable default administrator exists.

Runs at startup (and in tests). It guarantees the configured bootstrap admin
account exists and can sign in with a password:

* If the account doesn't exist yet, it's created (works on a fresh install and
  also recovers an install whose admin was removed).
* If it exists but has no local password (e.g. it was created by the old
  dev-login or via SSO), a password is set so the admin can sign in.

In both cases the account is forced to change its password on first login.
Once a real password has been set, startup leaves the account untouched.
"""
import logging

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.security import hash_password
from app.models.department import Department
from app.models.user import User

log = logging.getLogger("bootstrap")

# Everyday modules every department gets.
_BASE = [
    "dashboard", "directory", "tasks", "approvals", "service_desk",
    "knowledge", "announcements", "worklog", "workspace",
]
# Default departments and the modules they grant on top of (or beyond) the base.
DEFAULT_DEPARTMENTS: list[tuple[str, str, list[str]]] = [
    ("Management", "Leadership — full access to every module.", ["__all__"]),
    ("Marketing", "Company, campaigns and creative tooling.", _BASE + [
        "cards", "marketing_assets", "branding", "products", "shared",
        "campaigns", "crm", "qrcodes", "landing_pages", "signatures",
        "shortener", "transfers",
    ]),
    ("Sales", "Leads, decks and outreach.", _BASE + [
        "crm", "cards", "products", "shared", "campaigns", "shortener", "transfers",
    ]),
    ("IT", "Assets, phone lines and the service desk.", _BASE + [
        "asset_tracker", "subscriptions", "transfers", "shortener", "qrcodes",
    ]),
    ("HR", "People operations, records and onboarding.", _BASE + [
        "hr", "recruiting", "people_ops", "directory",
    ]),
    ("Finance", "Approvals and expense oversight.", _BASE + [
        "products", "shared", "subscriptions",
    ]),
    ("Operations", "Day-to-day running and assets.", _BASE + [
        "asset_tracker", "subscriptions", "products", "shared", "transfers", "qrcodes",
    ]),
]


async def ensure_default_departments(db: AsyncSession) -> int:
    """Seed the default departments once (only if none exist yet)."""
    from app.core.permissions import ALL_MODULES

    count = await db.scalar(select(func.count(Department.id)))
    if count and count > 0:
        return 0
    created = 0
    for name, description, perms in DEFAULT_DEPARTMENTS:
        resolved = list(ALL_MODULES) if perms == ["__all__"] else [
            p for p in perms if p in set(ALL_MODULES)
        ]
        db.add(Department(name=name, description=description, permissions=resolved))
        created += 1
    await db.commit()
    log.info("Seeded %s default departments", created)
    return created


# (name, color, paid, default_days, carryover_max)
DEFAULT_LEAVE_TYPES: list[tuple[str, str, bool, int, int]] = [
    ("Annual", "#6366f1", True, 25, 5),
    ("Sick", "#f59e0b", True, 10, 0),
    ("Unpaid", "#94a3b8", False, 0, 0),
    ("Parental", "#ec4899", True, 0, 0),
]


async def ensure_default_leave_types(db: AsyncSession) -> int:
    """Seed the default leave types once (only if none exist yet)."""
    from app.models.hr import LeaveType

    count = await db.scalar(select(func.count(LeaveType.id)))
    if count and count > 0:
        return 0
    for i, (name, color, paid, default_days, carryover) in enumerate(DEFAULT_LEAVE_TYPES):
        db.add(
            LeaveType(
                name=name, color=color, paid=paid, default_days=default_days,
                carryover_max=carryover, sort=i,
            )
        )
    await db.commit()
    log.info("Seeded %s default leave types", len(DEFAULT_LEAVE_TYPES))
    return len(DEFAULT_LEAVE_TYPES)


async def ensure_default_admin(db: AsyncSession) -> User | None:
    email = (settings.DEFAULT_ADMIN_EMAIL or "admin@agholding.net").strip().lower()
    password = settings.DEFAULT_ADMIN_PASSWORD or "admin"

    existing = (
        await db.execute(select(User).where(func.lower(User.email) == email))
    ).scalar_one_or_none()

    if existing is not None:
        # Only heal an account that can't sign in with a password yet.
        if existing.password_hash:
            return None
        existing.password_hash = hash_password(password)
        existing.must_change_password = True
        existing.is_admin = True
        existing.role = "admin"
        existing.is_active = True
        existing.status = "active"
        await db.commit()
        log.info("Enabled password sign-in for existing admin %s", email)
        return existing

    user = User(
        email=email,
        display_name="Administrator",
        role="admin",
        is_admin=True,
        status="active",
        password_hash=hash_password(password),
        must_change_password=True,
    )
    db.add(user)
    try:
        await db.commit()
    except IntegrityError:
        # Another worker won the race — fine, the admin exists.
        await db.rollback()
        return None
    log.info("Seeded default admin %s (must change password on first login)", email)
    return user
