"""Generate and drive recurring checklist runs.

A *run* is an ordinary :class:`~app.models.workplace.Task` carrying
``template_id`` + ``run_date``. Generation is idempotent — the unique constraint
on ``(template_id, run_date)`` means the periodic job can run as often as it
likes, and a manual "generate now" can't produce duplicates.

Unlike the completion-chained recurrence on plain tasks, runs are produced by
the calendar. Skipping a day therefore leaves a visible, unsubmitted run rather
than silently breaking the chain.
"""
import calendar
import logging
import uuid
from datetime import date, datetime, time, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.checklist import ChecklistTemplate, ChecklistTemplateItem
from app.models.tracked_asset import TrackedAsset
from app.models.user import User
from app.models.workplace import Task, TaskItem, Ticket
from app.services.notify import notify_user
from app.services.sla import apply_sla

log = logging.getLogger("checklists")

TICKET_CATEGORIES = {"it", "facilities", "hr", "finance", "other"}


# --------------------------------------------------------------------------
# Schedule maths
# --------------------------------------------------------------------------
def is_due(template: ChecklistTemplate, day: date) -> bool:
    """True when ``template`` should produce a run on ``day``."""
    sched = template.schedule
    if sched == "daily":
        return True
    if sched == "weekdays":
        return day.isoweekday() <= 5
    if sched == "weekly":
        wanted = template.days_of_week or []
        return day.isoweekday() in wanted
    if sched == "monthly":
        target = template.day_of_month or 1
        last = calendar.monthrange(day.year, day.month)[1]
        return day.day == min(target, last)
    return False


def next_run_date(template: ChecklistTemplate, after: date | None = None) -> date | None:
    """The next day this template is due, looking ahead at most ~13 months."""
    start = (after or date.today())
    for offset in range(0, 400):
        day = start + timedelta(days=offset)
        if is_due(template, day):
            return day
    return None


def deadline_for(template: ChecklistTemplate, run_date: date) -> datetime:
    """When a run stops being on time (due_time + grace), as an aware UTC value.

    ``due_time`` is interpreted against the server clock; there is no per-tenant
    timezone in the platform yet, so deployments should run the backend in the
    business's own timezone.
    """
    hh, mm = 23, 59
    if template.due_time and ":" in template.due_time:
        try:
            parts = template.due_time.split(":")
            hh, mm = int(parts[0]), int(parts[1])
        except ValueError:
            pass
    base = datetime.combine(run_date, time(hour=min(hh, 23), minute=min(mm, 59)))
    return base.replace(tzinfo=timezone.utc) + timedelta(
        minutes=max(template.grace_minutes or 0, 0)
    )


def _as_aware(value: datetime | None) -> datetime | None:
    """Treat a naive timestamp as UTC (SQLite drops tzinfo on round-trip)."""
    if value is None or value.tzinfo is not None:
        return value
    return value.replace(tzinfo=timezone.utc)


def run_is_late(task: Task, deadline: datetime | None) -> bool:
    """A run is late when its deadline passed before it was submitted."""
    if deadline is None:
        return False
    if task.status in ("submitted", "done"):
        reference = _as_aware(task.submitted_at)
        return bool(reference and reference > deadline)
    return datetime.now(timezone.utc) > deadline


# --------------------------------------------------------------------------
# Generation
# --------------------------------------------------------------------------
async def _resolve_reviewer(
    db: AsyncSession, template: ChecklistTemplate
) -> uuid.UUID | None:
    """Explicit reviewer, else the assignee's reporting manager."""
    if template.reviewer_id:
        return template.reviewer_id
    if not template.assignee_id:
        return None
    assignee = await db.get(User, template.assignee_id)
    return assignee.manager_id if assignee else None


def _build_run(
    template: ChecklistTemplate,
    day: date,
    reviewer_id: uuid.UUID | None,
) -> Task:
    task = Task(
        title=f"{template.name} — {day.isoformat()}",
        description=template.description,
        status="todo",
        priority="normal",
        due_date=day,
        run_date=day,
        template_id=template.id,
        assignee_id=template.assignee_id,
        reviewer_id=reviewer_id if template.requires_verification else None,
        company_id=template.company_id,
        created_by_id=template.created_by_id,
    )
    for i, it in enumerate(sorted(template.items, key=lambda x: x.sort)):
        task.items.append(
            TaskItem(
                title=it.title,
                section=it.section,
                sort=it.sort or i,
                status="pending",
                response_type=it.response_type,
                photo_required=it.photo_required,
                asset_id=it.asset_id,
                auto_ticket_on_issue=it.auto_ticket_on_issue,
                ticket_priority=it.ticket_priority,
                done=False,
            )
        )
    return task


