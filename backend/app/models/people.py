"""People-ops: structured onboarding & offboarding journeys with a checklist
of acknowledgeable steps (grant/revoke access, equipment, accounts, HR docs).
"""
import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.base import TimestampMixin, UUIDMixin


class OnboardingJourney(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "onboarding_journeys"

    # onboarding | offboarding
    kind: Mapped[str] = mapped_column(String(16), index=True)
    target_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), index=True, nullable=True
    )
    # in_progress | completed | cancelled
    status: Mapped[str] = mapped_column(String(16), default="in_progress", index=True)
    note: Mapped[str | None] = mapped_column(Text)
    # Sub-company / branch the person belongs to.
    company_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("companies.id", ondelete="SET NULL"), index=True, nullable=True
    )
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    tasks: Mapped[list["OnboardingTask"]] = relationship(
        back_populates="journey",
        cascade="all, delete-orphan",
        order_by="OnboardingTask.sort.asc()",
    )


class OnboardingTask(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "onboarding_tasks"

    journey_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("onboarding_journeys.id", ondelete="CASCADE"), index=True
    )
    title: Mapped[str] = mapped_column(String(512))
    # access | accounts | equipment | hr | other
    category: Mapped[str] = mapped_column(String(24), default="other")
    # pending | done | na
    status: Mapped[str] = mapped_column(String(16), default="pending", index=True)
    owner_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), index=True, nullable=True
    )
    done_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    done_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    sort: Mapped[int] = mapped_column(Integer, default=0)

    journey: Mapped["OnboardingJourney"] = relationship(back_populates="tasks")


class AccessGrant(UUIDMixin, TimestampMixin, Base):
    """An account/system access a person holds (Google, Facebook, ERP portal…).

    Granted during onboarding, surfaced and revoked during offboarding.
    """

    __tablename__ = "access_grants"

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    journey_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("onboarding_journeys.id", ondelete="SET NULL"), nullable=True
    )
    name: Mapped[str] = mapped_column(String(255))
    system: Mapped[str | None] = mapped_column(String(64))
    username: Mapped[str | None] = mapped_column(String(255))
    notes: Mapped[str | None] = mapped_column(Text)
    # active | revoked
    status: Mapped[str] = mapped_column(String(16), default="active", index=True)
    granted_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    revoked_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


# Built-in default checklists (used when a journey is created).
DEFAULT_ONBOARDING = [
    ("access", "Grant system access & set permissions"),
    ("accounts", "Create digital business card"),
    ("accounts", "Set up email signature"),
    ("equipment", "Assign laptop & equipment"),
    ("hr", "Collect signed contract & ID documents"),
    ("hr", "Add to payroll & benefits"),
    ("other", "Office tour & team introductions"),
]

DEFAULT_OFFBOARDING = [
    ("access", "Revoke system access & disable account"),
    ("access", "Disable email & external accounts"),
    ("equipment", "Collect laptop & equipment"),
    ("accounts", "Deactivate digital business card"),
    ("hr", "Handover of responsibilities"),
    ("hr", "Final settlement & exit interview"),
]
