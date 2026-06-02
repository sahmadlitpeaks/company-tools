import uuid

from sqlalchemy import ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.base import TimestampMixin, UUIDMixin


class DigitalCard(UUIDMixin, TimestampMixin, Base):
    """A shareable digital business card for an employee (feature #2)."""

    __tablename__ = "digital_cards"

    owner_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    # Public, human-friendly slug used in the share URL: /c/{slug}
    slug: Mapped[str] = mapped_column(String(80), unique=True, index=True)

    full_name: Mapped[str] = mapped_column(String(255))
    title: Mapped[str | None] = mapped_column(String(255))
    company: Mapped[str | None] = mapped_column(String(255), default="AG Holding")
    email: Mapped[str | None] = mapped_column(String(320))
    phone: Mapped[str | None] = mapped_column(String(64))
    whatsapp: Mapped[str | None] = mapped_column(String(64))
    website: Mapped[str | None] = mapped_column(String(512))
    linkedin: Mapped[str | None] = mapped_column(String(512))
    address: Mapped[str | None] = mapped_column(Text)
    bio: Mapped[str | None] = mapped_column(Text)
    photo_url: Mapped[str | None] = mapped_column(String(1024))
    accent_color: Mapped[str] = mapped_column(String(9), default="#0b5cab")

    is_active: Mapped[bool] = mapped_column(default=True)
    lead_capture_enabled: Mapped[bool] = mapped_column(default=True)

    owner: Mapped["object"] = relationship("User")
    scans: Mapped[list["CardScan"]] = relationship(
        back_populates="card", cascade="all, delete-orphan"
    )
    leads: Mapped[list["Lead"]] = relationship(
        back_populates="card", cascade="all, delete-orphan"
    )


class CardScan(UUIDMixin, TimestampMixin, Base):
    """One view/scan of a public card — basic analytics."""

    __tablename__ = "card_scans"

    card_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("digital_cards.id", ondelete="CASCADE"), index=True
    )
    ip_address: Mapped[str | None] = mapped_column(String(64))
    user_agent: Mapped[str | None] = mapped_column(String(512))
    referer: Mapped[str | None] = mapped_column(String(512))

    card: Mapped["DigitalCard"] = relationship(back_populates="scans")


class Lead(UUIDMixin, TimestampMixin, Base):
    """An optional lead captured from a card scan (feature #2)."""

    __tablename__ = "leads"

    card_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("digital_cards.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(255))
    email: Mapped[str | None] = mapped_column(String(320))
    phone: Mapped[str | None] = mapped_column(String(64))
    company: Mapped[str | None] = mapped_column(String(255))
    message: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(32), default="new")

    card: Mapped["DigitalCard"] = relationship(back_populates="leads")
