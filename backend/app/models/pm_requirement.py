"""Requirements are the project brief; execution and decisions link to them."""
import uuid
from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.base import TimestampMixin, UUIDMixin


class PmModule(UUIDMixin, TimestampMixin, Base):
    """A feature area within a project (Booking, Membership, CRM...)."""

    __tablename__ = "pm_modules"
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("pm_projects.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(80))
    description: Mapped[str | None] = mapped_column(Text)
    position: Mapped[int] = mapped_column(Integer, default=0)
    archived: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    __table_args__ = (UniqueConstraint("project_id", "name", name="uq_pm_module_name"),)


class PmRequirement(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "pm_requirements"
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("pm_projects.id", ondelete="RESTRICT"), index=True)
    number: Mapped[int] = mapped_column(Integer)
    title: Mapped[str] = mapped_column(String(255))
    original_request: Mapped[str] = mapped_column(Text, default="")
    context: Mapped[str] = mapped_column(Text, default="")
    functional_requirements: Mapped[str] = mapped_column(Text, default="")
    technical_requirements: Mapped[str] = mapped_column(Text, default="")
    scope: Mapped[str] = mapped_column(Text, default="")
    expected_outcome: Mapped[str] = mapped_column(Text, default="")
    acceptance_criteria: Mapped[str] = mapped_column(Text, default="")
    supporting_information: Mapped[str] = mapped_column(Text, default="")
    owner_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), index=True)
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    status: Mapped[str] = mapped_column(String(24), default="draft", index=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    # Roadmap (BRD 9A): a requirement is a feature on the product roadmap.
    module_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("pm_modules.id", ondelete="RESTRICT"), index=True)
    priority: Mapped[str | None] = mapped_column(String(8))  # high | medium | low
    horizon: Mapped[str | None] = mapped_column(String(8), index=True)  # now | next | later | future
    # proposed -> approved -> in_progress -> done, or parked
    roadmap_status: Mapped[str] = mapped_column(String(16), default="proposed", server_default="proposed", index=True)
    target_quarter: Mapped[str | None] = mapped_column(String(7))  # e.g. 2027-Q1
    __table_args__ = (UniqueConstraint("project_id", "number", name="uq_pm_requirement_number"),)


class PmRequirementIssueLink(UUIDMixin, Base):
    __tablename__ = "pm_requirement_issue_links"
    requirement_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("pm_requirements.id", ondelete="CASCADE"), index=True)
    issue_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("pm_issues.id", ondelete="CASCADE"), index=True)
    added_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    added_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    __table_args__ = (UniqueConstraint("requirement_id", "issue_id", name="uq_pm_requirement_issue"),)


class PmRequirementDecisionLink(UUIDMixin, Base):
    __tablename__ = "pm_requirement_decision_links"
    requirement_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("pm_requirements.id", ondelete="CASCADE"), index=True)
    decision_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("pm_decisions.id", ondelete="CASCADE"), index=True)
    added_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    added_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    __table_args__ = (UniqueConstraint("requirement_id", "decision_id", name="uq_pm_requirement_decision"),)


class PmRequirementEvent(UUIDMixin, Base):
    __tablename__ = "pm_requirement_events"
    requirement_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("pm_requirements.id", ondelete="RESTRICT"), index=True)
    actor_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    actor_name: Mapped[str] = mapped_column(String(255))
    action: Mapped[str] = mapped_column(String(32))
    details: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