async def generate_for_template(
    db: AsyncSession, template: ChecklistTemplate, day: date
) -> Task | None:
    """Create the run for ``day`` unless one already exists. Commits."""
    if not template.active or not is_due(template, day):
        return None
    existing = (
        await db.execute(
            select(Task.id).where(Task.template_id == template.id, Task.run_date == day)
        )
    ).scalar_one_or_none()
    if existing:
        return None

    reviewer_id = await _resolve_reviewer(db, template)
    task = _build_run(template, day, reviewer_id)
    db.add(task)
    try:
        await db.commit()
    except IntegrityError:
        # Another worker generated the same run first — that's the point of the
        # unique constraint, so treat it as a no-op.
        await db.rollback()
        return None
    await db.refresh(task)

    if task.assignee_id:
        await notify_user(
            db,
            user_id=task.assignee_id,
            title="Today's checks are ready",
            body=task.title,
            link="/routine-checks",
            category="task",
            dedup_key=f"run-assigned:{task.id}",
        )
        await db.commit()
    return task


async def generate_due_runs(db: AsyncSession, on: date | None = None) -> list[Task]:
    """Materialise every active template due on ``on`` (default: today)."""
    day = on or date.today()
    templates = (
        (
            await db.execute(
                select(ChecklistTemplate)
                .options(selectinload(ChecklistTemplate.items))
                .where(ChecklistTemplate.active.is_(True))
            )
        )
        .scalars()
        .all()
    )
    created: list[Task] = []
    for tpl in templates:
        run = await generate_for_template(db, tpl, day)
        if run:
            created.append(run)
    return created


async def run_checklist_generation(db: AsyncSession) -> dict:
    """Scheduler entry point — matches the other periodic jobs' contract."""
    created = await generate_due_runs(db)
    return {"created": len(created)}


async def run_missed_alerts(db: AsyncSession) -> dict:
    """Notify reviewers about runs whose deadline passed without a submission."""
    templates = {
        t.id: t
        for t in (
            (await db.execute(select(ChecklistTemplate))).scalars().all()
        )
    }
    if not templates:
        return {"created": 0}
    open_runs = (
        (
            await db.execute(
                select(Task).where(
                    Task.template_id.is_not(None),
                    Task.status.in_(("todo", "in_progress")),
                    Task.run_date >= date.today() - timedelta(days=7),
                )
            )
        )
        .scalars()
        .all()
    )
    created = 0
    for run in open_runs:
        tpl = templates.get(run.template_id)
        if not tpl or not run.run_date:
            continue
        if datetime.now(timezone.utc) <= deadline_for(tpl, run.run_date):
            continue
        target = run.reviewer_id or run.assignee_id
        if not target:
            continue
        note = await notify_user(
            db,
            user_id=target,
            title="Checks not submitted on time",
            body=run.title,
            link="/routine-checks",
            category="task",
            dedup_key=f"run-late:{run.id}",
        )
        if note is not None:
            created += 1
    if created:
        await db.commit()
    return {"created": created}


# --------------------------------------------------------------------------
# Issues → service desk
# --------------------------------------------------------------------------
async def _next_ticket_number(db: AsyncSession) -> int:
    current = (await db.execute(select(func.max(Ticket.number)))).scalar()
    return (current or 1000) + 1


async def raise_ticket_for_item(
    db: AsyncSession,
    *,
    task: Task,
    item: TaskItem,
    template: ChecklistTemplate | None,
    user: User,
) -> Ticket | None:
    """Open a service-desk ticket for a failed checkpoint.

    Adds the ticket to the session (the caller commits) and links it back to the
    item so the run shows live ticket status.
    """
    if item.ticket_id or not item.auto_ticket_on_issue:
        return None
    category = (template.team if template else "it")
    if category not in TICKET_CATEGORIES:
        category = "other"

    asset_name = None
    if item.asset_id:
        asset = await db.get(TrackedAsset, item.asset_id)
        asset_name = asset.name if asset else None

    where = " / ".join(p for p in (item.section, asset_name) if p)
    description = "\n".join(
        p
        for p in (
            f"Raised from checklist run: {task.title}",
            f"Location: {where}" if where else None,
            f"Checker's note: {item.note}" if item.note else None,
        )
        if p
    )
    ticket = Ticket(
        number=await _next_ticket_number(db),
        subject=f"{item.title}{f' — {where}' if where else ''}",
        description=description,
        category=category,
        priority=item.ticket_priority or "normal",
        status="open",
        requester_id=user.id,
        asset_id=item.asset_id,
        company_id=task.company_id,
    )
    await apply_sla(db, ticket)
    db.add(ticket)
    await db.flush()
    item.ticket_id = ticket.id
    return ticket
