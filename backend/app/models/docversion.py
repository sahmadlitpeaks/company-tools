import uuid

from sqlalchemy import BigInteger, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.base import TimestampMixin, UUIDMixin


class DocVersion(UUIDMixin, TimestampMixin, Base):
    """A historical version of a shareable document (brochure or asset).

    When a file is replaced the previous file is snapshotted here, so a share
    link / QR code can stay live across updates while the old copies remain
    downloadable for audit.
    """

    __tablename__ = "doc_versions"

    # "brochure" | "asset"
    doc_type: Mapped[str] = mapped_column(String(16), index=True)
    doc_id: Mapped[uuid.UUID] = mapped_column(index=True)
    version: Mapped[int] = mapped_column(Integer)
    file_path: Mapped[str] = mapped_column(String(1024))
    content_type: Mapped[str | None] = mapped_column(String(255))
    size_bytes: Mapped[int] = mapped_column(BigInteger, default=0)
    note: Mapped[str | None] = mapped_column(Text)
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
