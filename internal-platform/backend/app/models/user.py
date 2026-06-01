from sqlalchemy import Boolean, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.base import TimestampMixin, UUIDMixin


class User(UUIDMixin, TimestampMixin, Base):
    """An employee, synced from Azure Entra ID (feature #1)."""

    __tablename__ = "users"

    # Azure object id (oid claim) — the stable unique identity from Entra.
    azure_oid: Mapped[str | None] = mapped_column(
        String(64), unique=True, index=True, nullable=True
    )
    email: Mapped[str] = mapped_column(
        String(320), unique=True, index=True, nullable=False
    )
    display_name: Mapped[str | None] = mapped_column(String(255))
    given_name: Mapped[str | None] = mapped_column(String(255))
    surname: Mapped[str | None] = mapped_column(String(255))
    job_title: Mapped[str | None] = mapped_column(String(255))
    department: Mapped[str | None] = mapped_column(String(255))
    office_location: Mapped[str | None] = mapped_column(String(255))
    mobile_phone: Mapped[str | None] = mapped_column(String(64))
    business_phone: Mapped[str | None] = mapped_column(String(64))
    avatar_url: Mapped[str | None] = mapped_column(String(1024))

    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False)
