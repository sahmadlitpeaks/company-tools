import uuid

from sqlalchemy import ForeignKey, JSON
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.base import TimestampMixin, UUIDMixin


class DashboardPreference(UUIDMixin, TimestampMixin, Base):
    """Per-account dashboard order and visibility."""

    __tablename__ = "dashboard_preferences"

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), unique=True, index=True
    )
    widget_order: Mapped[list[str]] = mapped_column(JSON, default=list)
    hidden_widgets: Mapped[list[str]] = mapped_column(JSON, default=list)
