import uuid
from datetime import datetime

from sqlalchemy import BigInteger, Boolean, DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.base import TimestampMixin, UUIDMixin


class SecureTransfer(UUIDMixin, TimestampMixin, Base):
    """A one-time, encrypted file hand-off (secure file sharing).

    The file is encrypted at rest with a key derived from a high-entropy
    token that is only ever present in the share link — never stored here.
    The DB keeps only `token_hash` (for lookup) and `salt` (for key
    derivation), so a database compromise alone cannot decrypt the payload.
    The file is deleted once consumed (burn-after-download) or expired.
    """

    __tablename__ = "secure_transfers"

    token_hash: Mapped[str] = mapped_column(
        String(64), unique=True, index=True, nullable=False
    )
    salt: Mapped[str] = mapped_column(String(64), nullable=False)

    filename: Mapped[str] = mapped_column(String(512))
    content_type: Mapped[str | None] = mapped_column(String(255))
    size_bytes: Mapped[int] = mapped_column(BigInteger, default=0)
    file_path: Mapped[str | None] = mapped_column(String(1024))  # ciphertext, nulled on delete

    sender_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    recipient_email: Mapped[str] = mapped_column(String(320))
    message: Mapped[str | None] = mapped_column(Text)

    # Optional second factor; bcrypt hash only (the password also feeds the key).
    password_hash: Mapped[str | None] = mapped_column(String(255))
    has_password: Mapped[bool] = mapped_column(Boolean, default=False)

    one_time: Mapped[bool] = mapped_column(Boolean, default=True)
    max_downloads: Mapped[int] = mapped_column(BigInteger, default=1)
    download_count: Mapped[int] = mapped_column(BigInteger, default=0)

    expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    is_consumed: Mapped[bool] = mapped_column(Boolean, default=False)
    consumed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    email_sent: Mapped[bool] = mapped_column(Boolean, default=False)
