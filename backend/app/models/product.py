import uuid

from sqlalchemy import BigInteger, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.base import TimestampMixin, UUIDMixin


class Product(UUIDMixin, TimestampMixin, Base):
    """A product/service that can have QR codes and brochures (feature #5)."""

    __tablename__ = "products"

    name: Mapped[str] = mapped_column(String(255))
    brand_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("brands.id", ondelete="SET NULL"), index=True, nullable=True
    )
    sku: Mapped[str | None] = mapped_column(String(128), index=True)
    description: Mapped[str | None] = mapped_column(Text)
    landing_url: Mapped[str | None] = mapped_column(String(1024))
    image_url: Mapped[str | None] = mapped_column(String(1024))

    brochures: Mapped[list["Brochure"]] = relationship(
        back_populates="product", cascade="all, delete-orphan"
    )


class Brochure(UUIDMixin, TimestampMixin, Base):
    """A downloadable brochure attached to a product (feature #5)."""

    __tablename__ = "brochures"

    product_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("products.id", ondelete="CASCADE"), index=True, nullable=True
    )
    title: Mapped[str] = mapped_column(String(512))
    file_path: Mapped[str] = mapped_column(String(1024))
    content_type: Mapped[str | None] = mapped_column(String(255))
    size_bytes: Mapped[int] = mapped_column(BigInteger, default=0)
    download_count: Mapped[int] = mapped_column(BigInteger, default=0)

    product: Mapped["Product"] = relationship(back_populates="brochures")
