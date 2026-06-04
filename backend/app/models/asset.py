import uuid
from typing import TYPE_CHECKING

from sqlalchemy import BigInteger, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.base import TimestampMixin, UUIDMixin

if TYPE_CHECKING:
    from app.models.shortlink import ShortLink


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
    # Public sharing (shareable brochures/reports with a short URL).
    is_public: Mapped[bool] = mapped_column(default=False)
    short_link_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("short_links.id", ondelete="SET NULL"), nullable=True
    )

    folder: Mapped["Folder"] = relationship(back_populates="assets")
    short_link: Mapped["ShortLink | None"] = relationship("ShortLink", lazy="raise")

    @property
    def share_code(self) -> str | None:
        """Code of the linked short link, when it has been eager-loaded."""
        link = self.__dict__.get("short_link")
        return link.code if link else None
