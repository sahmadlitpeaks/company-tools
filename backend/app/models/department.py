from sqlalchemy import JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.base import TimestampMixin, UUIDMixin


class Department(UUIDMixin, TimestampMixin, Base):
    """An access group: a named set of module permissions assigned to staff.

    Members of a department inherit its ``permissions``; admins can still grant
    or revoke individual modules per person on top of this.
    """

    __tablename__ = "departments"

    name: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    description: Mapped[str | None] = mapped_column(Text)
    # Module keys (see app.core.permissions.MODULES) this department grants.
    permissions: Mapped[list[str]] = mapped_column(JSON, default=list)
