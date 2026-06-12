"""Outbound webhooks — register external URLs to receive platform events
(e.g. submission.created, employee.created) with an HMAC signature."""
import uuid

from sqlalchemy import JSON, Boolean, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.base import TimestampMixin, UUIDMixin

WEBHOOK_EVENTS = [
    "submission.created",
    "lead.created",
    "employee.created",
    "kudos.created",
    "leave.requested",
    "leave.decided",
]


class Webhook(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "webhooks"

    url: Mapped[str] = mapped_column(String(1024))
    description: Mapped[str | None] = mapped_column(String(255))
    secret: Mapped[str | None] = mapped_column(String(128), nullable=True)
    # Subscribed events; empty/null means all events.
    events: Mapped[list | None] = mapped_column(JSON)
    active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)


class WebhookDelivery(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "webhook_deliveries"

    webhook_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("webhooks.id", ondelete="CASCADE"), index=True
    )
    event: Mapped[str] = mapped_column(String(48), index=True)
    payload: Mapped[dict | None] = mapped_column(JSON)
    status_code: Mapped[int | None] = mapped_column(Integer, nullable=True)
    success: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
