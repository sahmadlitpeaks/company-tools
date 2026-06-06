"""Personal quick-access workspace: notes, links (e.g. OneDrive deep-links) and
small file uploads, pinned and searchable so important things aren't lost."""
import uuid

from sqlalchemy import BigInteger, Boolean, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.base import TimestampMixin, UUIDMixin


class WorkspaceItem(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "workspace_items"

    owner_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    # note | link | file
    kind: Mapped[str] = mapped_column(String(16), default="note", index=True)
    title: Mapped[str] = mapped_column(String(512))
    body: Mapped[str | None] = mapped_column(Text)
    url: Mapped[str | None] = mapped_column(String(2048))
    file_path: Mapped[str | None] = mapped_column(String(1024))
    content_type: Mapped[str | None] = mapped_column(String(255))
    size_bytes: Mapped[int] = mapped_column(BigInteger, default=0)
    tags: Mapped[str | None] = mapped_column(String(512))
    pinned: Mapped[bool] = mapped_column(Boolean, default=False)
    shared: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
