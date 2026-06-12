"""Per-field change audit for sensitive records (currently employee profiles).

Each edited field produces one ``FieldChange`` row capturing the before/after
values and who made the change, giving HR a granular history beyond the
coarse activity log.
"""
import uuid

from sqlalchemy import ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.base import TimestampMixin, UUIDMixin


class FieldChange(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "field_changes"

    entity_type: Mapped[str] = mapped_column(String(32), default="user", index=True)
    entity_id: Mapped[uuid.UUID] = mapped_column(index=True)
    field: Mapped[str] = mapped_column(String(64), index=True)
    old_value: Mapped[str | None] = mapped_column(Text)
    new_value: Mapped[str | None] = mapped_column(Text)
    actor_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
