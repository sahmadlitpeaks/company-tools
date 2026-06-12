"""Admin-defined custom fields and repeatable custom tables on employees.

This is the data platform for HRIS parity: HR can extend the employee record
without code (single-value fields grouped into sections, plus repeatable tables
like dependents / education / prior employment).
"""
import uuid

from sqlalchemy import JSON, Boolean, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.base import TimestampMixin, UUIDMixin

FIELD_TYPES = {"text", "textarea", "number", "date", "select", "bool"}


class CustomFieldDef(UUIDMixin, TimestampMixin, Base):
    """Definition of one single-value custom field on the employee record."""

    __tablename__ = "custom_field_defs"

    entity: Mapped[str] = mapped_column(String(24), default="employee", index=True)
    section: Mapped[str] = mapped_column(String(64), default="custom", index=True)
    key: Mapped[str] = mapped_column(String(64), index=True)
    label: Mapped[str] = mapped_column(String(255))
    field_type: Mapped[str] = mapped_column(String(16), default="text")
    options: Mapped[list | None] = mapped_column(JSON)  # for select
    required: Mapped[bool] = mapped_column(Boolean, default=False)
    sensitive: Mapped[bool] = mapped_column(Boolean, default=False)
    sort: Mapped[int] = mapped_column(Integer, default=0)
    active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)

    __table_args__ = (UniqueConstraint("entity", "key", name="uq_custom_field_key"),)


class CustomFieldValue(UUIDMixin, TimestampMixin, Base):
    """A value for one custom field on one employee."""

    __tablename__ = "custom_field_values"

    def_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("custom_field_defs.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    value: Mapped[object | None] = mapped_column(JSON)

    __table_args__ = (UniqueConstraint("def_id", "user_id", name="uq_custom_value"),)


class CustomTableDef(UUIDMixin, TimestampMixin, Base):
    """A repeatable table (e.g. Dependents) with a JSON column schema."""

    __tablename__ = "custom_table_defs"

    key: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    label: Mapped[str] = mapped_column(String(255))
    # [{"key","label","type","options"?}, …]
    columns: Mapped[list] = mapped_column(JSON, default=list)
    sensitive: Mapped[bool] = mapped_column(Boolean, default=False)
    sort: Mapped[int] = mapped_column(Integer, default=0)
    active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)


class CustomTableRow(UUIDMixin, TimestampMixin, Base):
    """One row of a custom table for one employee."""

    __tablename__ = "custom_table_rows"

    table_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("custom_table_defs.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    data: Mapped[dict] = mapped_column(JSON, default=dict)  # keyed by column key
    sort: Mapped[int] = mapped_column(Integer, default=0)
