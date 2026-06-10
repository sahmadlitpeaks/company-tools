import uuid
from datetime import datetime

from sqlalchemy import BigInteger, Boolean, DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.base import TimestampMixin, UUIDMixin


class ShortLink(UUIDMixin, TimestampMixin, Base):
    """A branded short link for campaigns (feature #8). Served at /s/{code}.

    Also backs public document shares (brochures / marketing assets), so it
    carries the optional access controls those shares need: expiry, a passcode
    and a "capture a lead before download" flag.
    """

    __tablename__ = "short_links"

    code: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    target_url: Mapped[str] = mapped_column(String(2048))
    title: Mapped[str | None] = mapped_column(String(255))
    campaign: Mapped[str | None] = mapped_column(String(255), index=True)
    is_active: Mapped[bool] = mapped_column(default=True)
    click_count: Mapped[int] = mapped_column(BigInteger, default=0)
    # Optional access controls (used by document shares; also handy for any link).
    expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    passcode_hash: Mapped[str | None] = mapped_column(String(255))
    require_lead: Mapped[bool] = mapped_column(Boolean, default=False)
    company_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("companies.id", ondelete="SET NULL"), index=True, nullable=True
    )

    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    clicks: Mapped[list["LinkClick"]] = relationship(
        back_populates="link", cascade="all, delete-orphan"
    )

    def is_expired(self, now: datetime) -> bool:
        return self.expires_at is not None and self.expires_at <= now


class LinkClick(UUIDMixin, TimestampMixin, Base):
    """A single click on a short link — analytics (feature #8)."""

    __tablename__ = "link_clicks"

    link_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("short_links.id", ondelete="CASCADE"), index=True
    )
    ip_address: Mapped[str | None] = mapped_column(String(64))
    user_agent: Mapped[str | None] = mapped_column(String(512))
    referer: Mapped[str | None] = mapped_column(String(512))

    link: Mapped["ShortLink"] = relationship(back_populates="clicks")
