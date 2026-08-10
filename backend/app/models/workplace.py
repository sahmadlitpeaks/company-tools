"""Office-operations models: tasks, approvals, service-desk tickets and the
knowledge base. They share the same conventions as the rest of the app
(UUID + timestamps) and reference users/brands for ownership and scoping.
"""
import uuid
from datetime import date, datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.base import TimestampMixin, UUIDMixin


# --------------------------------------------------------------------------
# Tasks (work management)
# --------------------------------------------------------------------------
class Project(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "projects"

    name: Mapped[str] = mapped_column(String(255), index=True)
    description: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), default="planned", index=True)
    start_date: Mapped[date | None] = mapped_column(Date)
    end_date: Mapped[date | None] = mapped_column(Date)
    owner_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), index=True, nullable=True
    )
    company_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("companies.id", ondelete="SET NULL"), index=True, nullable=True
    )


class Task(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "tasks"

    title: Mapped[str] = mapped_column(String(512))
    description: Mapped[str | None] = mapped_column(Text)
    # todo | in_progress | blocked | submitted | done
    # ``submitted`` is only used by checklist runs awaiting manager verification.
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
    company_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("companies.id", ondelete="SET NULL"), index=True, nullable=True
    )
    project_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("projects.id", ondelete="SET NULL"), index=True, nullable=True
    )
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # When set, this task mirrors an onboarding/offboarding checklist item and
    # stays in sync with it.
    onboarding_task_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("onboarding_tasks.id", ondelete="SET NULL"), index=True, nullable=True
    )

    # ---- Checklist runs (see app/models/checklist.py) ----
    # When set, this task is one occurrence of a recurring checklist template.
    # (template_id, run_date) is unique so generation is idempotent.
    template_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("checklist_templates.id", ondelete="CASCADE"),
        index=True,
        nullable=True,
    )
    run_date: Mapped[date | None] = mapped_column(Date, index=True)
    # Manager who verifies the submitted run.
    reviewer_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), index=True, nullable=True
    )
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    verified_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    review_note: Mapped[str | None] = mapped_column(Text)
    # When the checker opened the run — paired with submitted_at this replaces
    # the "in / out" times written on the paper form.
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    __table_args__ = (
        UniqueConstraint("template_id", "run_date", name="uq_task_template_run_date"),
    )

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

    # ---- Checklist responses ----
    # Plain subtasks only ever use ``done``; the fields below are populated for
    # items generated from a checklist template.
    # Heading this item sits under, e.g. "HQ Building / Dr T's Office".
    section: Mapped[str | None] = mapped_column(String(255))
    # pending | ok | issue | na | done
    status: Mapped[str] = mapped_column(String(16), default="pending", index=True)
    note: Mapped[str | None] = mapped_column(Text)
    # ok_issue | done | text | number (see app.models.checklist.RESPONSE_TYPES)
    response_type: Mapped[str] = mapped_column(String(16), default="done")
    # The reading captured for response_type text/number.
    value: Mapped[str | None] = mapped_column(String(512))
    photo_required: Mapped[bool] = mapped_column(Boolean, default=False)
    asset_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("tracked_assets.id", ondelete="SET NULL"), nullable=True
    )
    auto_ticket_on_issue: Mapped[bool] = mapped_column(Boolean, default=False)
    ticket_priority: Mapped[str] = mapped_column(String(16), default="normal")
    # Ticket raised from this item, if any.
    ticket_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("tickets.id", ondelete="SET NULL"), nullable=True
    )
    responded_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    responded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

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
    # For type=leave: take a single day as a half day (counts as 0.5).
    half_day: Mapped[bool] = mapped_column(Boolean, default=False)
    # For type=leave: which leave category (null = the default annual type).
    leave_type_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("leave_types.id", ondelete="SET NULL"), index=True, nullable=True
    )

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
    company_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("companies.id", ondelete="SET NULL"), index=True, nullable=True
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
    company_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("companies.id", ondelete="SET NULL"), index=True, nullable=True
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
    company_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("companies.id", ondelete="SET NULL"), index=True, nullable=True
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
    # Per leave type (null = the default annual type, for legacy rows).
    leave_type_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("leave_types.id", ondelete="CASCADE"), index=True, nullable=True
    )


# --------------------------------------------------------------------------
# Generic attachments (approvals, tickets, tasks …)
# --------------------------------------------------------------------------
class Attachment(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "attachments"

    # approval | ticket | task | task_item
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
    company_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("companies.id", ondelete="SET NULL"), index=True, nullable=True
    )
