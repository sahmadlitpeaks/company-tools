"""Recurring checklist templates ("routine checks").

A template describes a round that a team performs on a schedule — the IT
morning checks, a facilities walk-through, a lab safety sweep. The scheduler
materialises it into a normal :class:`~app.models.workplace.Task` ("a run") on
each due day, copying the template items into ``task_items``.

Nothing here is department-specific: the team, the sections, the response types
and the photo rules are all configuration, so a new department adopts the
feature by authoring a template rather than by shipping code.
"""
import uuid

from sqlalchemy import JSON, Boolean, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.base import TimestampMixin, UUIDMixin

# How often a template generates a run.
SCHEDULES = {"daily", "weekdays", "weekly", "monthly"}

# What a checker records for one item.
#   ok_issue — OK / Issue (the paper form's checkbox pair)
#   done     — a plain tick
#   text     — a free-text reading (e.g. "which drive is faulty")
#   number   — a numeric reading (e.g. a temperature, a meter value)
RESPONSE_TYPES = {"ok_issue", "done", "text", "number"}


class ChecklistTemplate(UUIDMixin, TimestampMixin, Base):
    """A reusable round definition plus its schedule and routing."""

    __tablename__ = "checklist_templates"

    name: Mapped[str] = mapped_column(String(255), index=True)
    description: Mapped[str | None] = mapped_column(Text)
    active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)

    # Owning team. Doubles as the ticket category when an item raises an issue,
    # so it uses the same vocabulary as Ticket.category.
    team: Mapped[str] = mapped_column(String(24), default="it", index=True)

    # ---- Schedule ----
    # daily | weekdays | weekly | monthly
    schedule: Mapped[str] = mapped_column(String(16), default="daily")
    # For schedule=weekly: ISO weekdays to run on (1=Mon … 7=Sun).
    days_of_week: Mapped[list[int] | None] = mapped_column(JSON)
    # For schedule=monthly: day of month (clamped to the month's length).
    day_of_month: Mapped[int | None] = mapped_column(Integer)
    # Local time the run is due, "HH:MM". Informational + drives lateness.
    due_time: Mapped[str | None] = mapped_column(String(5))
    # Minutes after due_time before an unsubmitted run counts as late.
    grace_minutes: Mapped[int] = mapped_column(Integer, default=60)

    # ---- Routing ----
    # A fixed owner, or a department whose members can claim the run (rota).
    assignee_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), index=True, nullable=True
    )
    assignee_department_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("departments.id", ondelete="SET NULL"), index=True, nullable=True
    )
    # Manager who verifies a submitted run. Falls back to the assignee's
    # reporting manager when left empty.
    reviewer_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), index=True, nullable=True
    )
    company_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("companies.id", ondelete="SET NULL"), index=True, nullable=True
    )

    # Require a manager to verify before a run is considered complete.
    requires_verification: Mapped[bool] = mapped_column(Boolean, default=True)

    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    items: Mapped[list["ChecklistTemplateItem"]] = relationship(
        back_populates="template",
        cascade="all, delete-orphan",
        order_by="ChecklistTemplateItem.sort.asc()",
    )


class ChecklistTemplateItem(UUIDMixin, TimestampMixin, Base):
    """One checkpoint in a template."""

    __tablename__ = "checklist_template_items"

    template_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("checklist_templates.id", ondelete="CASCADE"), index=True
    )
    # Free-text grouping shown as a heading, e.g. "HQ Building / Dr T's Office".
    # A plain string keeps the hierarchy arbitrarily deep without another table.
    section: Mapped[str | None] = mapped_column(String(255))
    title: Mapped[str] = mapped_column(String(512))
    sort: Mapped[int] = mapped_column(Integer, default=0)

    response_type: Mapped[str] = mapped_column(String(16), default="ok_issue")
    photo_required: Mapped[bool] = mapped_column(Boolean, default=False)
    # Optional link to the physical thing being checked (printer, TV, pod), so
    # an issue can carry the asset into the ticket it raises.
    asset_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("tracked_assets.id", ondelete="SET NULL"), nullable=True
    )
    # Raise a service-desk ticket automatically when this item is marked Issue.
    auto_ticket_on_issue: Mapped[bool] = mapped_column(Boolean, default=True)
    ticket_priority: Mapped[str] = mapped_column(String(16), default="normal")

    template: Mapped["ChecklistTemplate"] = relationship(back_populates="items")
