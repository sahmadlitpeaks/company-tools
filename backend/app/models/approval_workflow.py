"""Configurable multi-step approval workflows.

An ``ApprovalWorkflow`` defines, per approval type, an ordered list of steps.
When a request of that type is created, the engine instantiates ``ApprovalStep``
rows (resolving each step's approver) and the request advances step-by-step.

Step config shape (JSON):
    {"approver": "manager" | "hr" | "admin" | "user",
     "user_id": "<uuid>",          # only for approver == "user"
     "min_amount": 1000}            # optional: skip the step below this amount
"""
import uuid
from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.base import TimestampMixin, UUIDMixin

APPROVER_KINDS = {"manager", "hr", "admin", "user"}
STEP_STATUSES = {"pending", "approved", "rejected", "skipped"}


class ApprovalWorkflow(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "approval_workflows"

    # One active workflow per approval type (leave/expense/purchase/…).
    type: Mapped[str] = mapped_column(String(24), index=True)
    name: Mapped[str] = mapped_column(String(160))
    active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    steps: Mapped[list | None] = mapped_column(JSON)


class ApprovalStep(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "approval_steps"

    request_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("approval_requests.id", ondelete="CASCADE"), index=True
    )
    seq: Mapped[int] = mapped_column(Integer, default=0)
    approver_kind: Mapped[str] = mapped_column(String(16), default="manager")
    # Resolved concrete approver for kinds manager/user (null for hr/admin pools).
    approver_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    status: Mapped[str] = mapped_column(String(16), default="pending", index=True)
    decided_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    note: Mapped[str | None] = mapped_column(Text)
