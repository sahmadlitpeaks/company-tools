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
from app.models.user import User

log = logging.getLogger("bootstrap")


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
