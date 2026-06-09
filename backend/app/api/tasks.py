import uuid
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import case, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth.deps import get_current_user
from app.core.database import get_db
from app.models.user import User
from app.models.workplace import Task, TaskComment, TaskItem
from app.schemas.workplace import (
    TaskCommentCreate,
    TaskCommentOut,
    TaskCreate,
    TaskDetail,
    TaskItemCreate,
    TaskItemOut,
    TaskItemUpdate,
    TaskOut,
    TaskUpdate,
)
from app.services.activity import record
from app.services.notify import notify_user
from app.services.onboarding_sync import reflect_task_into_checklist
from app.services.people import user_names

router = APIRouter(prefix="/tasks", tags=["tasks"])

STATUSES = {"todo", "in_progress", "blocked", "done"}
PRIORITIES = {"low", "normal", "high", "urgent"}
RECURRENCES = {"daily", "weekly", "monthly"}


def _advance(d: date, rec: str) -> date:
    if rec == "daily":
        return d + timedelta(days=1)
    if rec == "weekly":
        return d + timedelta(weeks=1)
    if rec == "monthly":
        month = d.month + 1
        year = d.year + (month - 1) // 12
        month = (month - 1) % 12 + 1
        leap = year % 4 == 0 and (year % 100 != 0 or year % 400 == 0)
        last = [31, 29 if leap else 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]
        return date(year, month, min(d.day, last))
    return d


async def _aggregates(
    db: AsyncSession, ids: set[uuid.UUID]
) -> dict[uuid.UUID, tuple[int, int, int]]:
    """task_id -> (subtasks_total, subtasks_done, comment_count)."""
    if not ids:
        return {}
    done_expr = case((TaskItem.done.is_(True), 1), else_=0)
    item_rows = (
        await db.execute(
            select(
                TaskItem.task_id,
                func.count(),
                func.coalesce(func.sum(done_expr), 0),
            )
            .where(TaskItem.task_id.in_(ids))
            .group_by(TaskItem.task_id)
        )
    ).all()
    comment_rows = (
        await db.execute(
            select(TaskComment.task_id, func.count())
            .where(TaskComment.task_id.in_(ids))
            .group_by(TaskComment.task_id)
        )
    ).all()
    items = {r[0]: (int(r[1]), int(r[2])) for r in item_rows}
    comments = {r[0]: int(r[1]) for r in comment_rows}
    return {
        tid: (items.get(tid, (0, 0))[0], items.get(tid, (0, 0))[1], comments.get(tid, 0))
        for tid in ids
    }


def _serialize(task: Task, names: dict, agg: dict | None = None) -> TaskOut:
    out = TaskOut.model_validate(task)
    out.assignee_name = names.get(task.assignee_id) if task.assignee_id else None
    out.created_by_name = names.get(task.created_by_id) if task.created_by_id else None
    total, done, comments = (agg or {}).get(task.id, (0, 0, 0))
    out.subtasks_total = total
    out.subtasks_done = done
    out.comment_count = comments
    return out


@router.get("", response_model=list[TaskOut])
async def list_tasks(
    status: str | None = None,
    priority: str | None = None,
    assignee_id: uuid.UUID | None = None,
    mine: bool = Query(False, description="Only tasks assigned to or created by me"),
    due: str | None = Query(None, description="overdue | week"),
    q: str | None = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    stmt = select(Task).order_by(Task.created_at.desc())
    if status:
        stmt = stmt.where(Task.status == status)
    if priority:
        stmt = stmt.where(Task.priority == priority)
    if assignee_id:
        stmt = stmt.where(Task.assignee_id == assignee_id)
    if mine:
        stmt = stmt.where(
            or_(Task.assignee_id == user.id, Task.created_by_id == user.id)
        )
    if due == "overdue":
        stmt = stmt.where(
            Task.due_date.is_not(None), Task.due_date < date.today(), Task.status != "done"
        )
    elif due == "week":
        stmt = stmt.where(
            Task.due_date.is_not(None),
            Task.due_date <= date.today() + timedelta(days=7),
            Task.status != "done",
        )
    if q:
        stmt = stmt.where(Task.title.ilike(f"%{q}%"))
    tasks = (await db.execute(stmt)).scalars().all()
    names = await user_names(
        db, {t.assignee_id for t in tasks} | {t.created_by_id for t in tasks}
    )
    agg = await _aggregates(db, {t.id for t in tasks})
    return [_serialize(t, names, agg) for t in tasks]


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
    if payload.recurrence and payload.recurrence not in RECURRENCES:
        raise HTTPException(status_code=422, detail="Invalid recurrence")
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
        summary=f"{user.display_name or user.email} created task '{task.title}'",
    )
    await db.commit()
    await db.refresh(task)
    names = await user_names(db, {task.assignee_id, task.created_by_id})
    return _serialize(task, names)


