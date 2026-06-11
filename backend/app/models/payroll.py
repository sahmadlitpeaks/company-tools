"""Payroll inputs & payslips.

A monthly ``PayrollRun`` fans out into one ``Payslip`` per active employee,
seeded from their latest salary ``CompensationRecord``. Payslips carry
adjustable earning/deduction line items and computed gross/net totals.
"""
import uuid

from sqlalchemy import JSON, ForeignKey, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.base import TimestampMixin, UUIDMixin

RUN_STATUSES = {"draft", "finalized"}


class PayrollRun(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "payroll_runs"

    period: Mapped[str] = mapped_column(String(7), index=True)  # "YYYY-MM"
    status: Mapped[str] = mapped_column(String(16), default="draft", index=True)
    note: Mapped[str | None] = mapped_column(Text)
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    payslips: Mapped[list["Payslip"]] = relationship(
        back_populates="run", cascade="all, delete-orphan"
    )

    __table_args__ = (UniqueConstraint("period", name="uq_payroll_period"),)


class Payslip(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "payslips"

    run_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("payroll_runs.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    currency: Mapped[str] = mapped_column(String(8), default="USD")
    base_salary: Mapped[float] = mapped_column(Numeric(12, 2), default=0)
    # [{"label": str, "amount": number, "kind": "earning" | "deduction"}]
    items: Mapped[list | None] = mapped_column(JSON)
    gross: Mapped[float] = mapped_column(Numeric(12, 2), default=0)
    deductions: Mapped[float] = mapped_column(Numeric(12, 2), default=0)
    net: Mapped[float] = mapped_column(Numeric(12, 2), default=0)

    run: Mapped["PayrollRun"] = relationship(back_populates="payslips")

    __table_args__ = (UniqueConstraint("run_id", "user_id", name="uq_payslip_user"),)
