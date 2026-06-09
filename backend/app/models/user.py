import uuid

from sqlalchemy import JSON, Boolean, Column, ForeignKey, String, Table
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.base import TimestampMixin, UUIDMixin

# Brands a "manager" is allowed to manage (admins manage all; members none).
user_brands = Table(
    "user_brands",
    Base.metadata,
    Column("user_id", ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
    Column("brand_id", ForeignKey("brands.id", ondelete="CASCADE"), primary_key=True),
)


class User(UUIDMixin, TimestampMixin, Base):
    """An employee, synced from Azure Entra ID (feature #1)."""

    __tablename__ = "users"

    # Azure object id (oid claim) — the stable unique identity from Entra.
    azure_oid: Mapped[str | None] = mapped_column(
        String(64), unique=True, index=True, nullable=True
    )
    # Official / login email — optional for brand-new joiners (not yet assigned).
    email: Mapped[str | None] = mapped_column(
        String(320), unique=True, index=True, nullable=True
    )
    personal_email: Mapped[str | None] = mapped_column(String(320), index=True)
    display_name: Mapped[str | None] = mapped_column(String(255))
    given_name: Mapped[str | None] = mapped_column(String(255))
    surname: Mapped[str | None] = mapped_column(String(255))
    job_title: Mapped[str | None] = mapped_column(String(255))
    department: Mapped[str | None] = mapped_column(String(255))
    office_location: Mapped[str | None] = mapped_column(String(255))
    mobile_phone: Mapped[str | None] = mapped_column(String(64))
    business_phone: Mapped[str | None] = mapped_column(String(64))
    avatar_url: Mapped[str | None] = mapped_column(String(1024))
    # Extra HR details captured at onboarding.
    passport_no: Mapped[str | None] = mapped_column(String(64))
    nationality: Mapped[str | None] = mapped_column(String(128))
    # External system ids for sync.
    bamboo_id: Mapped[str | None] = mapped_column(String(64))

    # Local password sign-in (for users not coming via Azure SSO). Encoded
    # PBKDF2 hash; null means the user can only sign in via SSO.
    password_hash: Mapped[str | None] = mapped_column(String(255))
    # Force a password change on next login (e.g. the seeded default admin).
    must_change_password: Mapped[bool] = mapped_column(Boolean, default=False)

    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False)
    # admin | manager | member
    role: Mapped[str] = mapped_column(String(16), default="member")
    # pending (awaiting admin approval) | active | disabled
    status: Mapped[str] = mapped_column(String(16), default="pending")
    # Explicit per-user module grants; null = use the role's defaults.
    permissions: Mapped[list[str] | None] = mapped_column(JSON, nullable=True)
    # Access department (drives base permissions). Distinct from the free-text
    # `department` HR label above.
    department_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("departments.id", ondelete="SET NULL"), index=True, nullable=True
    )
    # Per-person overrides layered on top of the department's permissions.
    extra_permissions: Mapped[list[str] | None] = mapped_column(JSON, nullable=True)
    revoked_permissions: Mapped[list[str] | None] = mapped_column(JSON, nullable=True)

    managed_brands: Mapped[list["object"]] = relationship(
        "Brand", secondary=user_brands, lazy="selectin"
    )
    access_department: Mapped["object"] = relationship(
        "Department", lazy="selectin"
    )

    @property
    def managed_brand_ids(self) -> list[uuid.UUID]:
        return [b.id for b in self.managed_brands]

    @property
    def department_name(self) -> str | None:
        return self.access_department.name if self.access_department else None

    @property
    def effective_permissions(self) -> list[str]:
        from app.core.permissions import resolve_permissions

        dept = self.access_department
        return resolve_permissions(
            role=self.role,
            is_admin=self.is_admin,
            permissions=self.permissions,
            department_perms=dept.permissions if dept else None,
            extra=self.extra_permissions,
            revoked=self.revoked_permissions,
        )
