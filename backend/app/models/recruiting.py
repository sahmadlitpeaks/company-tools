"""Recruiting / ATS — job openings, candidates with a stage pipeline,
interviews with scorecards, and offers that convert into employees."""
import uuid
from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.base import TimestampMixin, UUIDMixin

JOB_STATUSES = {"draft", "open", "on_hold", "closed", "filled"}
CANDIDATE_STAGES = ["applied", "screen", "interview", "offer", "hired", "rejected"]
CANDIDATE_STATUSES = {"active", "hired", "rejected", "withdrawn"}
OFFER_STATUSES = {"draft", "sent", "accepted", "declined"}
RECOMMENDATIONS = {"yes", "no", "maybe"}


class JobOpening(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "job_openings"

    title: Mapped[str] = mapped_column(String(255), index=True)
    department_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("departments.id", ondelete="SET NULL"), index=True, nullable=True
    )
    company_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("companies.id", ondelete="SET NULL"), index=True, nullable=True
    )
    location: Mapped[str | None] = mapped_column(String(255))
    employment_type: Mapped[str | None] = mapped_column(String(24))
    description: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(16), default="open", index=True)
    openings: Mapped[int] = mapped_column(Integer, default=1)
    hiring_manager_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    candidates: Mapped[list["Candidate"]] = relationship(
        back_populates="job", cascade="all, delete-orphan"
    )


class Candidate(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "candidates"

    job_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("job_openings.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(255), index=True)
    email: Mapped[str | None] = mapped_column(String(320), index=True)
    phone: Mapped[str | None] = mapped_column(String(64))
    resume_path: Mapped[str | None] = mapped_column(String(1024))
    source: Mapped[str | None] = mapped_column(String(64))  # referral | website | linkedin…
    stage: Mapped[str] = mapped_column(String(16), default="applied", index=True)
    status: Mapped[str] = mapped_column(String(16), default="active", index=True)
    rating: Mapped[int | None] = mapped_column(Integer)  # 1-5
    notes: Mapped[str | None] = mapped_column(Text)
    # Set when the candidate is hired and converted to an employee.
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    job: Mapped["JobOpening"] = relationship(back_populates="candidates")


class CandidateActivity(UUIDMixin, TimestampMixin, Base):
    """A note or stage change on a candidate's timeline."""

    __tablename__ = "candidate_activities"

    candidate_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("candidates.id", ondelete="CASCADE"), index=True
    )
    kind: Mapped[str] = mapped_column(String(16), default="note")  # note | stage
    body: Mapped[str] = mapped_column(Text)
    author_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )


class Interview(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "interviews"

    candidate_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("candidates.id", ondelete="CASCADE"), index=True
    )
    scheduled_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    duration_minutes: Mapped[int] = mapped_column(Integer, default=60)
    mode: Mapped[str] = mapped_column(String(16), default="video")  # video | onsite | phone
    location: Mapped[str | None] = mapped_column(String(512))  # room or meeting link
    interviewer_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), index=True, nullable=True
    )
    # Scorecard (filled after the interview).
    rating: Mapped[int | None] = mapped_column(Integer)  # 1-5
    recommendation: Mapped[str | None] = mapped_column(String(8))  # yes | no | maybe
    feedback: Mapped[str | None] = mapped_column(Text)


class Offer(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "offers"

    candidate_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("candidates.id", ondelete="CASCADE"), index=True
    )
    amount: Mapped[float | None] = mapped_column(Numeric(12, 2))
    currency: Mapped[str] = mapped_column(String(8), default="USD")
    pay_period: Mapped[str] = mapped_column(String(12), default="monthly")
    start_date: Mapped[date | None] = mapped_column(Date)
    status: Mapped[str] = mapped_column(String(16), default="draft", index=True)
    note: Mapped[str | None] = mapped_column(Text)
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
