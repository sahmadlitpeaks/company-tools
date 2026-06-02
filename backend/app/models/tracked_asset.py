import uuid
from datetime import date

from sqlalchemy import Date, ForeignKey, Integer, Numeric, String, Text
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

    assigned_to_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), index=True, nullable=True
    )

    # ---- Purchase / finance ----
    purchase_date: Mapped[date | None] = mapped_column(Date)
    purchase_cost: Mapped[float | None] = mapped_column(Numeric(12, 2))
    vendor: Mapped[str | None] = mapped_column(String(255))
    warranty_expiry: Mapped[date | None] = mapped_column(Date)
    # Years of useful life for straight-line depreciation.
    useful_life_years: Mapped[int | None] = mapped_column(Integer)

    assigned_to: Mapped["object"] = relationship("User")
    events: Mapped[list["AssetEvent"]] = relationship(
        back_populates="asset",
        cascade="all, delete-orphan",
        order_by="AssetEvent.created_at.desc()",
    )


class AssetEvent(UUIDMixin, TimestampMixin, Base):
    """A check-out, check-in or maintenance event in an asset's history."""

    __tablename__ = "asset_events"

    asset_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("tracked_assets.id", ondelete="CASCADE"), index=True
    )
    # checkout | checkin | maintenance | note
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
