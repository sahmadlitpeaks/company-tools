"""Benefits administration — plans, employee enrollments and dependents.

HR defines ``BenefitPlan`` records (health, dental, life, …) with employee /
employer monthly costs. Employees are enrolled via ``BenefitEnrollment`` at a
coverage level; the elected employee cost can flow into payroll as a deduction.
``Dependent`` records capture family members covered under a plan.
"""
import uuid
from datetime import date

from sqlalchemy import Boolean, Date, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.base import TimestampMixin, UUIDMixin

BENEFIT_CATEGORIES = {
    "health",
    "dental",
    "vision",
    "life",
    "disability",
    "retirement",
    "wellness",
    "other",
}
ENROLLMENT_STATUSES = {"pending", "enrolled", "waived", "terminated"}
COVERAGE_LEVELS = {"employee", "employee_spouse", "employee_children", "family"}
DEPENDENT_RELATIONSHIPS = {"spouse", "child", "domestic_partner", "other"}


class BenefitPlan(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "benefit_plans"

    name: Mapped[str] = mapped_column(String(160), index=True)
    category: Mapped[str] = mapped_column(String(24), default="health", index=True)
    carrier: Mapped[str | None] = mapped_column(String(160))
    description: Mapped[str | None] = mapped_column(Text)
    currency: Mapped[str] = mapped_column(String(8), default="USD")
    # Monthly cost shares.
    employee_cost: Mapped[float] = mapped_column(Numeric(12, 2), default=0)
    employer_cost: Mapped[float] = mapped_column(Numeric(12, 2), default=0)
    active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    enrollment_open: Mapped[bool] = mapped_column(Boolean, default=True)
    sort: Mapped[int] = mapped_column(Integer, default=0)

    enrollments: Mapped[list["BenefitEnrollment"]] = relationship(
        back_populates="plan", cascade="all, delete-orphan"
    )


class BenefitEnrollment(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "benefit_enrollments"

    plan_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("benefit_plans.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    status: Mapped[str] = mapped_column(String(16), default="enrolled", index=True)
    coverage_level: Mapped[str] = mapped_column(String(24), default="employee")
    # The employee monthly cost at election time (defaults to the plan's).
    elected_cost: Mapped[float] = mapped_column(Numeric(12, 2), default=0)
    effective_date: Mapped[date] = mapped_column(Date, default=date.today)
    end_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    note: Mapped[str | None] = mapped_column(Text)

    plan: Mapped["BenefitPlan"] = relationship(back_populates="enrollments")


class Dependent(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "dependents"

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(160))
    relationship_type: Mapped[str] = mapped_column(String(24), default="child")
    date_of_birth: Mapped[date | None] = mapped_column(Date, nullable=True)
