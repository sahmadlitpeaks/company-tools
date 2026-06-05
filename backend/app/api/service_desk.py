import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth.deps import get_current_user
from app.core.database import get_db
from app.models.user import User
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


def _is_agent(user: User) -> bool:
    return user.is_admin or user.role == "manager"


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


def _serialize(t: Ticket, names: dict, counts: dict) -> TicketOut:
    out = TicketOut.model_validate(t)
    out.requester_name = names.get(t.requester_id) if t.requester_id else None
    out.assignee_name = names.get(t.assignee_id) if t.assignee_id else None
    out.comment_count = counts.get(t.id, 0)
    return out


@router.get("", response_model=list[TicketOut])
async def list_tickets(
    status: str | None = None,
    category: str | None = None,
    scope: str = Query("all", description="all | mine | assigned"),
    q: str | None = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    stmt = select(Ticket).order_by(Ticket.created_at.desc())
    if status:
        stmt = stmt.where(Ticket.status == status)
    if category:
        stmt = stmt.where(Ticket.category == category)
    if scope == "mine":
        stmt = stmt.where(Ticket.requester_id == user.id)
    elif scope == "assigned":
        stmt = stmt.where(Ticket.assignee_id == user.id)
    if q:
        stmt = stmt.where(Ticket.subject.ilike(f"%{q}%"))
    tickets = (await db.execute(stmt)).scalars().all()
    names = await user_names(
        db, {t.requester_id for t in tickets} | {t.assignee_id for t in tickets}
    )
    counts = await _counts(db, {t.id for t in tickets})
    return [_serialize(t, names, counts) for t in tickets]


@router.post("", response_model=TicketOut, status_code=201)
async def create_ticket(
    payload: TicketCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if payload.category not in CATEGORIES:
        raise HTTPException(status_code=422, detail="Invalid category")
    ticket = Ticket(**payload.model_dump(), requester_id=user.id)
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
                title=f"New {ticket.category} ticket",
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
        summary=f"Raised ticket '{ticket.subject}'",
    )
    await db.commit()
    await db.refresh(ticket)
    names = await user_names(db, {ticket.requester_id, ticket.assignee_id})
    return _serialize(ticket, names, {})


@router.get("/{ticket_id}", response_model=TicketDetail)
async def get_ticket(
    ticket_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    ticket = await db.get(
        Ticket, ticket_id, options=[selectinload(Ticket.comments)]
    )
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    ids = {ticket.requester_id, ticket.assignee_id} | {
        c.author_id for c in ticket.comments
    }
    names = await user_names(db, ids)
    detail = TicketDetail.model_validate(ticket)
    detail.requester_name = names.get(ticket.requester_id) if ticket.requester_id else None
    detail.assignee_name = names.get(ticket.assignee_id) if ticket.assignee_id else None
    detail.comment_count = len(ticket.comments)
    detail.comments = []
    for c in ticket.comments:
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

    prev_status = ticket.status
    for field, value in data.items():
        setattr(ticket, field, value)
    if "status" in data:
        ticket.resolved_at = (
            datetime.now(timezone.utc)
            if data["status"] in {"resolved", "closed"}
            else None
        )
    # Tell the requester when their ticket changes state.
    if (
        "status" in data
        and ticket.status != prev_status
        and ticket.requester_id
        and ticket.requester_id != user.id
    ):
        await notify_user(
            db,
            user_id=ticket.requester_id,
            title=f"Ticket {ticket.status.replace('_', ' ')}",
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
    comment = TicketComment(ticket_id=ticket_id, author_id=user.id, body=payload.body)
    db.add(comment)
    # Notify the "other side" of the conversation.
    notify_target = (
        ticket.requester_id if user.id == ticket.assignee_id else ticket.assignee_id
    )
    if notify_target and notify_target != user.id:
        await notify_user(
            db,
            user_id=notify_target,
            title="New reply on a ticket",
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
