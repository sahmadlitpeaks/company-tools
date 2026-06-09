"""Admin audit-log viewer over the existing activity_logs table."""
from datetime import datetime

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, ConfigDict
from sqlalchemy import distinct, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_admin
from app.core.database import get_db
from app.models.activity import ActivityLog
from app.models.user import User

router = APIRouter(prefix="/audit", tags=["audit"])


class AuditEntry(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: object
    actor_name: str | None = None
    action: str
    entity_type: str
    entity_id: str | None = None
    summary: str
    created_at: datetime


class AuditPage(BaseModel):
    items: list[AuditEntry]
    actions: list[str]
    entity_types: list[str]
    has_more: bool


@router.get("", response_model=AuditPage)
async def list_audit(
    q: str | None = None,
    action: str | None = None,
    entity_type: str | None = None,
    limit: int = Query(50, le=200),
    offset: int = 0,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    stmt = select(ActivityLog).order_by(ActivityLog.created_at.desc())
    if action:
        stmt = stmt.where(ActivityLog.action == action)
    if entity_type:
        stmt = stmt.where(ActivityLog.entity_type == entity_type)
    if q:
        stmt = stmt.where(ActivityLog.summary.ilike(f"%{q}%"))
    rows = (await db.execute(stmt.limit(limit + 1).offset(offset))).scalars().all()
    has_more = len(rows) > limit

    actions = (
        await db.execute(select(distinct(ActivityLog.action)).order_by(ActivityLog.action))
    ).scalars().all()
    entities = (
        await db.execute(
            select(distinct(ActivityLog.entity_type)).order_by(ActivityLog.entity_type)
        )
    ).scalars().all()

    return AuditPage(
        items=[AuditEntry.model_validate(r) for r in rows[:limit]],
        actions=list(actions),
        entity_types=list(entities),
        has_more=has_more,
    )
