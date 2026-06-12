"""Employee expense claims with reimbursement tracking.

A claim is created as a draft, then submitted — which raises an approval
request of type ``expense`` so it flows through any configured approval
workflow. Once approved, HR marks it reimbursed.
"""
import uuid
from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.base import TimestampMixin, UUIDMixin

EXPENSE_CATEGORIES = {
    "travel", "meals", "accommodation", "supplies", "software", "training", "other",
}
# draft -> submitted -> approved/rejected -> reimbursed
EXPENSE_STATUSES = {"draft", "submitted", "approved", "rejected", "reimbursed"}


class ExpenseClaim(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "expense_claims"

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    title: Mapped[str] = mapped_column(String(255))
    category: Mapped[str] = mapped_column(String(24), default="other", index=True)
    currency: Mapped[str] = mapped_column(String(8), default="USD")
    amount: Mapped[float] = mapped_column(Numeric(12, 2), default=0)
    expense_date: Mapped[date | None] = mapped_column(Date)
    description: Mapped[str | None] = mapped_column(Text)
    receipt_path: Mapped[str | None] = mapped_column(String(1024))

    status: Mapped[str] = mapped_column(String(16), default="draft", index=True)
    # The approval request raised on submit (drives approved/rejected).
    approval_request_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("approval_requests.id", ondelete="SET NULL"), nullable=True
    )
    reimbursed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    reimbursed_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
