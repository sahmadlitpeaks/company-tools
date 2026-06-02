import uuid

from sqlalchemy import BigInteger, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.base import TimestampMixin, UUIDMixin


class LandingPage(UUIDMixin, TimestampMixin, Base):
    """A lightweight marketing landing page (feature #6).

    `blocks` stores a JSON document describing the page sections so the
    frontend builder can render/edit it, while `html` holds an optional
    rendered/custom HTML override served on the public route /p/{slug}.
    """

    __tablename__ = "landing_pages"

    slug: Mapped[str] = mapped_column(String(120), unique=True, index=True)
    title: Mapped[str] = mapped_column(String(255))
    description: Mapped[str | None] = mapped_column(Text)
    blocks: Mapped[str | None] = mapped_column(Text)  # JSON
    html: Mapped[str | None] = mapped_column(Text)
    theme: Mapped[str] = mapped_column(String(32), default="light")
    status: Mapped[str] = mapped_column(String(16), default="draft")  # draft|published
    view_count: Mapped[int] = mapped_column(BigInteger, default=0)

    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
