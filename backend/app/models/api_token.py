"""Scoped API tokens for programmatic read access by external integrations.

The raw token (``ct_<random>``) is shown once at creation; only its SHA-256
hash is stored. Each token carries a set of read scopes.
"""
import uuid
from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.base import TimestampMixin, UUIDMixin

API_SCOPES = ["read:directory", "read:crm", "read:attendance", "read:expenses"]


class ApiToken(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "api_tokens"

    name: Mapped[str] = mapped_column(String(160))
    # SHA-256 hex of the raw token; the raw value is never stored.
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    # First chars of the raw token, for display (e.g. ct_ab12…).
    prefix: Mapped[str] = mapped_column(String(16))
    scopes: Mapped[list | None] = mapped_column(JSON)
    active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
