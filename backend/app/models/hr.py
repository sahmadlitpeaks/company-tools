"""HR / People module models.

Holds the employment record timeline (this increment); compensation, HR
documents, leave policies and performance models are added here in later
increments of the HR module.
"""
import uuid
from datetime import date

from sqlalchemy import Boolean, Date, ForeignKey, Integer, Numeric, String, Text
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


# Kinds of compensation entry.
COMPENSATION_TYPES = {"salary", "bonus", "allowance", "adjustment"}
PAY_PERIODS = {"annual", "monthly", "hourly"}


class PayBand(UUIDMixin, TimestampMixin, Base):
    """A salary band/range used as a reference for compensation decisions."""

    __tablename__ = "pay_bands"

    name: Mapped[str] = mapped_column(String(120), index=True)
    level: Mapped[str | None] = mapped_column(String(40))
    min_amount: Mapped[float | None] = mapped_column(Numeric(12, 2))
    max_amount: Mapped[float | None] = mapped_column(Numeric(12, 2))
    currency: Mapped[str] = mapped_column(String(8), default="USD")
    note: Mapped[str | None] = mapped_column(Text)


class CompensationRecord(UUIDMixin, TimestampMixin, Base):
    """A dated compensation entry for an employee (salary, bonus, …)."""

    __tablename__ = "compensation_records"

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    record_type: Mapped[str] = mapped_column(String(16), default="salary", index=True)
    amount: Mapped[float] = mapped_column(Numeric(12, 2))
    currency: Mapped[str] = mapped_column(String(8), default="USD")
    # annual | monthly | hourly (for salary; bonuses are one-off amounts)
    pay_period: Mapped[str] = mapped_column(String(12), default="annual")
    effective_date: Mapped[date] = mapped_column(Date, index=True, default=date.today)
    band_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("pay_bands.id", ondelete="SET NULL"), nullable=True
    )
    note: Mapped[str | None] = mapped_column(Text)
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )


# ---- Performance (light) ----
GOAL_STATUSES = {"open", "in_progress", "done", "cancelled"}
REVIEW_STATUSES = {"pending", "submitted"}


class PerformanceGoal(UUIDMixin, TimestampMixin, Base):
    """A goal/objective for an employee, with simple progress tracking."""

    __tablename__ = "performance_goals"

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    title: Mapped[str] = mapped_column(String(512))
    description: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(16), default="open", index=True)
    progress: Mapped[int] = mapped_column(Integer, default=0)  # 0-100
    due_date: Mapped[date | None] = mapped_column(Date)
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )


class ReviewCycle(UUIDMixin, TimestampMixin, Base):
    """A performance review round (e.g. '2026 H1')."""

    __tablename__ = "review_cycles"

    name: Mapped[str] = mapped_column(String(255), index=True)
    period: Mapped[str | None] = mapped_column(String(80))
    status: Mapped[str] = mapped_column(String(16), default="open", index=True)
    due_date: Mapped[date | None] = mapped_column(Date)


class Review(UUIDMixin, TimestampMixin, Base):
    """One employee's review within a cycle, written by their reviewer."""

    __tablename__ = "reviews"

    cycle_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("review_cycles.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    reviewer_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    status: Mapped[str] = mapped_column(String(16), default="pending", index=True)
    rating: Mapped[int | None] = mapped_column(Integer)  # 1-5
    summary: Mapped[str | None] = mapped_column(Text)
    submitted_at: Mapped[date | None] = mapped_column(Date)


# Status of an e-signature request on a document.
SIGNATURE_STATUSES = {"pending", "signed", "declined"}


class SignatureRequest(UUIDMixin, TimestampMixin, Base):
    """A request for an employee to e-sign one of their HR documents.

    Non-PKI e-signature: the signer types their name and consents; we store an
    audit trail (who, when, IP, user-agent) — the BambooHR-style model.
    """

    __tablename__ = "signature_requests"

    document_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("hr_documents.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    status: Mapped[str] = mapped_column(String(16), default="pending", index=True)
    typed_name: Mapped[str | None] = mapped_column(String(255))
    signed_at: Mapped[date | None] = mapped_column(Date)
    audit_ip: Mapped[str | None] = mapped_column(String(64))
    audit_agent: Mapped[str | None] = mapped_column(String(512))
    requested_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
