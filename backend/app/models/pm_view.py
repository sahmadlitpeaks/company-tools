"""Named boards and saved perspectives; deleting a view never deletes work."""
import uuid

from sqlalchemy import JSON, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.base import TimestampMixin, UUIDMixin


class PmView(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "pm_views"

    project_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("pm_projects.id", ondelete="CASCADE"), index=True, nullable=True
    )
    owner_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(120))
    visibility: Mapped[str] = mapped_column(String(16), default="team")
    settings: Mapped[dict] = mapped_column(JSON, default=dict)
