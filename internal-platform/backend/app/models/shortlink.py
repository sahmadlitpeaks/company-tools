import uuid

from sqlalchemy import BigInteger, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.base import TimestampMixin, UUIDMixin


class ShortLink(UUIDMixin, TimestampMixin, Base):
    """A branded short link for campaigns (feature #8). Served at /s/{code}."""

    __tablename__ = "short_links"

    code: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    target_url: Mapped[str] = mapped_column(String(2048))
    title: Mapped[str | None] = mapped_column(String(255))
    campaign: Mapped[str | None] = mapped_column(String(255), index=True)
    is_active: Mapped[bool] = mapped_column(default=True)
    click_count: Mapped[int] = mapped_column(BigInteger, default=0)

    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    clicks: Mapped[list["LinkClick"]] = relationship(
        back_populates="link", cascade="all, delete-orphan"
    )


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
