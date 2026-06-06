"""Work logs: effort + a short note of what someone did. Can hang off a ticket
or task (so cross-team effort is visible) or stand alone (R&D, ad-hoc work)."""
import uuid
from datetime import date

from sqlalchemy import Date, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.base import TimestampMixin, UUIDMixin


class WorkLog(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "work_logs"

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    work_date: Mapped[date] = mapped_column(Date, index=True, default=date.today)
    minutes: Mapped[int] = mapped_column(Integer, default=0)
    description: Mapped[str] = mapped_column(Text)
    # ticket | task | rnd | support | meeting | admin | other
    kind: Mapped[str] = mapped_column(String(24), default="other", index=True)
    # Optional link to a ticket/task ("ticket" | "task" | None).
    entity_type: Mapped[str | None] = mapped_column(String(24), index=True)
    entity_id: Mapped[uuid.UUID | None] = mapped_column(index=True)
