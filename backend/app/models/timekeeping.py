"""Time tracking / attendance — clock in-out, manual entries and weekly
timesheets with a submit→approve workflow (replaces Calamari clock-in)."""
import uuid
from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.base import TimestampMixin, UUIDMixin

ENTRY_SOURCES = {"clock", "manual"}
TIMESHEET_STATUSES = {"open", "submitted", "approved", "rejected"}


class TimeEntry(UUIDMixin, TimestampMixin, Base):
    """A worked-time entry — either a clock in/out pair or a manual block."""

    __tablename__ = "time_entries"

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    work_date: Mapped[date] = mapped_column(Date, index=True, default=date.today)
    clock_in: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    clock_out: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    minutes: Mapped[int] = mapped_column(Integer, default=0)
    kind: Mapped[str] = mapped_column(String(16), default="work")  # work | overtime | remote
    note: Mapped[str | None] = mapped_column(Text)
    source: Mapped[str] = mapped_column(String(8), default="manual")


class Timesheet(UUIDMixin, TimestampMixin, Base):
    """A week's worth of time for one person, with an approval workflow."""

    __tablename__ = "timesheets"

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    week_start: Mapped[date] = mapped_column(Date, index=True)  # Monday
    status: Mapped[str] = mapped_column(String(16), default="open", index=True)
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    decided_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    note: Mapped[str | None] = mapped_column(Text)
