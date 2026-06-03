import uuid

from sqlalchemy import BigInteger, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.base import TimestampMixin, UUIDMixin


class BrandDocument(UUIDMixin, TimestampMixin, Base):
    """A named brand document (logo, guidelines, font…) that keeps versions.

    Re-uploading under the same name adds a new version automatically.
    """

    __tablename__ = "brand_documents"

    brand_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("brands.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(255))
    # logo | guideline | font | document | other
    category: Mapped[str] = mapped_column(String(32), default="document", index=True)
    current_version: Mapped[int] = mapped_column(Integer, default=0)

    versions: Mapped[list["BrandDocumentVersion"]] = relationship(
        back_populates="document",
        cascade="all, delete-orphan",
        order_by="BrandDocumentVersion.version.desc()",
    )


class BrandDocumentVersion(UUIDMixin, TimestampMixin, Base):
    """A single uploaded version of a brand document."""

    __tablename__ = "brand_document_versions"

    document_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("brand_documents.id", ondelete="CASCADE"), index=True
    )
    version: Mapped[int] = mapped_column(Integer)
    file_path: Mapped[str] = mapped_column(String(1024))
    content_type: Mapped[str | None] = mapped_column(String(255))
    size_bytes: Mapped[int] = mapped_column(BigInteger, default=0)
    uploaded_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    document: Mapped["BrandDocument"] = relationship(back_populates="versions")
