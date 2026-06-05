import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.core.database import get_db
from app.models.user import User
from app.models.workplace import Task
from app.schemas.workplace import TaskCreate, TaskOut, TaskUpdate
from app.services.activity import record
from app.services.notify import notify_user
from app.services.people import user_names

router = APIRouter(prefix="/tasks", tags=["tasks"])

STATUSES = {"todo", "in_progress", "blocked", "done"}
PRIORITIES = {"low", "normal", "high", "urgent"}


def _serialize(task: Task, names: dict) -> TaskOut:
    out = TaskOut.model_validate(task)
    out.assignee_name = names.get(task.assignee_id) if task.assignee_id else None
    out.created_by_name = names.get(task.created_by_id) if task.created_by_id else None
    return out


@router.get("", response_model=list[TaskOut])
async def list_tasks(
    status: str | None = None,
    mine: bool = Query(False, description="Only tasks assigned to or created by me"),
    q: str | None = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    stmt = select(Task).order_by(Task.created_at.desc())
    if status:
        stmt = stmt.where(Task.status == status)
    if mine:
        stmt = stmt.where(
            or_(Task.assignee_id == user.id, Task.created_by_id == user.id)
        )
    if q:
        stmt = stmt.where(Task.title.ilike(f"%{q}%"))
    tasks = (await db.execute(stmt)).scalars().all()
    names = await user_names(
        db, {t.assignee_id for t in tasks} | {t.created_by_id for t in tasks}
    )
    return [_serialize(t, names) for t in tasks]


@router.post("", response_model=TaskOut, status_code=201)
async def create_task(
    payload: TaskCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if payload.status not in STATUSES:
        raise HTTPException(status_code=422, detail="Invalid status")
    if payload.priority not in PRIORITIES:
        raise HTTPException(status_code=422, detail="Invalid priority")
    task = Task(**payload.model_dump(), created_by_id=user.id)
    db.add(task)
    if task.assignee_id and task.assignee_id != user.id:
        await notify_user(
            db,
            user_id=task.assignee_id,
            title="A task was assigned to you",
            body=task.title,
            link="/tasks",
            category="task",
        )
    record(
        db,
        user=user,
        action="created",
        entity_type="task",
        entity_id=task.id,
        summary=f"Created task '{task.title}'",
    )
    await db.commit()
    await db.refresh(task)
    names = await user_names(db, {task.assignee_id, task.created_by_id})
    return _serialize(task, names)


@router.patch("/{task_id}", response_model=TaskOut)
async def update_task(
    task_id: uuid.UUID,
    payload: TaskUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    task = await db.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    data = payload.model_dump(exclude_unset=True)
    if "status" in data and data["status"] not in STATUSES:
        raise HTTPException(status_code=422, detail="Invalid status")
    if "priority" in data and data["priority"] not in PRIORITIES:
        raise HTTPException(status_code=422, detail="Invalid priority")

    prev_assignee = task.assignee_id
    for field, value in data.items():
        setattr(task, field, value)
    if "status" in data:
        task.completed_at = (
            datetime.now(timezone.utc) if data["status"] == "done" else None
        )
    # Notify a newly-assigned person.
    if task.assignee_id and task.assignee_id not in (prev_assignee, user.id):
        await notify_user(
            db,
            user_id=task.assignee_id,
            title="A task was assigned to you",
            body=task.title,
            link="/tasks",
            category="task",
        )
    await db.commit()
    await db.refresh(task)
    names = await user_names(db, {task.assignee_id, task.created_by_id})
    return _serialize(task, names)


@router.delete("/{task_id}", status_code=204)
async def delete_task(
    task_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    task = await db.get(Task, task_id)
    if task:
        await db.delete(task)
        await db.commit()
