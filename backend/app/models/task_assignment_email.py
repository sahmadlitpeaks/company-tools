"""Durable assignment email queue; created in the same transaction as the task."""
import uuid
from datetime import datetime
from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base
from app.models.base import TimestampMixin, UUIDMixin

class TaskAssignmentEmail(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "task_assignment_emails"
    __table_args__ = (CheckConstraint(
        "(task_id IS NOT NULL) <> (compliance_task_id IS NOT NULL)",
        name="ck_task_assignment_email_one_task"),)
    task_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"), index=True)
    compliance_task_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("sharepoint_compliance_tasks.id", ondelete="CASCADE"), index=True)
    notification_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("notifications.id", ondelete="SET NULL"), unique=True)
    recipient_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    actor_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    status: Mapped[str] = mapped_column(String(24), default="pending", index=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    next_attempt_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_error: Mapped[str | None] = mapped_column(String(128))
