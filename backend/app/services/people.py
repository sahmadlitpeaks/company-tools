"""Resolve user ids to display names in bulk (avoids per-row queries)."""
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User


async def user_names(
    db: AsyncSession, ids: set[uuid.UUID | None]
) -> dict[uuid.UUID, str]:
    clean = {i for i in ids if i}
    if not clean:
        return {}
    rows = (
        await db.execute(
            select(User.id, User.display_name, User.email).where(User.id.in_(clean))
        )
    ).all()
    return {r[0]: (r[1] or r[2]) for r in rows}


async def user_labels(
    db: AsyncSession, ids: set[uuid.UUID | None]
) -> dict[uuid.UUID, dict]:
    """Like ``user_names`` but also carries each person's job title/position.

    Returns ``{id: {"name": str, "title": str | None}}``.
    """
    clean = {i for i in ids if i}
    if not clean:
        return {}
    rows = (
        await db.execute(
            select(User.id, User.display_name, User.email, User.job_title).where(
                User.id.in_(clean)
            )
        )
    ).all()
    return {r[0]: {"name": (r[1] or r[2]), "title": r[3]} for r in rows}
