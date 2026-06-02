import uuid

from sqlalchemy import BigInteger, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.base import TimestampMixin, UUIDMixin


class Folder(UUIDMixin, TimestampMixin, Base):
    """A folder in the marketing asset tree (feature #3)."""

    __tablename__ = "folders"

    name: Mapped[str] = mapped_column(String(255))
    parent_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("folders.id", ondelete="CASCADE"), index=True, nullable=True
    )
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    children: Mapped[list["Folder"]] = relationship(
        back_populates="parent", cascade="all, delete-orphan"
    )
    parent: Mapped["Folder"] = relationship(
        back_populates="children", remote_side="Folder.id"
    )
    assets: Mapped[list["Asset"]] = relationship(
        back_populates="folder", cascade="all, delete-orphan"
    )


class Asset(UUIDMixin, TimestampMixin, Base):
    """An uploaded marketing file (feature #3 & #4)."""

    __tablename__ = "assets"

    folder_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("folders.id", ondelete="CASCADE"), index=True, nullable=True
    )
    name: Mapped[str] = mapped_column(String(512))
    file_path: Mapped[str] = mapped_column(String(1024))
    content_type: Mapped[str | None] = mapped_column(String(255))
    size_bytes: Mapped[int] = mapped_column(BigInteger, default=0)
    uploaded_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    folder: Mapped["Folder"] = relationship(back_populates="assets")
