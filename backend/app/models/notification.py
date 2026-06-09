import uuid

from sqlalchemy import Boolean, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.base import TimestampMixin, UUIDMixin


class Notification(UUIDMixin, TimestampMixin, Base):
    """An in-app notification for a single user."""

    __tablename__ = "notifications"

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    title: Mapped[str] = mapped_column(String(255))
    body: Mapped[str | None] = mapped_column(Text)
    # In-app route to open when clicked, e.g. "/asset-tracker".
    link: Mapped[str | None] = mapped_column(String(512))
    category: Mapped[str] = mapped_column(String(48), default="info")
    is_read: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    # Optional key used to avoid creating duplicate alerts (e.g. "warranty:<id>").
    dedup_key: Mapped[str | None] = mapped_column(String(128), index=True)
