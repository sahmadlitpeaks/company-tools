import uuid
from datetime import date

from sqlalchemy import BigInteger, Date, ForeignKey, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.base import TimestampMixin, UUIDMixin


class Campaign(UUIDMixin, TimestampMixin, Base):
    """A marketing campaign that aggregates ad-channel performance metrics."""

    __tablename__ = "campaigns"

    company_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("companies.id", ondelete="SET NULL"), index=True, nullable=True
    )
    name: Mapped[str] = mapped_column(String(255))
    objective: Mapped[str | None] = mapped_column(String(255))
    status: Mapped[str] = mapped_column(String(16), default="active", index=True)
    start_date: Mapped[date | None] = mapped_column(Date)
    end_date: Mapped[date | None] = mapped_column(Date)
    notes: Mapped[str | None] = mapped_column(Text)
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    metrics: Mapped[list["CampaignMetric"]] = relationship(
        back_populates="campaign", cascade="all, delete-orphan"
    )


class CampaignMetric(UUIDMixin, TimestampMixin, Base):
    """One channel's performance for a given date within a campaign."""

    __tablename__ = "campaign_metrics"

    campaign_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("campaigns.id", ondelete="CASCADE"), index=True
    )
    # facebook | instagram | google | tiktok | other
    channel: Mapped[str] = mapped_column(String(32), index=True)
    date: Mapped[date | None] = mapped_column(Date)
    spend: Mapped[float] = mapped_column(Numeric(14, 2), default=0)
    impressions: Mapped[int] = mapped_column(BigInteger, default=0)
    clicks: Mapped[int] = mapped_column(BigInteger, default=0)
    conversions: Mapped[int] = mapped_column(BigInteger, default=0)
    revenue: Mapped[float] = mapped_column(Numeric(14, 2), default=0)

    campaign: Mapped["Campaign"] = relationship(back_populates="metrics")
