"""Project tracker (Jira-style): projects, issues, sprints-ready backlog data.

Kept separate from ``workplace.Task`` on purpose. Ordinary tasks also carry
routine-check runs, onboarding mirrors and assignment-email delivery; the
tracker has its own hierarchy (Epic -> Story/Task/Bug -> Sub-task), per-project
membership and a field-level change history.

Access is per project: a user sees a project only when they are a member of
it (any role) or a platform admin.
"""
import uuid
from datetime import date, datetime

from sqlalchemy import (
    JSON,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.base import TimestampMixin, UUIDMixin

# Project roles, most to least privileged.
PROJECT_ROLES = ("admin", "member", "viewer")
ISSUE_TYPES = ("epic", "story", "task", "bug", "subtask")
ISSUE_STATUSES = ("todo", "in_progress", "in_review", "done")
ISSUE_PRIORITIES = ("highest", "high", "medium", "low", "lowest")
LINK_TYPES = ("blocks", "relates")


class PmProject(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "pm_projects"

    # Short upper-case code used in issue keys, e.g. "LIMS" -> LIMS-12.
    key: Mapped[str] = mapped_column(String(10), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(255))
    description: Mapped[str | None] = mapped_column(Text)
    lead_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), index=True, nullable=True
    )
    # active | archived
    status: Mapped[str] = mapped_column(String(16), default="active", index=True)
    start_date: Mapped[date | None] = mapped_column(Date)
    target_date: Mapped[date | None] = mapped_column(Date)
    # Last issue number handed out; incremented under a row lock.
    issue_seq: Mapped[int] = mapped_column(Integer, default=0)
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )


class PmProjectMember(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "pm_project_members"

    project_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("pm_projects.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    # admin | member | viewer
    role: Mapped[str] = mapped_column(String(16), default="member")

    __table_args__ = (
        UniqueConstraint("project_id", "user_id", name="uq_pm_project_member"),
    )


class PmIssue(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "pm_issues"

    project_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("pm_projects.id", ondelete="CASCADE"), index=True
    )
    number: Mapped[int] = mapped_column(Integer)
    # epic | story | task | bug | subtask
    issue_type: Mapped[str] = mapped_column(String(16), default="task", index=True)
    summary: Mapped[str] = mapped_column(String(255))
    description: Mapped[str | None] = mapped_column(Text)
    # todo | in_progress | in_review | done
    status: Mapped[str] = mapped_column(String(16), default="todo", index=True)
    # highest | high | medium | low | lowest
    priority: Mapped[str] = mapped_column(String(16), default="medium")
    story_points: Mapped[float | None] = mapped_column(Float)
    labels: Mapped[list[str] | None] = mapped_column(JSON)
    reporter_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), index=True, nullable=True
    )
    assignee_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), index=True, nullable=True
    )
    # Epic for stories/tasks/bugs; the parent issue for sub-tasks.
    parent_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("pm_issues.id", ondelete="SET NULL"), index=True, nullable=True
    )
    start_date: Mapped[date | None] = mapped_column(Date)
    due_date: Mapped[date | None] = mapped_column(Date)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Backlog ordering; lower comes first.
    rank: Mapped[float] = mapped_column(Float, default=0)
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    __table_args__ = (
        UniqueConstraint("project_id", "number", name="uq_pm_issue_number"),
    )


class PmIssueWatcher(UUIDMixin, Base):
    __tablename__ = "pm_issue_watchers"

    issue_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("pm_issues.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )

    __table_args__ = (
        UniqueConstraint("issue_id", "user_id", name="uq_pm_issue_watcher"),
    )


class PmIssueLink(UUIDMixin, Base):
    """``source`` blocks/relates to ``target``; "is blocked by" is the reverse."""

    __tablename__ = "pm_issue_links"

    source_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("pm_issues.id", ondelete="CASCADE"), index=True
    )
    target_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("pm_issues.id", ondelete="CASCADE"), index=True
    )
    # blocks | relates
    link_type: Mapped[str] = mapped_column(String(16))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    __table_args__ = (
        UniqueConstraint("source_id", "target_id", "link_type", name="uq_pm_issue_link"),
    )


class PmComment(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "pm_comments"

    issue_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("pm_issues.id", ondelete="CASCADE"), index=True
    )
    author_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    body: Mapped[str] = mapped_column(Text)


class PmIssueHistory(UUIDMixin, Base):
    """One field change on an issue (Jira's "History" tab)."""

    __tablename__ = "pm_issue_history"

    issue_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("pm_issues.id", ondelete="CASCADE"), index=True
    )
    actor_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    field: Mapped[str] = mapped_column(String(32))
    old_value: Mapped[str | None] = mapped_column(Text)
    new_value: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, index=True
    )
