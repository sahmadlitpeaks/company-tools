import uuid
from datetime import date

from sqlalchemy import Date, ForeignKey, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.base import TimestampMixin, UUIDMixin


class PhoneLine(UUIDMixin, TimestampMixin, Base):
    """A mobile line / SIM tracked in the asset inventory.

    Like a tracked asset but for telecom: a number with a carrier, a package,
    a monthly cost, an assignee, a history of who held it and a billing log.
    """

    __tablename__ = "phone_lines"

    number: Mapped[str] = mapped_column(String(40), unique=True, index=True)
    carrier: Mapped[str | None] = mapped_column(String(128))      # provider/network
    plan_name: Mapped[str | None] = mapped_column(String(255))    # package name
    sim_number: Mapped[str | None] = mapped_column(String(64))    # ICCID
    monthly_cost: Mapped[float | None] = mapped_column(Numeric(12, 2))
    data_allowance: Mapped[str | None] = mapped_column(String(64))  # e.g. "20 GB"
    # available | assigned | suspended | cancelled
    status: Mapped[str] = mapped_column(String(16), default="available", index=True)

    assigned_to_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), index=True, nullable=True
    )
    company_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("companies.id", ondelete="SET NULL"), index=True, nullable=True
    )
    contract_start: Mapped[date | None] = mapped_column(Date)
    contract_end: Mapped[date | None] = mapped_column(Date)
    notes: Mapped[str | None] = mapped_column(Text)

    assigned_to: Mapped["object"] = relationship("User")
    events: Mapped[list["PhoneLineEvent"]] = relationship(
        back_populates="line",
        cascade="all, delete-orphan",
        order_by="PhoneLineEvent.created_at.desc()",
    )
    bills: Mapped[list["PhoneBill"]] = relationship(
        back_populates="line",
        cascade="all, delete-orphan",
        order_by="PhoneBill.period.desc()",
    )


class PhoneLineEvent(UUIDMixin, TimestampMixin, Base):
    """An entry in a line's history (assignment, status change, plan change…)."""

    __tablename__ = "phone_line_events"

    line_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("phone_lines.id", ondelete="CASCADE"), index=True
    )
    # assigned | unassigned | suspended | reactivated | plan_changed | cancelled | note
    event_type: Mapped[str] = mapped_column(String(24))
    # The employee involved (for assignments).
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    note: Mapped[str | None] = mapped_column(Text)
    performed_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    line: Mapped["PhoneLine"] = relationship(back_populates="events")


class PhoneBill(UUIDMixin, TimestampMixin, Base):
    """A monthly bill / charge recorded against a line."""

    __tablename__ = "phone_bills"

    line_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("phone_lines.id", ondelete="CASCADE"), index=True
    )
    period: Mapped[str] = mapped_column(String(7))  # "YYYY-MM"
    amount: Mapped[float | None] = mapped_column(Numeric(12, 2))
    data_used: Mapped[str | None] = mapped_column(String(64))
    # unpaid | paid
    status: Mapped[str] = mapped_column(String(12), default="unpaid")
    note: Mapped[str | None] = mapped_column(Text)

    line: Mapped["PhoneLine"] = relationship(back_populates="bills")
