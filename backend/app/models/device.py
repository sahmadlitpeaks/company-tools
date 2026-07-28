"""Per-device records for mobile clients: refresh tokens and push registrations.

Both tables are keyed to a user and a device, and both store only a hash or an
opaque provider token — never anything that would let a database reader
impersonate a session.
"""
import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.base import TimestampMixin, UUIDMixin

# Platforms a mobile/web client can identify itself as.
DEVICE_PLATFORMS = ["web", "ios", "android"]


class RefreshToken(UUIDMixin, TimestampMixin, Base):
    """A long-lived, revocable session handle for one device.

    The access token stays a short-lived JWT; this row is what lets a phone
    silently obtain a new one without asking the user to sign in again. Only the
    SHA-256 of the raw token is stored (same approach as ``ApiToken``), so a
    database compromise alone cannot resume a session.

    Rotation: every successful refresh revokes the presented token and issues a
    new one. ``replaced_by_id`` keeps the chain so a *reused* token — the
    signature of a stolen copy — can be detected and the whole chain killed.
    """

    __tablename__ = "refresh_tokens"

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    # SHA-256 hex of the raw token; the raw value is never stored.
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    # Free-text label shown in "your devices", e.g. "Sam's iPhone".
    device_label: Mapped[str | None] = mapped_column(String(120))
    platform: Mapped[str] = mapped_column(String(16), default="web")
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Set when this token was rotated out, pointing at its successor.
    replaced_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("refresh_tokens.id", ondelete="SET NULL"), nullable=True
    )


class PushDevice(UUIDMixin, TimestampMixin, Base):
    """A device registered to receive push notifications.

    ``token`` is the provider's registration token (FCM). It is stored as-is
    because it is what we must send to the provider; it grants no access to this
    platform on its own.
    """

    __tablename__ = "push_devices"

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    token: Mapped[str] = mapped_column(String(512), unique=True, index=True)
    platform: Mapped[str] = mapped_column(String(16), default="web")
    device_label: Mapped[str | None] = mapped_column(String(120))
    active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
