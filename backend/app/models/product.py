import uuid
from typing import TYPE_CHECKING

from sqlalchemy import BigInteger, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.base import TimestampMixin, UUIDMixin

if TYPE_CHECKING:
    from app.models.shortlink import ShortLink


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
    version: Mapped[int] = mapped_column(Integer, default=1)
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    # Public sharing (shareable brochures/reports with a short URL).
    is_public: Mapped[bool] = mapped_column(default=False)
    short_link_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("short_links.id", ondelete="SET NULL"), nullable=True
    )

    product: Mapped["Product"] = relationship(back_populates="brochures")
    short_link: Mapped["ShortLink | None"] = relationship("ShortLink", lazy="raise")

    @property
    def share_code(self) -> str | None:
        """Code of the linked short link, when it has been eager-loaded."""
        link = self.__dict__.get("short_link")
        return link.code if link else None

    @property
    def share_expires_at(self):
        link = self.__dict__.get("short_link")
        return link.expires_at if link else None

    @property
    def share_require_lead(self) -> bool:
        link = self.__dict__.get("short_link")
        return bool(link.require_lead) if link else False

    @property
    def share_has_passcode(self) -> bool:
        link = self.__dict__.get("short_link")
        return bool(link and link.passcode_hash)
