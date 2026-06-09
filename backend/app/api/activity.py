"""Per-entity activity timeline for authenticated users.

Reuses the activity_logs table that already records create/update/etc. events
so tickets and tasks can show a history of what happened and when.
"""
import uuid

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.core.database import get_db
from app.models.activity import ActivityLog
from app.models.user import User
from app.schemas.workplace import ActivityOut

router = APIRouter(prefix="/activity", tags=["activity"])

# Only entities whose timelines are safe to expose to any authenticated user.
_ALLOWED = {"ticket", "task"}


@router.get("", response_model=list[ActivityOut])
async def list_activity(
    entity_type: str = Query(...),
    entity_id: uuid.UUID = Query(...),
    limit: int = Query(50, le=200),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    if entity_type not in _ALLOWED:
        return []
    rows = (
        await db.execute(
            select(ActivityLog)
            .where(
                ActivityLog.entity_type == entity_type,
                ActivityLog.entity_id == str(entity_id),
            )
            .order_by(ActivityLog.created_at.asc())
            .limit(limit)
        )
    ).scalars().all()
    return [ActivityOut.model_validate(r) for r in rows]
