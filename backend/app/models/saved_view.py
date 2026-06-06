import uuid

from sqlalchemy import ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.base import TimestampMixin, UUIDMixin


class SavedView(UUIDMixin, TimestampMixin, Base):
    """A user's saved filter combination for a list surface (tickets/tasks)."""

    __tablename__ = "saved_views"
    __table_args__ = (UniqueConstraint("user_id", "surface", "name", name="uq_saved_view"),)

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    # Which list this view belongs to: "tickets" | "tasks".
    surface: Mapped[str] = mapped_column(String(24), index=True)
    name: Mapped[str] = mapped_column(String(64))
    # The saved query string (e.g. "scope=unassigned&priority=urgent").
    params: Mapped[str] = mapped_column(Text, default="")
