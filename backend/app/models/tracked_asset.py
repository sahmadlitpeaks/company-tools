import uuid
from datetime import date

from sqlalchemy import BigInteger, Date, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.base import TimestampMixin, UUIDMixin


class TrackedAsset(UUIDMixin, TimestampMixin, Base):
    """A physical/IT asset tracked in the inventory (AssetTiger-style).

    Distinct from the marketing ``Asset`` (a stored file): this is a piece of
    equipment with a tag, an assignee, purchase/warranty info and a history of
    check-out / check-in / maintenance events.
    """

    __tablename__ = "tracked_assets"

    asset_tag: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(255))
    category: Mapped[str | None] = mapped_column(String(128), index=True)
    # available | assigned | maintenance | retired
    status: Mapped[str] = mapped_column(String(32), default="available", index=True)
    location: Mapped[str | None] = mapped_column(String(255))
    serial_number: Mapped[str | None] = mapped_column(String(128))
    notes: Mapped[str | None] = mapped_column(Text)
    # new | good | fair | poor | damaged
    condition: Mapped[str | None] = mapped_column(String(16))

    assigned_to_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), index=True, nullable=True
    )
    company_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("companies.id", ondelete="SET NULL"), index=True, nullable=True
    )

    # ---- Purchase / finance ----
    purchase_date: Mapped[date | None] = mapped_column(Date)
    purchase_cost: Mapped[float | None] = mapped_column(Numeric(12, 2))
    vendor: Mapped[str | None] = mapped_column(String(255))
    warranty_expiry: Mapped[date | None] = mapped_column(Date)
    # Years of useful life for straight-line depreciation.
    useful_life_years: Mapped[int | None] = mapped_column(Integer)

    # ---- Preventive maintenance schedule ----
    next_maintenance_date: Mapped[date | None] = mapped_column(Date)
    maintenance_interval_days: Mapped[int | None] = mapped_column(Integer)

    # ---- Retirement / disposal ----
    disposal_date: Mapped[date | None] = mapped_column(Date)
    salvage_value: Mapped[float | None] = mapped_column(Numeric(12, 2))
    disposal_notes: Mapped[str | None] = mapped_column(Text)

    assigned_to: Mapped["object"] = relationship("User")
    events: Mapped[list["AssetEvent"]] = relationship(
        back_populates="asset",
        cascade="all, delete-orphan",
        order_by="AssetEvent.created_at.desc()",
    )
    attachments: Mapped[list["AssetAttachment"]] = relationship(
        back_populates="asset", cascade="all, delete-orphan"
    )


class AssetEvent(UUIDMixin, TimestampMixin, Base):
    """A check-out, check-in or maintenance event in an asset's history."""

    __tablename__ = "asset_events"

    asset_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("tracked_assets.id", ondelete="CASCADE"), index=True
    )
    # checkout | checkin | maintenance | note | condition | retired
    event_type: Mapped[str] = mapped_column(String(32))
    # For check-outs: the employee the asset was assigned to.
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    note: Mapped[str | None] = mapped_column(Text)
    cost: Mapped[float | None] = mapped_column(Numeric(12, 2))
    # Who recorded the event.
    performed_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    asset: Mapped["TrackedAsset"] = relationship(back_populates="events")


class AssetCategory(UUIDMixin, TimestampMixin, Base):
    """A managed asset category (avoids freetext typos in rollups)."""

    __tablename__ = "asset_categories"

    name: Mapped[str] = mapped_column(String(128), unique=True, index=True)


class AssetLocation(UUIDMixin, TimestampMixin, Base):
    """A managed physical location."""

    __tablename__ = "asset_locations"

    name: Mapped[str] = mapped_column(String(255), unique=True, index=True)


class AssetAttachment(UUIDMixin, TimestampMixin, Base):
    """A file attached to an asset: photo, receipt, warranty doc, etc."""

    __tablename__ = "asset_attachments"

    asset_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("tracked_assets.id", ondelete="CASCADE"), index=True
    )
    # photo | receipt | warranty | document
    kind: Mapped[str] = mapped_column(String(16), default="document")
    name: Mapped[str] = mapped_column(String(512))
    file_path: Mapped[str] = mapped_column(String(1024))
    content_type: Mapped[str | None] = mapped_column(String(255))
    size_bytes: Mapped[int] = mapped_column(BigInteger, default=0)
    uploaded_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    asset: Mapped["TrackedAsset"] = relationship(back_populates="attachments")
