"""Personal 'My Work' aggregation — the daily home surface.

Open to any active user; it only ever returns the caller's own items, so it is
not module-gated (a user without a given module simply sees nothing there).
"""
import uuid
from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.approvals import _serialize as ser_approval
from app.api.people import _maybe_complete, _task_out
from app.api.tasks import _serialize as ser_task
from app.api.service_desk import _serialize as ser_ticket
from app.auth.deps import get_current_user
from app.services.onboarding_sync import sync_linked_task
from app.core.database import get_db
from app.models.people import OnboardingJourney, OnboardingTask
from app.models.user import User
from app.models.workplace import (
    Announcement,
    AnnouncementRead,
    ApprovalRequest,
    Task,
    Ticket,
)
from app.schemas.workplace import WorkSummary
from app.services.people import user_names

router = APIRouter(prefix="/me", tags=["my-work"])

OPEN_TICKET = ("open", "in_progress")


async def _count(db: AsyncSession, stmt) -> int:
    return int((await db.execute(stmt)).scalar_one())


@router.get("/work", response_model=WorkSummary)
async def my_work(
    db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)
):
    today = date.today()
    is_reviewer = user.is_admin or user.role == "manager"
    out = WorkSummary()

    # --- Tasks assigned to me (not done) ---
    my_tasks = (
        await db.execute(
            select(Task)
            .where(Task.assignee_id == user.id, Task.status != "done")
            .order_by(Task.due_date.is_(None), Task.due_date.asc())
            .limit(8)
        )
    ).scalars().all()
    out.tasks_open = await _count(
        db,
        select(func.count())
        .select_from(Task)
        .where(Task.assignee_id == user.id, Task.status != "done"),
    )
    out.tasks_overdue = await _count(
        db,
        select(func.count())
        .select_from(Task)
        .where(
            Task.assignee_id == user.id,
            Task.status != "done",
            Task.due_date.is_not(None),
            Task.due_date < today,
        ),
    )
    tnames = await user_names(
        db, {t.assignee_id for t in my_tasks} | {t.created_by_id for t in my_tasks}
    )
    out.my_tasks = [ser_task(t, tnames) for t in my_tasks]

    # --- Approvals: mine pending + waiting on me ---
    mine = (
        await db.execute(
            select(ApprovalRequest)
            .where(
                ApprovalRequest.requester_id == user.id,
                ApprovalRequest.status == "pending",
            )
            .order_by(ApprovalRequest.created_at.desc())
            .limit(8)
        )
    ).scalars().all()
    out.approvals_pending = len(mine)

    review: list[ApprovalRequest] = []
    if is_reviewer:
        review = (
            await db.execute(
                select(ApprovalRequest)
                .where(
                    ApprovalRequest.status == "pending",
                    or_(
                        ApprovalRequest.approver_id == user.id,
                        ApprovalRequest.approver_id.is_(None),
                    ),
                    ApprovalRequest.requester_id != user.id,
                )
                .order_by(ApprovalRequest.created_at.asc())
                .limit(8)
            )
        ).scalars().all()
    else:
        review = (
            await db.execute(
                select(ApprovalRequest).where(
                    ApprovalRequest.status == "pending",
                    ApprovalRequest.approver_id == user.id,
                )
            )
        ).scalars().all()
    out.approvals_to_review = len(review)

    anames = await user_names(
        db,
        {a.requester_id for a in (*mine, *review)}
        | {a.approver_id for a in (*mine, *review)},
    )
    out.my_approvals = [ser_approval(a, anames) for a in mine]
    out.review_approvals = [ser_approval(a, anames) for a in review[:8]]

    # --- Tickets ---
    my_tickets = (
        await db.execute(
            select(Ticket)
            .where(
                or_(
                    Ticket.requester_id == user.id,
                    Ticket.assignee_id == user.id,
                ),
                Ticket.status.in_(OPEN_TICKET),
            )
            .order_by(Ticket.created_at.desc())
            .limit(8)
        )
    ).scalars().all()
    out.tickets_open = await _count(
        db,
        select(func.count())
        .select_from(Ticket)
        .where(Ticket.requester_id == user.id, Ticket.status.in_(OPEN_TICKET)),
    )
    out.tickets_assigned = await _count(
        db,
        select(func.count())
        .select_from(Ticket)
        .where(Ticket.assignee_id == user.id, Ticket.status.in_(OPEN_TICKET)),
    )
    knames = await user_names(
        db,
        {t.requester_id for t in my_tickets} | {t.assignee_id for t in my_tickets},
    )
    out.my_tickets = [ser_ticket(t, knames, {}) for t in my_tickets]

    # --- Unread announcements ---
    published = await _count(
        db,
        select(func.count())
        .select_from(Announcement)
        .where(Announcement.is_published.is_(True)),
    )
    read = await _count(
        db,
        select(func.count())
        .select_from(AnnouncementRead)
        .where(AnnouncementRead.user_id == user.id),
    )
    out.announcements_unread = max(published - read, 0)

    # --- Onboarding/offboarding actions assigned to me (pending) ---
    ob_tasks = (
        await db.execute(
            select(OnboardingTask)
            .join(OnboardingJourney, OnboardingTask.journey_id == OnboardingJourney.id)
            .where(
                OnboardingTask.owner_id == user.id,
                OnboardingTask.status == "pending",
                OnboardingJourney.status == "in_progress",
            )
            .order_by(OnboardingTask.sort.asc())
        )
    ).scalars().all()
    out.onboarding_open = len(ob_tasks)
    onames = await user_names(db, {t.owner_id for t in ob_tasks})
    out.my_onboarding_tasks = [_task_out(t, onames) for t in ob_tasks]

    return out


@router.post("/onboarding-tasks/{task_id}/done", response_model=dict)
async def complete_onboarding_task(
    task_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Let an assigned owner tick off their checklist item from My Work,
    without needing access to the full People-ops module."""
    task = await db.get(OnboardingTask, task_id)
    if not task or task.owner_id != user.id:
        raise HTTPException(status_code=404, detail="Task not found")
    task.status = "done"
    task.done_by_id = user.id
    task.done_at = datetime.now(timezone.utc)
    await sync_linked_task(db, task, user.id)
    await _maybe_complete(db, task.journey_id, user)
    await db.commit()
    return {"ok": True}
