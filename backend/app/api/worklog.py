import uuid
from collections import defaultdict
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.core.database import get_db
from app.models.user import User
from app.models.worklog import WorkLog
from app.models.workplace import Task, Ticket
from app.schemas.worklog import (
    WorkLogCreate,
    WorkLogOut,
    WorkLogSummary,
    WorkLogUpdate,
)
from app.services.people import user_names

router = APIRouter(prefix="/worklogs", tags=["work-log"])

KINDS = {"ticket", "task", "rnd", "support", "meeting", "admin", "other"}


async def _entity_labels(db: AsyncSession, logs: list[WorkLog]) -> dict:
    """Resolve ticket/task ids to human labels for display."""
    ticket_ids = {lg.entity_id for lg in logs if lg.entity_type == "ticket" and lg.entity_id}
    task_ids = {lg.entity_id for lg in logs if lg.entity_type == "task" and lg.entity_id}
    labels: dict = {}
    if ticket_ids:
        rows = (await db.execute(select(Ticket.id, Ticket.subject).where(Ticket.id.in_(ticket_ids)))).all()
        labels.update({("ticket", r[0]): r[1] for r in rows})
    if task_ids:
        rows = (await db.execute(select(Task.id, Task.title).where(Task.id.in_(task_ids)))).all()
        labels.update({("task", r[0]): r[1] for r in rows})
    return labels


def _serialize(lg: WorkLog, names: dict, labels: dict) -> WorkLogOut:
    o = WorkLogOut.model_validate(lg)
    o.user_name = names.get(lg.user_id)
    if lg.entity_type and lg.entity_id:
        o.entity_label = labels.get((lg.entity_type, lg.entity_id))
    return o


def _base_query(user: User, scope: str):
    stmt = select(WorkLog).order_by(WorkLog.work_date.desc(), WorkLog.created_at.desc())
    if scope == "team":
        if not (user.is_admin or user.role == "manager"):
            scope = "mine"
    if scope != "team":
        stmt = stmt.where(WorkLog.user_id == user.id)
    return stmt


@router.get("", response_model=list[WorkLogOut])
async def list_worklogs(
    scope: str = Query("mine", description="mine | team"),
    entity_type: str | None = None,
    entity_id: uuid.UUID | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    stmt = _base_query(user, scope)
    if entity_type:
        stmt = stmt.where(WorkLog.entity_type == entity_type)
    if entity_id:
        stmt = stmt.where(WorkLog.entity_id == entity_id)
    if date_from:
        stmt = stmt.where(WorkLog.work_date >= date_from)
    if date_to:
        stmt = stmt.where(WorkLog.work_date <= date_to)
    logs = (await db.execute(stmt.limit(500))).scalars().all()
    names = await user_names(db, {lg.user_id for lg in logs})
    labels = await _entity_labels(db, logs)
    return [_serialize(lg, names, labels) for lg in logs]


@router.get("/summary", response_model=WorkLogSummary)
async def worklog_summary(
    scope: str = Query("mine"),
    date_from: date | None = None,
    date_to: date | None = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    stmt = _base_query(user, scope)
    if date_from:
        stmt = stmt.where(WorkLog.work_date >= date_from)
    if date_to:
        stmt = stmt.where(WorkLog.work_date <= date_to)
    logs = (await db.execute(stmt)).scalars().all()
    by_kind: dict[str, int] = defaultdict(int)
    by_day: dict[str, int] = defaultdict(int)
    by_user_id: dict[uuid.UUID, int] = defaultdict(int)
    total = 0
    for lg in logs:
        total += lg.minutes
        by_kind[lg.kind] += lg.minutes
        by_day[lg.work_date.isoformat()] += lg.minutes
        by_user_id[lg.user_id] += lg.minutes
    names = await user_names(db, set(by_user_id))
    return WorkLogSummary(
        total_minutes=total,
        entries=len(logs),
        by_kind=dict(by_kind),
        by_day=dict(by_day),
        by_user={(names.get(uid) or str(uid)): m for uid, m in by_user_id.items()},
    )


@router.post("", response_model=WorkLogOut, status_code=201)
async def create_worklog(
    payload: WorkLogCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if payload.kind not in KINDS:
        raise HTTPException(status_code=422, detail="Invalid kind")
    if payload.minutes < 0:
        raise HTTPException(status_code=422, detail="Minutes must be >= 0")
    lg = WorkLog(
        user_id=user.id,
        work_date=payload.work_date or date.today(),
        minutes=payload.minutes,
        description=payload.description,
        kind=payload.kind,
        entity_type=payload.entity_type,
        entity_id=payload.entity_id,
    )
    db.add(lg)
    await db.commit()
    await db.refresh(lg)
    names = await user_names(db, {lg.user_id})
    labels = await _entity_labels(db, [lg])
    return _serialize(lg, names, labels)


@router.patch("/{log_id}", response_model=WorkLogOut)
async def update_worklog(
    log_id: uuid.UUID,
    payload: WorkLogUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    lg = await db.get(WorkLog, log_id)
    if not lg or lg.user_id != user.id:
        raise HTTPException(status_code=404, detail="Entry not found")
    data = payload.model_dump(exclude_unset=True)
    if "kind" in data and data["kind"] not in KINDS:
        raise HTTPException(status_code=422, detail="Invalid kind")
    for field, value in data.items():
        setattr(lg, field, value)
    await db.commit()
    await db.refresh(lg)
    names = await user_names(db, {lg.user_id})
    labels = await _entity_labels(db, [lg])
    return _serialize(lg, names, labels)


@router.delete("/{log_id}", status_code=204)
async def delete_worklog(
    log_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    lg = await db.get(WorkLog, log_id)
    if not lg:
        return
    if lg.user_id != user.id and not user.is_admin:
        raise HTTPException(status_code=403, detail="Not allowed")
    await db.delete(lg)
    await db.commit()
