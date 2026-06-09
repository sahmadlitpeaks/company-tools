"""SaaS / tool subscriptions the company pays for (ChatGPT, Adobe, etc.).

A subscription carries billing details and is assigned either company-wide, to
a department, or to specific people via per-person *seats*. Personal seats are
what surfaces (and gets revoked) when someone is offboarded.
"""
import uuid
from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.base import TimestampMixin, UUIDMixin

# How a subscription is assigned.
SCOPES = {"company", "department", "person"}
# Recurring cadence used to normalise spend to a monthly figure.
BILLING_CYCLES = {"monthly", "quarterly", "annual", "weekly", "one_time"}
COST_TYPES = {"flat", "per_seat"}
STATUSES = {"active", "trial", "paused", "cancelled", "expired"}


class Subscription(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "subscriptions"

    name: Mapped[str] = mapped_column(String(255), index=True)
    vendor: Mapped[str | None] = mapped_column(String(255))
    plan: Mapped[str | None] = mapped_column(String(255))
    url: Mapped[str | None] = mapped_column(String(1024))
    status: Mapped[str] = mapped_column(String(16), default="active", index=True)

    # company | department | person
    scope: Mapped[str] = mapped_column(String(16), default="person", index=True)
    department_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("departments.id", ondelete="SET NULL"), index=True, nullable=True
    )

    # flat | per_seat — drives how the recurring total is computed.
    cost_type: Mapped[str] = mapped_column(String(12), default="flat")
    cost: Mapped[float | None] = mapped_column(Numeric(12, 2))
    currency: Mapped[str] = mapped_column(String(8), default="USD")
    # monthly | quarterly | annual | weekly | one_time
    billing_cycle: Mapped[str] = mapped_column(String(12), default="monthly")

    start_date: Mapped[date | None] = mapped_column(Date)
    end_date: Mapped[date | None] = mapped_column(Date)
    auto_renew: Mapped[bool] = mapped_column(Boolean, default=True)

    owner_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    brand_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("brands.id", ondelete="SET NULL"), index=True, nullable=True
    )
    notes: Mapped[str | None] = mapped_column(Text)

    seats: Mapped[list["SubscriptionSeat"]] = relationship(
        back_populates="subscription",
        cascade="all, delete-orphan",
        order_by="SubscriptionSeat.created_at.asc()",
    )


class SubscriptionSeat(UUIDMixin, TimestampMixin, Base):
    """One person's seat on a subscription (assigned / revoked)."""

    __tablename__ = "subscription_seats"

    subscription_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("subscriptions.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    # active | revoked
    status: Mapped[str] = mapped_column(String(16), default="active", index=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    subscription: Mapped["Subscription"] = relationship(back_populates="seats")
