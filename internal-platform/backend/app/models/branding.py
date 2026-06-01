import uuid

from sqlalchemy import BigInteger, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.base import TimestampMixin, UUIDMixin


class BrandKit(UUIDMixin, TimestampMixin, Base):
    """A brand / sub-brand with guidelines and assets (feature #4)."""

    __tablename__ = "brand_kits"

    name: Mapped[str] = mapped_column(String(255))
    description: Mapped[str | None] = mapped_column(Text)
    guidelines_url: Mapped[str | None] = mapped_column(String(1024))
    # JSON-encoded palette, e.g. [{"name":"Primary","hex":"#0b5cab"}]
    primary_colors: Mapped[str | None] = mapped_column(Text)
    fonts: Mapped[str | None] = mapped_column(Text)
    logo_url: Mapped[str | None] = mapped_column(String(1024))

    assets: Mapped[list["BrandAsset"]] = relationship(
        back_populates="brand_kit", cascade="all, delete-orphan"
    )


class BrandAsset(UUIDMixin, TimestampMixin, Base):
    """A downloadable brand asset (logo variant, font file, template…)."""

    __tablename__ = "brand_assets"

    brand_kit_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("brand_kits.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(512))
    category: Mapped[str] = mapped_column(String(64), default="logo")
    file_path: Mapped[str] = mapped_column(String(1024))
    content_type: Mapped[str | None] = mapped_column(String(255))
    size_bytes: Mapped[int] = mapped_column(BigInteger, default=0)

    brand_kit: Mapped["BrandKit"] = relationship(back_populates="assets")