@router.get("/{task_id}", response_model=TaskDetail)
async def get_task(
    task_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    task = await db.get(
        Task, task_id,
        options=[selectinload(Task.items), selectinload(Task.comments)],
    )
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    ids = {task.assignee_id, task.created_by_id} | {c.author_id for c in task.comments}
    names = await user_names(db, ids)
    detail = TaskDetail.model_validate(task)
    detail.assignee_name = names.get(task.assignee_id) if task.assignee_id else None
    detail.created_by_name = names.get(task.created_by_id) if task.created_by_id else None
    detail.subtasks_total = len(task.items)
    detail.subtasks_done = sum(1 for i in task.items if i.done)
    detail.comment_count = len(task.comments)
    detail.items = [TaskItemOut.model_validate(i) for i in task.items]
    detail.comments = []
    for c in task.comments:
        co = TaskCommentOut.model_validate(c)
        co.author_name = names.get(c.author_id) if c.author_id else None
        detail.comments.append(co)
    return detail


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
    if data.get("recurrence") and data["recurrence"] not in RECURRENCES:
        raise HTTPException(status_code=422, detail="Invalid recurrence")

    prev_assignee = task.assignee_id
    prev_status = task.status
    for field, value in data.items():
        setattr(task, field, value)
    if "status" in data:
        task.completed_at = (
            datetime.now(timezone.utc) if data["status"] == "done" else None
        )

    # Activity for status moves.
    actor = user.display_name or user.email
    if "status" in data and data["status"] != prev_status:
        record(
            db, user=user, action="status", entity_type="task", entity_id=task.id,
            summary=f"{actor} moved task {prev_status} → {data['status']}",
        )
        # If this task mirrors an onboarding checklist item, keep it in sync.
        if task.onboarding_task_id:
            await reflect_task_into_checklist(db, task, user.id)

    # Recurring tasks spawn the next occurrence when completed.
    if (
        "status" in data
        and data["status"] == "done"
        and prev_status != "done"
        and task.recurrence in RECURRENCES
    ):
        base = task.due_date or date.today()
        nxt = Task(
            title=task.title,
            description=task.description,
            priority=task.priority,
            recurrence=task.recurrence,
            assignee_id=task.assignee_id,
            brand_id=task.brand_id,
            created_by_id=task.created_by_id,
            due_date=_advance(base, task.recurrence),
            status="todo",
        )
        db.add(nxt)
        record(
            db, user=user, action="created", entity_type="task", entity_id=nxt.id,
            summary=f"Recurring task '{nxt.title}' scheduled for {nxt.due_date}",
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
    agg = await _aggregates(db, {task.id})
    return _serialize(task, names, agg)


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


# ---- Subtasks / checklist ----
@router.post("/{task_id}/items", response_model=TaskItemOut, status_code=201)
async def add_item(
    task_id: uuid.UUID,
    payload: TaskItemCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    task = await db.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    nxt = (
        await db.execute(
            select(func.coalesce(func.max(TaskItem.sort), -1)).where(
                TaskItem.task_id == task_id
            )
        )
    ).scalar()
    item = TaskItem(task_id=task_id, title=payload.title, sort=int(nxt) + 1)
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return TaskItemOut.model_validate(item)


@router.patch("/items/{item_id}", response_model=TaskItemOut)
async def update_item(
    item_id: uuid.UUID,
    payload: TaskItemUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    item = await db.get(TaskItem, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(item, field, value)
    await db.commit()
    await db.refresh(item)
    return TaskItemOut.model_validate(item)


@router.delete("/items/{item_id}", status_code=204)
async def delete_item(
    item_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    item = await db.get(TaskItem, item_id)
    if item:
        await db.delete(item)
        await db.commit()


# ---- Comments ----
@router.post("/{task_id}/comments", response_model=TaskCommentOut, status_code=201)
async def add_comment(
    task_id: uuid.UUID,
    payload: TaskCommentCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    task = await db.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    comment = TaskComment(task_id=task_id, author_id=user.id, body=payload.body)
    db.add(comment)
    # Notify the other party (assignee or creator) of the new comment.
    target = task.created_by_id if user.id == task.assignee_id else task.assignee_id
    if target and target != user.id:
        await notify_user(
            db,
            user_id=target,
            title="New comment on a task",
            body=task.title,
            link="/tasks",
            category="task",
        )
    await db.commit()
    await db.refresh(comment)
    out = TaskCommentOut.model_validate(comment)
    out.author_name = user.display_name or user.email
    return out
