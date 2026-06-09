"""HR / People module models.

Holds the employment record timeline (this increment); compensation, HR
documents, leave policies and performance models are added here in later
increments of the HR module.
"""
import uuid
from datetime import date

from sqlalchemy import Date, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.base import TimestampMixin, UUIDMixin

# Lifecycle events on an employee's record.
EMPLOYMENT_EVENT_TYPES = {
    "hired",
    "promotion",
    "transfer",
    "title_change",
    "manager_change",
    "contract",
    "compensation",
    "leave",
    "note",
    "terminated",
}


class EmploymentEvent(UUIDMixin, TimestampMixin, Base):
    """A dated entry in a person's employment history."""

    __tablename__ = "employment_events"

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    event_type: Mapped[str] = mapped_column(String(24), default="note", index=True)
    effective_date: Mapped[date] = mapped_column(Date, index=True, default=date.today)
    title: Mapped[str] = mapped_column(String(512))
    detail: Mapped[str | None] = mapped_column(Text)
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
