import uuid
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from sqlalchemy import case, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth.deps import get_current_user
from app.core.database import get_db
from app.models.user import User
from app.models.department import Department
from app.services.task_access import can_access_task, team_ids
from app.services.task_assignment_email import assignment_states, deliver_assignment_emails, notify_assignment
from app.models.workplace import Project, Task, TaskComment, TaskItem
from app.schemas.workplace import (
    ProjectCreate,
    ProjectOut,
    ProjectUpdate,
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
projects_router = APIRouter(prefix="/projects", tags=["projects"])

# ``submitted`` belongs to checklist runs (awaiting manager verification); it is
# accepted here so run rows serialise, but runs are edited via /checklist-runs.
STATUSES = {"todo", "in_progress", "blocked", "submitted", "done"}
PRIORITIES = {"low", "normal", "high", "urgent"}
RECURRENCES = {"daily", "weekly", "monthly"}
PROJECT_STATUSES = {"planned", "active", "on_hold", "completed", "cancelled"}


async def _project_out(db: AsyncSession, project: Project) -> ProjectOut:
    total, completed = (
        await db.execute(
            select(
                func.count(Task.id),
                func.coalesce(func.sum(case((Task.status == "done", 1), else_=0)), 0),
            ).where(Task.project_id == project.id)
        )
    ).one()
    names = await user_names(db, {project.owner_id})
    total = int(total)
    completed = int(completed)
    out = ProjectOut.model_validate(project)
    out.owner_name = names.get(project.owner_id) if project.owner_id else None
    out.task_count = total
    out.completed_tasks = completed
    out.progress = round(completed / total * 100) if total else 0
    return out


@projects_router.get("", response_model=list[ProjectOut])
async def list_projects(
    status: str | None = None,
    owner_id: uuid.UUID | None = None,
    company_id: uuid.UUID | None = None,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    stmt = select(Project).order_by(Project.created_at.desc())
    if status:
        stmt = stmt.where(Project.status == status)
    if owner_id:
        stmt = stmt.where(Project.owner_id == owner_id)
    if company_id:
        stmt = stmt.where(Project.company_id == company_id)
    projects = (await db.execute(stmt)).scalars().all()
    return [await _project_out(db, project) for project in projects]


@projects_router.post("", response_model=ProjectOut, status_code=201)
async def create_project(
    payload: ProjectCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if payload.status not in PROJECT_STATUSES:
        raise HTTPException(status_code=422, detail="Invalid project status")
    if payload.start_date and payload.end_date and payload.end_date < payload.start_date:
        raise HTTPException(status_code=422, detail="End date must be on or after start date")
    data = payload.model_dump()
    data["owner_id"] = payload.owner_id or user.id
    project = Project(**data)
    db.add(project)
    record(
        db, user=user, action="created", entity_type="project", entity_id=project.id,
        summary=f"{user.display_name or user.email} created project '{project.name}'",
    )
    await db.commit()
    await db.refresh(project)
    return await _project_out(db, project)


@projects_router.get("/{project_id}", response_model=ProjectOut)
async def get_project(
    project_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    project = await db.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return await _project_out(db, project)


@projects_router.patch("/{project_id}", response_model=ProjectOut)
async def update_project(
    project_id: uuid.UUID,
    payload: ProjectUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    project = await db.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if not (user.is_admin or user.role == "manager" or project.owner_id == user.id):
        raise HTTPException(status_code=403, detail="Only the project owner or a manager can edit it")
    data = payload.model_dump(exclude_unset=True)
    if "status" in data and data["status"] not in PROJECT_STATUSES:
        raise HTTPException(status_code=422, detail="Invalid project status")
    start = data.get("start_date", project.start_date)
    end = data.get("end_date", project.end_date)
    if start and end and end < start:
        raise HTTPException(status_code=422, detail="End date must be on or after start date")
    for field, value in data.items():
        setattr(project, field, value)
    await db.commit()
    await db.refresh(project)
    return await _project_out(db, project)


@projects_router.delete("/{project_id}", status_code=204)
async def delete_project(
    project_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    project = await db.get(Project, project_id)
    if not project:
        return
    if not (user.is_admin or user.role == "manager" or project.owner_id == user.id):
        raise HTTPException(status_code=403, detail="Only the project owner or a manager can delete it")
    await db.delete(project)
    await db.commit()


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


async def _can_access_task(db, user: User, task: Task) -> bool:
    return await can_access_task(db, user, task)


async def _validate_assignee(db, assignee_id, department_id=None):
    if assignee_id:
        owner = await db.get(User, assignee_id)
        if not owner or not owner.is_active or owner.status != "active":
            raise HTTPException(422, "Choose an active team member.")
        if department_id and owner.department_id != department_id:
            raise HTTPException(422, "Choose a person from the selected department.")


async def _enrich_tasks(db, outputs):
    owner_ids = {item.assignee_id for item in outputs if item.assignee_id}
    people = (await db.scalars(select(User).where(User.id.in_(owner_ids)))).all() if owner_ids else []
    departments = {row.id: row.name for row in (await db.scalars(select(Department))).all()}
    owners = {row.id: row for row in people}
    states = await assignment_states(db)
    for item in outputs:
        owner = owners.get(item.assignee_id)
        item.assignee_department_id = owner.department_id if owner else None
        item.assignee_department_name = departments.get(owner.department_id) if owner else None
        item.assignment_email_status = states.get(item.id)
    return outputs


@router.get("/options")
async def task_options(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    people = (await db.scalars(select(User).where(User.is_active.is_(True),
        User.status == "active").order_by(User.display_name, User.email))).all()
    departments = (await db.scalars(select(Department).order_by(Department.name))).all()
    own_team = await team_ids(db, user)
    return {"users": [{"id": str(row.id), "name": row.display_name or row.email,
        "department_id": str(row.department_id) if row.department_id else None,
        "in_team": user.is_admin or row.id in own_team} for row in people],
        "departments": [{"id": str(row.id), "name": row.name} for row in departments]}


@router.get("/compliance")
async def compliance_tasks(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    if "sharepoint_intelligence" not in user.effective_permissions:
        return {"tasks": [], "available": False, "message": None}
    from app.api.sharepoint_compliance import dashboard
    from app.services.sharepoint.common import SharePointError
    try:
        data = await dashboard(user=user, db=db)
    except SharePointError as error:
        messages = {
            "microsoft_connection_required": "Connect Microsoft in Compliance to see your document tasks.",
            "sharepoint_disabled": None,
            "sharepoint_not_configured": "Document tasks are waiting for SharePoint setup.",
        }
        if error.code not in messages:
            raise
        return {"tasks": [], "available": False, "message": messages[error.code]}
    from app.models.sharepoint import SharePointComplianceTask
    rows = {row.id: row for row in (await db.scalars(select(SharePointComplianceTask).where(
        SharePointComplianceTask.id.in_([uuid.UUID(item["id"]) for item in data["tasks"]])))).all()}
    people = {row.id: row for row in (await db.scalars(select(User))).all()}
    departments = {row.id: row.name for row in (await db.scalars(select(Department))).all()}
    states = await assignment_states(db, compliance=True)
    documents = {item["id"]: item for item in data["documents"]}
    results = []
    for item in data["tasks"]:
        if item["status"] not in {"active", "completed"}:
            continue
        row = rows[uuid.UUID(item["id"])]
        owner = people.get(row.owner_user_id)
        dept_id = row.owner_department_id or (owner.department_id if owner else None)
        results.append({
            **item, "document_url": documents[item["document_id"]]["url"],
            "document_expiry_date": documents[item["document_id"]]["expiry_date"],
            "reference_number": documents[item["document_id"]]["reference_number"],
            "source": "compliance", "status": "done" if row.status == "completed" else row.work_status,
            "lifecycle_status": row.status, "priority": "high",
            "description": f'{item["document_name"]} · {item["company"] or "External entity"}',
            "assignee_id": item["owner_user_id"], "assignee_name": item["owner"],
            "assignee_department_id": str(dept_id) if dept_id else None,
            "assignee_department_name": departments.get(dept_id),
            "can_change_status": item["can_complete"], "can_delete": False,
            "assignment_email_status": states.get(row.id), "created_at": row.created_at.isoformat(),
            "completed_at": row.completed_at.isoformat() if row.completed_at else None,
            "subtasks_total": 0, "subtasks_done": 0, "comment_count": 0})
    return {"tasks": results, "available": True, "message": None}


@router.get("", response_model=list[TaskOut])
async def list_tasks(
    status: str | None = None,
    priority: str | None = None,
    assignee_id: uuid.UUID | None = None,
    mine: bool = Query(False, description="Only tasks assigned to or created by me"),
    due: str | None = Query(None, description="overdue | week"),
    q: str | None = None,
    include_runs: bool = Query(
        False,
        description="Include recurring checklist runs (excluded by default — a "
        "daily 100-item round would swamp the board; see /api/checklist-runs)",
    ),
    project_id: uuid.UUID | None = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    stmt = select(Task).order_by(Task.created_at.desc())
    if not include_runs:
        stmt = stmt.where(Task.template_id.is_(None))
    # Members only see tasks they created or are assigned to; admins and
    # managers see their department and direct reports. Without this any member
    # could read every task in the company.
    if not user.is_admin:
        scope_ids = await team_ids(db, user)
        stmt = stmt.where(or_(Task.assignee_id.in_(scope_ids), Task.created_by_id.in_(scope_ids)))
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
    if project_id:
        stmt = stmt.where(Task.project_id == project_id)
    tasks = (await db.execute(stmt)).scalars().all()
    names = await user_names(
        db, {t.assignee_id for t in tasks} | {t.created_by_id for t in tasks}
    )
    agg = await _aggregates(db, {t.id for t in tasks})
    return await _enrich_tasks(db, [_serialize(t, names, agg) for t in tasks])


@router.post("", response_model=TaskOut, status_code=201)
async def create_task(
    payload: TaskCreate,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if payload.status not in STATUSES:
        raise HTTPException(status_code=422, detail="Invalid status")
    if payload.priority not in PRIORITIES:
        raise HTTPException(status_code=422, detail="Invalid priority")
    if payload.recurrence and payload.recurrence not in RECURRENCES:
        raise HTTPException(status_code=422, detail="Invalid recurrence")
    if not payload.title.strip():
        raise HTTPException(422, "Enter a task title.")
    await _validate_assignee(db, payload.assignee_id, payload.department_id)
    data = payload.model_dump(exclude={"department_id"})
    data["title"] = payload.title.strip()
    task = Task(**data, created_by_id=user.id)
    db.add(task)
    await notify_assignment(db, task, actor_id=user.id)
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
    background_tasks.add_task(deliver_assignment_emails)
    return (await _enrich_tasks(db, [_serialize(task, names)]))[0]


@router.get("/{task_id}", response_model=TaskDetail)
async def get_task(
    task_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    task = await db.get(
        Task, task_id,
        options=[selectinload(Task.items), selectinload(Task.comments)],
    )
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    if not await _can_access_task(db, user, task):
        raise HTTPException(status_code=403, detail="You don't have access to this task")
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
    return (await _enrich_tasks(db, [detail]))[0]


@router.patch("/{task_id}", response_model=TaskOut)
async def update_task(
    task_id: uuid.UUID,
    payload: TaskUpdate,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    task = await db.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    if not await _can_access_task(db, user, task):
        raise HTTPException(status_code=403, detail="You don't have access to this task")
    if task.template_id:
        raise HTTPException(
            status_code=409,
            detail="This is a checklist run — use /api/checklist-runs to respond, "
            "submit or verify it",
        )
    data = payload.model_dump(exclude_unset=True, exclude={"department_id"})
    if "title" in data:
        if not (data["title"] or "").strip():
            raise HTTPException(422, "Enter a task title.")
        data["title"] = data["title"].strip()
    if "assignee_id" in data:
        await _validate_assignee(db, data["assignee_id"], payload.department_id)
    if any(data.get(key) is None for key in ("status", "priority") if key in data):
        raise HTTPException(422, "Status and priority are required.")
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
            company_id=task.company_id,
            project_id=task.project_id,
            created_by_id=task.created_by_id,
            due_date=_advance(base, task.recurrence),
            status="todo",
        )
        # Carry the checklist across, unticked — a recurring task whose subtasks
        # vanished on the first completion is useless for anything routine.
        prev_items = (
            await db.execute(
                select(TaskItem)
                .where(TaskItem.task_id == task.id)
                .order_by(TaskItem.sort.asc())
            )
        ).scalars().all()
        for src in prev_items:
            nxt.items.append(
                TaskItem(
                    title=src.title,
                    sort=src.sort,
                    section=src.section,
                    response_type=src.response_type,
                    photo_required=src.photo_required,
                    asset_id=src.asset_id,
                    auto_ticket_on_issue=src.auto_ticket_on_issue,
                    ticket_priority=src.ticket_priority,
                    status="pending",
                    done=False,
                )
            )
        db.add(nxt)
        await notify_assignment(db, nxt, actor_id=user.id)
        record(
            db, user=user, action="created", entity_type="task", entity_id=nxt.id,
            summary=f"Recurring task '{nxt.title}' scheduled for {nxt.due_date}",
        )

    if task.assignee_id and task.assignee_id != prev_assignee:
        await notify_assignment(db, task, actor_id=user.id)
    await db.commit()
    await db.refresh(task)
    names = await user_names(db, {task.assignee_id, task.created_by_id})
    agg = await _aggregates(db, {task.id})
    background_tasks.add_task(deliver_assignment_emails)
    return (await _enrich_tasks(db, [_serialize(task, names, agg)]))[0]


@router.delete("/{task_id}", status_code=204)
async def delete_task(
    task_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    task = await db.get(Task, task_id)
    if not task:
        return
    if not await _can_access_task(db, user, task):
        raise HTTPException(status_code=403, detail="You don't have access to this task")
    await db.delete(task)
    await db.commit()


# ---- Subtasks / checklist ----
@router.post("/{task_id}/items", response_model=TaskItemOut, status_code=201)
async def add_item(
    task_id: uuid.UUID,
    payload: TaskItemCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    task = await db.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    if not await _can_access_task(db, user, task):
        raise HTTPException(status_code=403, detail="You don't have access to this task")
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
    user: User = Depends(get_current_user),
):
    item = await db.get(TaskItem, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    parent = await db.get(Task, item.task_id)
    if parent and not await _can_access_task(db, user, parent):
        raise HTTPException(status_code=403, detail="You don't have access to this task")
    data = payload.model_dump(exclude_unset=True)
    for field, value in data.items():
        setattr(item, field, value)
    if "done" in data:
        # Keep the richer checklist status in step with the plain tick.
        item.status = "done" if data["done"] else "pending"
    await db.commit()
    await db.refresh(item)
    return TaskItemOut.model_validate(item)


@router.delete("/items/{item_id}", status_code=204)
async def delete_item(
    item_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    item = await db.get(TaskItem, item_id)
    if not item:
        return
    parent = await db.get(Task, item.task_id)
    if parent and not await _can_access_task(db, user, parent):
        raise HTTPException(status_code=403, detail="You don't have access to this task")
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
    if not await _can_access_task(db, user, task):
        raise HTTPException(status_code=403, detail="You don't have access to this task")
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
