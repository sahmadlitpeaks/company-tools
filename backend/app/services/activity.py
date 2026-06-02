"""Helper to record an entry in the activity/audit log.

Adds the row to the session; the caller is responsible for committing (so the
log entry shares the same transaction as the action it describes).
"""
import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.activity import ActivityLog
from app.models.user import User


def record(
    db: AsyncSession,
    *,
    user: User | None,
    action: str,
    entity_type: str,
    summary: str,
    entity_id: uuid.UUID | str | None = None,
) -> None:
    db.add(
        ActivityLog(
            user_id=user.id if user else None,
            actor_name=(user.display_name or user.email) if user else None,
            action=action,
            entity_type=entity_type,
            entity_id=str(entity_id) if entity_id else None,
            summary=summary,
        )
    )
