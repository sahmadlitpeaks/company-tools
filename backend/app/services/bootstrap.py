"""Seed a default administrator on a brand-new install.

Runs at startup (and in tests). Idempotent: only creates the bootstrap admin
when there are no users at all. The account is forced to change its password on
first login. After the first real admin exists, all further users come from an
admin manually adding them or from Azure SSO (as pending → approved).
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
    count = await db.scalar(select(func.count(User.id)))
    if count and count > 0:
        return None
    email = (settings.DEFAULT_ADMIN_EMAIL or "admin@agholding.net").strip().lower()
    user = User(
        email=email,
        display_name="Administrator",
        role="admin",
        is_admin=True,
        status="active",
        password_hash=hash_password(settings.DEFAULT_ADMIN_PASSWORD or "admin"),
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
