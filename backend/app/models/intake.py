"""Inbound intake — website form submissions (leads, complaints, support,
inquiries) land here, to be triaged and converted to CRM leads or tickets."""
import uuid

from sqlalchemy import JSON, Boolean, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.base import TimestampMixin, UUIDMixin

SUBMISSION_TYPES = {"lead", "complaint", "support", "inquiry", "feedback", "other"}
SUBMISSION_STATUSES = {"new", "in_progress", "resolved", "spam", "archived"}


class IntakeSource(UUIDMixin, TimestampMixin, Base):
    """A connected website/form. Each has a public key used by its endpoint."""

    __tablename__ = "intake_sources"

    name: Mapped[str] = mapped_column(String(255))
    key: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    default_type: Mapped[str] = mapped_column(String(16), default="lead")
    active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    # Who to notify when this source receives a submission.
    notify_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )


class Submission(UUIDMixin, TimestampMixin, Base):
    """One inbound form submission."""

    __tablename__ = "submissions"

    source_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("intake_sources.id", ondelete="SET NULL"), index=True, nullable=True
    )
    type: Mapped[str] = mapped_column(String(16), default="lead", index=True)
    name: Mapped[str | None] = mapped_column(String(255))
    email: Mapped[str | None] = mapped_column(String(320), index=True)
    phone: Mapped[str | None] = mapped_column(String(64))
    company: Mapped[str | None] = mapped_column(String(255))
    subject: Mapped[str | None] = mapped_column(String(512))
    message: Mapped[str | None] = mapped_column(Text)
    page_url: Mapped[str | None] = mapped_column(String(1024))
    # Any extra form fields not mapped to the columns above.
    payload: Mapped[dict | None] = mapped_column(JSON)
    status: Mapped[str] = mapped_column(String(16), default="new", index=True)
    assignee_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), index=True, nullable=True
    )
    converted_lead_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True)
    converted_ticket_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True)
    ip: Mapped[str | None] = mapped_column(String(64))
