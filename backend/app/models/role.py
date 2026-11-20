"""Editable roles and the grants that hand them out (BRD section 7.1).

A role is a named bundle of permissions of one scope. Platform roles are
granted to people directly or through their department; project roles are held
by project members (``pm_project_members.role`` stores the role key). Per-person
allow/deny overrides sit on top; a deny always wins.
"""
import uuid

from sqlalchemy import JSON, Boolean, Column, ForeignKey, String, Table, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.base import TimestampMixin, UUIDMixin

user_platform_roles = Table(
    "user_platform_roles",
    Base.metadata,
    Column("user_id", ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
    Column("role_id", ForeignKey("roles.id", ondelete="CASCADE"), primary_key=True),
)

department_roles = Table(
    "department_roles",
    Base.metadata,
    Column("department_id", ForeignKey("departments.id", ondelete="CASCADE"), primary_key=True),
    Column("role_id", ForeignKey("roles.id", ondelete="CASCADE"), primary_key=True),
)


class Role(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "roles"

    # Stable identifier. Project roles are referenced by key from
    # pm_project_members.role; the starter keys are admin, member and viewer.
    key: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(128))
    description: Mapped[str | None] = mapped_column(Text)
    scope: Mapped[str] = mapped_column(String(16), index=True)  # platform | project
    permissions: Mapped[list[str]] = mapped_column(JSON, default=list)
    # Starter roles can be edited but not deleted.
    is_system: Mapped[bool] = mapped_column(Boolean, default=False)
    # Owner: holds every permission, can't be edited, deleted or given to a department.
    is_protected: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")


class UserPermissionOverride(UUIDMixin, TimestampMixin, Base):
    """A per-person platform allow or deny on top of the person's roles."""

    __tablename__ = "user_permission_overrides"

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    permission: Mapped[str] = mapped_column(String(64))
    allow: Mapped[bool] = mapped_column(Boolean)

    __table_args__ = (
        UniqueConstraint("user_id", "permission", name="uq_user_permission_override"),
    )
