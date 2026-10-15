"""Project decisions and append-only submitted snapshots and events."""
import uuid
from datetime import date, datetime

from sqlalchemy import JSON, Date, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.base import TimestampMixin, UUIDMixin


class PmDecision(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "pm_decisions"

    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("pm_projects.id", ondelete="RESTRICT"), index=True)
    number: Mapped[int] = mapped_column(Integer)
    title: Mapped[str] = mapped_column(String(255))
    category: Mapped[str] = mapped_column(String(24), index=True)
    context: Mapped[str] = mapped_column(Text)
    approach: Mapped[str] = mapped_column(Text)
    rationale: Mapped[str] = mapped_column(Text)
    alternatives: Mapped[str] = mapped_column(Text, default="")
    owner_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), index=True)
    proposed_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), index=True)
    approver_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), index=True)
    status: Mapped[str] = mapped_column(String(24), default="draft", index=True)
    effective_date: Mapped[date | None] = mapped_column(Date)
    evidence: Mapped[list] = mapped_column(JSON, default=list)
    version: Mapped[int] = mapped_column(Integer, default=1)
    revision_number: Mapped[int] = mapped_column(Integer, default=0)
    approved_revision_number: Mapped[int | None] = mapped_column(Integer)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    superseded_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("pm_decisions.id", ondelete="RESTRICT"))

    __table_args__ = (UniqueConstraint("project_id", "number", name="uq_pm_decision_number"),)


class PmDecisionRevision(UUIDMixin, Base):
    __tablename__ = "pm_decision_revisions"

    decision_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("pm_decisions.id", ondelete="RESTRICT"), index=True)
    number: Mapped[int] = mapped_column(Integer)
    snapshot: Mapped[dict] = mapped_column(JSON)
    change_summary: Mapped[str] = mapped_column(Text)
    submitted_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    submitted_by_name: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (UniqueConstraint("decision_id", "number", name="uq_pm_decision_revision"),)


class PmDecisionIssueLink(UUIDMixin, Base):
    __tablename__ = "pm_decision_issue_links"

    decision_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("pm_decisions.id", ondelete="CASCADE"), index=True)
    issue_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("pm_issues.id", ondelete="CASCADE"), index=True)
    __table_args__ = (UniqueConstraint("decision_id", "issue_id", name="uq_pm_decision_issue"),)


class PmDecisionEvent(UUIDMixin, Base):
    __tablename__ = "pm_decision_events"

    decision_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("pm_decisions.id", ondelete="RESTRICT"), index=True)
    revision_number: Mapped[int | None] = mapped_column(Integer)
    actor_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    actor_name: Mapped[str] = mapped_column(String(255))
    action: Mapped[str] = mapped_column(String(32))
    note: Mapped[str] = mapped_column(Text, default="")
    details: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
