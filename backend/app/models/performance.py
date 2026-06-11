"""Performance depth — 360 feedback on reviews, 1:1 meetings, and lightweight
continuous (private) feedback between colleagues."""
import uuid
from datetime import datetime

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.base import TimestampMixin, UUIDMixin

FEEDBACK_RELATIONS = {"self", "manager", "peer", "report"}
FEEDBACK_STATUSES = {"requested", "submitted"}
ONE_ON_ONE_STATUSES = {"scheduled", "completed", "cancelled"}


class ReviewFeedback(UUIDMixin, TimestampMixin, Base):
    """A 360 input on a review from a particular relationship perspective."""

    __tablename__ = "review_feedback"

    review_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("reviews.id", ondelete="CASCADE"), index=True
    )
    author_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    relation: Mapped[str] = mapped_column(String(16), default="peer")
    status: Mapped[str] = mapped_column(String(16), default="requested", index=True)
    rating: Mapped[int | None] = mapped_column(Integer)  # 1-5
    strengths: Mapped[str | None] = mapped_column(Text)
    improvements: Mapped[str | None] = mapped_column(Text)
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class OneOnOne(UUIDMixin, TimestampMixin, Base):
    """A scheduled 1:1 between a manager and an employee with shared notes."""

    __tablename__ = "one_on_ones"

    manager_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    employee_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    scheduled_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    status: Mapped[str] = mapped_column(String(16), default="scheduled", index=True)
    # Shared talking points both parties can see/edit.
    agenda: Mapped[list | None] = mapped_column(JSON)  # [{"text","done"}]
    shared_notes: Mapped[str | None] = mapped_column(Text)


class ContinuousFeedback(UUIDMixin, TimestampMixin, Base):
    """Private, constructive feedback to a colleague (not the public kudos wall).

    Visible only to the recipient, their manager and HR.
    """

    __tablename__ = "continuous_feedback"

    from_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    to_user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    body: Mapped[str] = mapped_column(Text)
