"""Office-operations models: tasks, approvals, service-desk tickets and the
knowledge base. They share the same conventions as the rest of the app
(UUID + timestamps) and reference users/brands for ownership and scoping.
"""
import uuid
from datetime import date, datetime

from sqlalchemy import BigInteger, Boolean, Date, DateTime, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.base import TimestampMixin, UUIDMixin


# --------------------------------------------------------------------------
# Tasks (work management)
# --------------------------------------------------------------------------
class Task(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "tasks"

    title: Mapped[str] = mapped_column(String(512))
    description: Mapped[str | None] = mapped_column(Text)
    # todo | in_progress | blocked | done
    status: Mapped[str] = mapped_column(String(16), default="todo", index=True)
    # low | normal | high | urgent
    priority: Mapped[str] = mapped_column(String(16), default="normal")
    due_date: Mapped[date | None] = mapped_column(Date)
    # none | daily | weekly | monthly — when done, the next occurrence is spawned.
    recurrence: Mapped[str | None] = mapped_column(String(12))
    assignee_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), index=True, nullable=True
    )
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    brand_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("brands.id", ondelete="SET NULL"), index=True, nullable=True
    )
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    items: Mapped[list["TaskItem"]] = relationship(
        back_populates="task",
        cascade="all, delete-orphan",
        order_by="TaskItem.sort.asc()",
    )
    comments: Mapped[list["TaskComment"]] = relationship(
        back_populates="task",
        cascade="all, delete-orphan",
        order_by="TaskComment.created_at.asc()",
    )


class TaskItem(UUIDMixin, TimestampMixin, Base):
    """A checklist item / subtask within a task."""

    __tablename__ = "task_items"

    task_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("tasks.id", ondelete="CASCADE"), index=True
    )
    title: Mapped[str] = mapped_column(String(512))
    done: Mapped[bool] = mapped_column(Boolean, default=False)
    sort: Mapped[int] = mapped_column(Integer, default=0)

    task: Mapped["Task"] = relationship(back_populates="items")


class TaskComment(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "task_comments"

    task_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("tasks.id", ondelete="CASCADE"), index=True
    )
    author_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    body: Mapped[str] = mapped_column(Text)

    task: Mapped["Task"] = relationship(back_populates="comments")


# --------------------------------------------------------------------------
# Approvals (requests & approvals engine)
# --------------------------------------------------------------------------
class ApprovalRequest(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "approval_requests"

    # leave | expense | purchase | document | access | general
    type: Mapped[str] = mapped_column(String(24), default="general", index=True)
    title: Mapped[str] = mapped_column(String(512))
    details: Mapped[str | None] = mapped_column(Text)
    amount: Mapped[float | None] = mapped_column(Numeric(12, 2))
    start_date: Mapped[date | None] = mapped_column(Date)
    end_date: Mapped[date | None] = mapped_column(Date)

    # pending | approved | rejected | cancelled
    status: Mapped[str] = mapped_column(String(16), default="pending", index=True)
    requester_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), index=True, nullable=True
    )
    approver_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), index=True, nullable=True
    )
    decided_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    decision_note: Mapped[str | None] = mapped_column(Text)
    brand_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("brands.id", ondelete="SET NULL"), index=True, nullable=True
    )


# --------------------------------------------------------------------------
# Service desk (internal tickets)
# --------------------------------------------------------------------------
class Ticket(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "tickets"

    # Human-friendly sequential number shown as #1001 (assigned on creation).
    number: Mapped[int | None] = mapped_column(Integer, unique=True, index=True)
    subject: Mapped[str] = mapped_column(String(512))
    description: Mapped[str | None] = mapped_column(Text)
    # it | facilities | hr | finance | other
    category: Mapped[str] = mapped_column(String(24), default="it", index=True)
    # low | normal | high | urgent
    priority: Mapped[str] = mapped_column(String(16), default="normal")
    # open | in_progress | resolved | closed
    status: Mapped[str] = mapped_column(String(16), default="open", index=True)
    requester_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), index=True, nullable=True
    )
    assignee_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), index=True, nullable=True
    )
    asset_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("tracked_assets.id", ondelete="SET NULL"), nullable=True
    )
    brand_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("brands.id", ondelete="SET NULL"), index=True, nullable=True
    )
    # SLA targets (computed from priority at creation) and timing milestones.
    sla_response_due: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    sla_resolution_due: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    first_responded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    resolution_note: Mapped[str | None] = mapped_column(Text)

    comments: Mapped[list["TicketComment"]] = relationship(
        back_populates="ticket",
        cascade="all, delete-orphan",
        order_by="TicketComment.created_at.asc()",
    )


class TicketComment(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "ticket_comments"

    ticket_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("tickets.id", ondelete="CASCADE"), index=True
    )
    author_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    body: Mapped[str] = mapped_column(Text)
    # Internal notes are visible to agents only, not the requester.
    is_internal: Mapped[bool] = mapped_column(Boolean, default=False)

    ticket: Mapped["Ticket"] = relationship(back_populates="comments")


# --------------------------------------------------------------------------
# Announcements (company noticeboard)
# --------------------------------------------------------------------------
class Announcement(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "announcements"

    title: Mapped[str] = mapped_column(String(512))
    body: Mapped[str] = mapped_column(Text, default="")
    pinned: Mapped[bool] = mapped_column(Boolean, default=False)
    is_published: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    author_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    brand_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("brands.id", ondelete="SET NULL"), index=True, nullable=True
    )

    reads: Mapped[list["AnnouncementRead"]] = relationship(
        back_populates="announcement", cascade="all, delete-orphan"
    )


class AnnouncementRead(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "announcement_reads"

    announcement_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("announcements.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )

    announcement: Mapped["Announcement"] = relationship(back_populates="reads")


# --------------------------------------------------------------------------
# Leave balances (annual entitlement; usage derived from approved leave)
# --------------------------------------------------------------------------
class LeaveBalance(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "leave_balances"

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    year: Mapped[int] = mapped_column(Integer, index=True)
    entitlement_days: Mapped[int] = mapped_column(Integer, default=25)


# --------------------------------------------------------------------------
# Generic attachments (approvals, tickets, tasks …)
# --------------------------------------------------------------------------
class Attachment(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "attachments"

    # approval | ticket | task
    entity_type: Mapped[str] = mapped_column(String(24), index=True)
    entity_id: Mapped[uuid.UUID] = mapped_column(index=True)
    name: Mapped[str] = mapped_column(String(512))
    file_path: Mapped[str] = mapped_column(String(1024))
    content_type: Mapped[str | None] = mapped_column(String(255))
    size_bytes: Mapped[int] = mapped_column(BigInteger, default=0)
    uploaded_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )


# --------------------------------------------------------------------------
# Knowledge base
# --------------------------------------------------------------------------
class KnowledgeArticle(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "knowledge_articles"

    title: Mapped[str] = mapped_column(String(512))
    category: Mapped[str | None] = mapped_column(String(128), index=True)
    body: Mapped[str] = mapped_column(Text, default="")
    is_published: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    pinned: Mapped[bool] = mapped_column(Boolean, default=False)
    view_count: Mapped[int] = mapped_column(BigInteger, default=0)
    author_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    brand_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("brands.id", ondelete="SET NULL"), index=True, nullable=True
    )
