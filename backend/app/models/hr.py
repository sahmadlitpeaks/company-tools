"""HR / People module models.

Holds the employment record timeline (this increment); compensation, HR
documents, leave policies and performance models are added here in later
increments of the HR module.
"""
import uuid
from datetime import date

from sqlalchemy import Boolean, Date, ForeignKey, Integer, String, Text
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


# Categories of HR document held against an employee.
DOCUMENT_CATEGORIES = {
    "contract",
    "offer_letter",
    "nda",
    "passport",
    "visa",
    "national_id",
    "certificate",
    "policy",
    "payslip",
    "other",
}


class HrDocument(UUIDMixin, TimestampMixin, Base):
    """A file held against an employee's HR record, optionally with an expiry."""

    __tablename__ = "hr_documents"

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    title: Mapped[str] = mapped_column(String(512))
    category: Mapped[str] = mapped_column(String(24), default="other", index=True)
    file_path: Mapped[str] = mapped_column(String(1024))
    content_type: Mapped[str | None] = mapped_column(String(255))
    size_bytes: Mapped[int] = mapped_column(default=0)
    issue_date: Mapped[date | None] = mapped_column(Date)
    expiry_date: Mapped[date | None] = mapped_column(Date, index=True)
    notes: Mapped[str | None] = mapped_column(Text)
    uploaded_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )


class LeaveType(UUIDMixin, TimestampMixin, Base):
    """A category of leave (Annual, Sick, Unpaid, …) with its yearly default."""

    __tablename__ = "leave_types"

    name: Mapped[str] = mapped_column(String(80), index=True)
    color: Mapped[str] = mapped_column(String(16), default="#6366f1")
    paid: Mapped[bool] = mapped_column(Boolean, default=True)
    # Annual entitlement granted by default (can be overridden per employee).
    default_days: Mapped[int] = mapped_column(Integer, default=0)
    # Max days that can roll over to next year (informational).
    carryover_max: Mapped[int] = mapped_column(Integer, default=0)
    active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    sort: Mapped[int] = mapped_column(Integer, default=0)


class Holiday(UUIDMixin, TimestampMixin, Base):
    """A company-wide public holiday (excluded from leave-day counts)."""

    __tablename__ = "holidays"

    day: Mapped[date] = mapped_column(Date, unique=True, index=True)
    name: Mapped[str] = mapped_column(String(255))
