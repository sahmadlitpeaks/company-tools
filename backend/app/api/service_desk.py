import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth.deps import get_current_user
from app.core.database import get_db
from app.models.user import User
from app.models.worklog import WorkLog
from app.models.workplace import Ticket, TicketComment
from app.schemas.workplace import (
    TicketCommentCreate,
    TicketCommentOut,
    TicketCreate,
    TicketDetail,
    TicketOut,
    TicketUpdate,
)
from app.services.activity import record
from app.services.notify import notify_user
from app.services.people import user_names

router = APIRouter(prefix="/tickets", tags=["service-desk"])

CATEGORIES = {"it", "facilities", "hr", "finance", "other"}
STATUSES = {"open", "in_progress", "resolved", "closed"}
PRIORITIES = {"low", "normal", "high", "urgent"}
OPEN_STATUSES = {"open", "in_progress"}

# SLA targets in hours by priority: (first-response, resolution).
SLA_HOURS: dict[str, tuple[int, int]] = {
    "urgent": (1, 4),
    "high": (4, 24),
    "normal": (8, 72),
    "low": (24, 120),
}
# Priority ordering for sorting (urgent first).
_PRIO_RANK = {"urgent": 0, "high": 1, "normal": 2, "low": 3}


def _is_agent(user: User) -> bool:
    return user.is_admin or user.role == "manager"


def _apply_sla(ticket: Ticket, base: datetime | None = None) -> None:
    """(Re)compute SLA due dates from the ticket priority."""
    base = base or datetime.now(timezone.utc)
    resp_h, res_h = SLA_HOURS.get(ticket.priority, SLA_HOURS["normal"])
    ticket.sla_response_due = base + timedelta(hours=resp_h)
    ticket.sla_resolution_due = base + timedelta(hours=res_h)


async def _next_number(db: AsyncSession) -> int:
    current = (await db.execute(select(func.max(Ticket.number)))).scalar()
    return (current or 1000) + 1


async def _counts(db: AsyncSession, ids: set[uuid.UUID]) -> dict[uuid.UUID, int]:
    if not ids:
        return {}
    rows = (
        await db.execute(
            select(TicketComment.ticket_id, func.count())
            .where(TicketComment.ticket_id.in_(ids))
            .group_by(TicketComment.ticket_id)
        )
    ).all()
    return {r[0]: int(r[1]) for r in rows}


async def _effort(db: AsyncSession, ids: set[uuid.UUID]) -> dict[uuid.UUID, int]:
    if not ids:
        return {}
    rows = (
        await db.execute(
            select(WorkLog.entity_id, func.coalesce(func.sum(WorkLog.minutes), 0))
            .where(WorkLog.entity_type == "ticket", WorkLog.entity_id.in_(ids))
            .group_by(WorkLog.entity_id)
        )
    ).all()
    return {r[0]: int(r[1]) for r in rows}


def _serialize(t: Ticket, names: dict, counts: dict, effort: dict | None = None) -> TicketOut:
    out = TicketOut.model_validate(t)
    out.requester_name = names.get(t.requester_id) if t.requester_id else None
    out.assignee_name = names.get(t.assignee_id) if t.assignee_id else None
    out.comment_count = counts.get(t.id, 0)
    out.effort_minutes = (effort or {}).get(t.id, 0)
    return out


