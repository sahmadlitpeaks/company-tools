"""Keep onboarding/offboarding checklist items in sync with real Tasks.

When a checklist item is assigned to someone it is mirrored as a Task on that
person's board/dashboard. Completing it from either side keeps the two in step,
and finishing the last item completes the journey.
"""
import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.people import OnboardingJourney, OnboardingTask
from app.models.workplace import Task
from app.services.notify import notify_user

_STATUS_TO_TASK = {"pending": "todo", "done": "done", "na": "done"}


async def _linked_task(db: AsyncSession, ot_id: uuid.UUID) -> Task | None:
    return (
        await db.execute(select(Task).where(Task.onboarding_task_id == ot_id))
    ).scalar_one_or_none()


async def sync_linked_task(
    db: AsyncSession, ot: OnboardingTask, actor_id: uuid.UUID | None = None
) -> None:
    """Create / update / remove the Task that mirrors a checklist item."""
    existing = await _linked_task(db, ot.id)
    # No owner -> nothing to show on anyone's board.
    if not ot.owner_id:
        if existing:
            await db.delete(existing)
        return
    journey = await db.get(OnboardingJourney, ot.journey_id)
    kind = "Offboarding" if (journey and journey.kind == "offboarding") else "Onboarding"
    title = f"[{kind}] {ot.title}"
    status = _STATUS_TO_TASK.get(ot.status, "todo")
    done_at = ot.done_at if status == "done" else None
    if existing:
        existing.title = title
        existing.assignee_id = ot.owner_id
        existing.status = status
        existing.completed_at = done_at
    else:
        db.add(
            Task(
                title=title,
                assignee_id=ot.owner_id,
                created_by_id=(journey.created_by_id if journey else None) or actor_id,
                company_id=journey.company_id if journey else None,
                status=status,
                priority="normal",
                onboarding_task_id=ot.id,
                completed_at=done_at,
            )
        )


async def remove_linked_task(db: AsyncSession, ot_id: uuid.UUID) -> None:
    existing = await _linked_task(db, ot_id)
    if existing:
        await db.delete(existing)


async def complete_journey_if_done(
    db: AsyncSession, journey_id: uuid.UUID, actor_id: uuid.UUID | None = None
) -> None:
    journey = await db.get(OnboardingJourney, journey_id)
    if not journey or journey.status != "in_progress":
        return
    tasks = (
        await db.execute(
            select(OnboardingTask).where(OnboardingTask.journey_id == journey_id)
        )
    ).scalars().all()
    if not tasks or not all(t.status in ("done", "na") for t in tasks):
        return
    journey.status = "completed"
    journey.completed_at = datetime.now(timezone.utc)
    if journey.created_by_id and journey.created_by_id != actor_id:
        await notify_user(
            db,
            user_id=journey.created_by_id,
            title=f"{journey.kind.title()} completed",
            body="All checklist items are done.",
            link="/people-ops",
            category="people_ops",
        )


async def reflect_task_into_checklist(db: AsyncSession, task: Task, actor_id: uuid.UUID) -> None:
    """When a mirrored Task's done-state changes, update the checklist item."""
    if not task.onboarding_task_id:
        return
    ot = await db.get(OnboardingTask, task.onboarding_task_id)
    if not ot:
        return
    if task.status == "done" and ot.status != "done":
        ot.status = "done"
        ot.done_by_id = actor_id
        ot.done_at = datetime.now(timezone.utc)
        await complete_journey_if_done(db, ot.journey_id, actor_id)
    elif task.status != "done" and ot.status == "done":
        ot.status = "pending"
        ot.done_by_id = None
        ot.done_at = None
