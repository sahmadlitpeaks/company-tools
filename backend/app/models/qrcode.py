import uuid

from sqlalchemy import BigInteger, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.base import TimestampMixin, UUIDMixin


class QRCode(UUIDMixin, TimestampMixin, Base):
    """A generated QR code pointing at a URL (feature #5).

    Stored as a record so codes can be re-rendered and (optionally) tracked.
    """

    __tablename__ = "qr_codes"

    label: Mapped[str] = mapped_column(String(255))
    target_url: Mapped[str] = mapped_column(String(2048))
    fill_color: Mapped[str] = mapped_column(String(9), default="#000000")
    back_color: Mapped[str] = mapped_column(String(9), default="#ffffff")
    scan_count: Mapped[int] = mapped_column(BigInteger, default=0)

    product_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("products.id", ondelete="SET NULL"), nullable=True
    )
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