@router.get("", response_model=list[TicketOut])
async def list_tickets(
    status: str | None = None,
    category: str | None = None,
    priority: str | None = None,
    assignee_id: uuid.UUID | None = None,
    scope: str = Query("all", description="all | mine | assigned | unassigned"),
    overdue: bool = False,
    sort: str = Query("recent", description="recent | priority | due"),
    q: str | None = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    stmt = select(Ticket)
    if status:
        stmt = stmt.where(Ticket.status == status)
    if category:
        stmt = stmt.where(Ticket.category == category)
    if priority:
        stmt = stmt.where(Ticket.priority == priority)
    if assignee_id:
        stmt = stmt.where(Ticket.assignee_id == assignee_id)
    if scope == "mine":
        stmt = stmt.where(Ticket.requester_id == user.id)
    elif scope == "assigned":
        stmt = stmt.where(Ticket.assignee_id == user.id)
    elif scope == "unassigned":
        stmt = stmt.where(Ticket.assignee_id.is_(None))
    if overdue:
        stmt = stmt.where(
            Ticket.status.in_(OPEN_STATUSES),
            Ticket.sla_resolution_due.is_not(None),
            Ticket.sla_resolution_due < datetime.now(timezone.utc),
        )
    if q:
        stmt = stmt.where(Ticket.subject.ilike(f"%{q}%"))

    if sort == "priority":
        rank = case(_PRIO_RANK, value=Ticket.priority, else_=9)
        stmt = stmt.order_by(rank.asc(), Ticket.created_at.desc())
    elif sort == "due":
        stmt = stmt.order_by(Ticket.sla_resolution_due.asc().nulls_last())
    else:
        stmt = stmt.order_by(Ticket.created_at.desc())

    tickets = (await db.execute(stmt)).scalars().all()
    names = await user_names(
        db, {t.requester_id for t in tickets} | {t.assignee_id for t in tickets}
    )
    counts = await _counts(db, {t.id for t in tickets})
    effort = await _effort(db, {t.id for t in tickets})
    return [_serialize(t, names, counts, effort) for t in tickets]


@router.post("", response_model=TicketOut, status_code=201)
async def create_ticket(
    payload: TicketCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if payload.category not in CATEGORIES:
        raise HTTPException(status_code=422, detail="Invalid category")
    if payload.priority not in PRIORITIES:
        raise HTTPException(status_code=422, detail="Invalid priority")
    ticket = Ticket(**payload.model_dump(), requester_id=user.id)
    ticket.number = await _next_number(db)
    _apply_sla(ticket)
    db.add(ticket)
    # Notify managers/admins that a new ticket landed.
    agents = (
        await db.execute(
            select(User.id).where(
                User.is_admin.is_(True) | (User.role == "manager"),
                User.status == "active",
            )
        )
    ).scalars().all()
    for agent_id in agents:
        if agent_id != user.id:
            await notify_user(
                db,
                user_id=agent_id,
                title=f"New {ticket.category} ticket #{ticket.number}",
                body=ticket.subject,
                link="/service-desk",
                category="ticket",
                dedup_key=f"ticket-new:{ticket.id}:{agent_id}",
            )
    record(
        db,
        user=user,
        action="created",
        entity_type="ticket",
        entity_id=ticket.id,
        summary=f"Raised ticket #{ticket.number}: {ticket.subject}",
    )
    await db.commit()
    await db.refresh(ticket)
    names = await user_names(db, {ticket.requester_id, ticket.assignee_id})
    return _serialize(ticket, names, {})


@router.get("/{ticket_id}", response_model=TicketDetail)
async def get_ticket(
    ticket_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    ticket = await db.get(
        Ticket, ticket_id, options=[selectinload(Ticket.comments)]
    )
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    # Requesters don't see internal agent notes.
    can_see_internal = _is_agent(user) or ticket.assignee_id == user.id
    visible = [c for c in ticket.comments if can_see_internal or not c.is_internal]
    ids = {ticket.requester_id, ticket.assignee_id} | {c.author_id for c in visible}
    names = await user_names(db, ids)
    detail = TicketDetail.model_validate(ticket)
    detail.requester_name = names.get(ticket.requester_id) if ticket.requester_id else None
    detail.assignee_name = names.get(ticket.assignee_id) if ticket.assignee_id else None
    detail.comment_count = len(visible)
    detail.effort_minutes = (await _effort(db, {ticket.id})).get(ticket.id, 0)
    detail.comments = []
    for c in visible:
        co = TicketCommentOut.model_validate(c)
        co.author_name = names.get(c.author_id) if c.author_id else None
        detail.comments.append(co)
    return detail


@router.patch("/{ticket_id}", response_model=TicketOut)
async def update_ticket(
    ticket_id: uuid.UUID,
    payload: TicketUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    ticket = await db.get(Ticket, ticket_id)
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    data = payload.model_dump(exclude_unset=True)
    # Only agents or the assignee may triage; requesters may only close their own.
    if not (_is_agent(user) or ticket.assignee_id == user.id):
        if not (ticket.requester_id == user.id and set(data) <= {"status"}):
            raise HTTPException(status_code=403, detail="Not allowed")
    if "status" in data and data["status"] not in STATUSES:
        raise HTTPException(status_code=422, detail="Invalid status")
    if "priority" in data and data["priority"] not in PRIORITIES:
        raise HTTPException(status_code=422, detail="Invalid priority")
    if "category" in data and data["category"] not in CATEGORIES:
        raise HTTPException(status_code=422, detail="Invalid category")

    new_status = data.get("status")
    # Resolving requires a resolution note (from this request or already set).
    if new_status == "resolved":
        note = data.get("resolution_note") or ticket.resolution_note
        if not note or not str(note).strip():
            raise HTTPException(
                status_code=422,
                detail="A resolution note is required to resolve a ticket.",
            )

    prev_status = ticket.status
    prev_assignee = ticket.assignee_id
    prev_priority = ticket.priority
    for field, value in data.items():
        setattr(ticket, field, value)

    # Recompute SLA when priority changes on a still-open ticket.
    if (
        "priority" in data
        and data["priority"] != prev_priority
        and ticket.status in OPEN_STATUSES
    ):
        _apply_sla(ticket, base=ticket.created_at or datetime.now(timezone.utc))

    if new_status is not None:
        if new_status in {"resolved", "closed"}:
            ticket.resolved_at = datetime.now(timezone.utc)
        else:
            # Reopened — clear the old resolution so it can be solved again.
            if prev_status in {"resolved", "closed"}:
                ticket.resolution_note = None
            ticket.resolved_at = None

    # ---- Activity timeline ----
    actor = user.display_name or user.email
    if new_status is not None and new_status != prev_status:
        reopened = new_status in OPEN_STATUSES and prev_status in {"resolved", "closed"}
        record(
            db, user=user,
            action="reopened" if reopened else "status",
            entity_type="ticket", entity_id=ticket.id,
            summary=f"{actor} changed status {prev_status} → {new_status}",
        )
    if "assignee_id" in data and ticket.assignee_id != prev_assignee:
        names = await user_names(
            db, {ticket.assignee_id} if ticket.assignee_id else set()
        )
        who = names.get(ticket.assignee_id, "someone") if ticket.assignee_id else "unassigned"
        record(
            db, user=user, action="assigned", entity_type="ticket", entity_id=ticket.id,
            summary=f"{actor} assigned the ticket to {who}",
        )
    if "priority" in data and data["priority"] != prev_priority:
        record(
            db, user=user, action="priority", entity_type="ticket", entity_id=ticket.id,
            summary=f"{actor} set priority {prev_priority} → {data['priority']}",
        )

    # Tell the requester when their ticket changes state.
    if (
        new_status is not None
        and ticket.status != prev_status
        and ticket.requester_id
        and ticket.requester_id != user.id
    ):
        await notify_user(
            db,
            user_id=ticket.requester_id,
            title=f"Ticket #{ticket.number} {ticket.status.replace('_', ' ')}",
            body=ticket.subject,
            link="/service-desk",
            category="ticket",
        )
    await db.commit()
    await db.refresh(ticket)
    names = await user_names(db, {ticket.requester_id, ticket.assignee_id})
    counts = await _counts(db, {ticket.id})
    return _serialize(ticket, names, counts)


@router.post("/{ticket_id}/comments", response_model=TicketCommentOut, status_code=201)
async def add_comment(
    ticket_id: uuid.UUID,
    payload: TicketCommentCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    ticket = await db.get(Ticket, ticket_id)
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    # Only agents/assignee can leave internal notes.
    is_internal = bool(payload.is_internal) and (
        _is_agent(user) or ticket.assignee_id == user.id
    )
    comment = TicketComment(
        ticket_id=ticket_id, author_id=user.id, body=payload.body, is_internal=is_internal
    )
    db.add(comment)
    # First response = first public reply from an agent/assignee.
    if (
        not is_internal
        and ticket.first_responded_at is None
        and (_is_agent(user) or ticket.assignee_id == user.id)
        and user.id != ticket.requester_id
    ):
        ticket.first_responded_at = datetime.now(timezone.utc)
    # Notify the "other side" of the conversation (not for internal notes).
    if not is_internal:
        notify_target = (
            ticket.requester_id if user.id == ticket.assignee_id else ticket.assignee_id
        )
        if notify_target and notify_target != user.id:
            await notify_user(
                db,
                user_id=notify_target,
                title=f"New reply on ticket #{ticket.number}",
                body=ticket.subject,
                link="/service-desk",
                category="ticket",
            )
    await db.commit()
    await db.refresh(comment)
    out = TicketCommentOut.model_validate(comment)
    out.author_name = user.display_name or user.email
    return out


@router.delete("/{ticket_id}", status_code=204)
async def delete_ticket(
    ticket_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    ticket = await db.get(Ticket, ticket_id)
    if not ticket:
        return
    if not (_is_agent(user) or ticket.requester_id == user.id):
        raise HTTPException(status_code=403, detail="Not allowed")
    await db.delete(ticket)
    await db.commit()
