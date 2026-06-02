import uuid

from sqlalchemy import Boolean, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.base import TimestampMixin, UUIDMixin

# Stable id of the seeded default brand (also referenced by the migration).
DEFAULT_BRAND_ID = uuid.UUID("b5a4d000-0000-4000-8000-000000000001")


class Brand(UUIDMixin, TimestampMixin, Base):
    """A company brand/identity (e.g. AG Holding, Agiomix, Timepiece).

    The canonical brand record that other modules reference for logo, colours,
    company name, website and contact details.
    """

    __tablename__ = "brands"

    slug: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(255))
    logo_url: Mapped[str | None] = mapped_column(String(1024))
    icon_url: Mapped[str | None] = mapped_column(String(1024))
    primary_color: Mapped[str] = mapped_column(String(9), default="#0b5cab")
    secondary_color: Mapped[str | None] = mapped_column(String(9))
    accent_color: Mapped[str] = mapped_column(String(9), default="#0b5cab")
    font_family: Mapped[str | None] = mapped_column(String(255))
    website: Mapped[str | None] = mapped_column(String(512))
    email_domain: Mapped[str | None] = mapped_column(String(255))
    contact_email: Mapped[str | None] = mapped_column(String(320))
    phone: Mapped[str | None] = mapped_column(String(64))
    address: Mapped[str | None] = mapped_column(Text)
    tagline: Mapped[str | None] = mapped_column(String(512))
    social: Mapped[str | None] = mapped_column(Text)  # JSON object of links
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)
