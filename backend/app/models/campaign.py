import uuid
from datetime import date

from sqlalchemy import (
    BigInteger,
    Date,
    ForeignKey,
    Index,
    Numeric,
    String,
    Text,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.base import TimestampMixin, UUIDMixin


class Campaign(UUIDMixin, TimestampMixin, Base):
    """A marketing campaign that aggregates ad-channel performance metrics.

    Campaigns pulled from an ad platform carry ``provider`` + ``external_id``;
    hand-created ones leave both NULL. ``provider`` is the source platform and
    is deliberately coarser than a metric's ``channel``: one ``meta`` campaign
    yields both facebook and instagram rows via the publisher_platform
    breakdown.
    """

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
    # meta | google_ads | tiktok — NULL for manually created campaigns.
    provider: Mapped[str | None] = mapped_column(String(16), index=True)
    external_id: Mapped[str | None] = mapped_column(String(64))

    metrics: Mapped[list["CampaignMetric"]] = relationship(
        back_populates="campaign", cascade="all, delete-orphan"
    )

    __table_args__ = (
        Index(
            "uq_campaigns_provider_external",
            "provider",
            "external_id",
            unique=True,
            postgresql_where=text("provider IS NOT NULL"),
            sqlite_where=text("provider IS NOT NULL"),
        ),
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
    # manual | csv | sync — sync never touches the first two.
    source: Mapped[str] = mapped_column(
        String(8), default="manual", server_default="manual", nullable=False, index=True
    )
    # Currency reported by the platform, plus the pre-conversion figures and the
    # rate applied, so any AED value can be audited and recomputed.
    currency: Mapped[str | None] = mapped_column(String(3))
    spend_original: Mapped[float | None] = mapped_column(Numeric(14, 2))
    revenue_original: Mapped[float | None] = mapped_column(Numeric(14, 2))
    fx_rate: Mapped[float | None] = mapped_column(Numeric(18, 8))

    campaign: Mapped["Campaign"] = relationship(back_populates="metrics")

    __table_args__ = (
        # Partial on purpose: a blanket unique constraint would fail the
        # migration on existing duplicate manual rows and would break the
        # "Add row" form, which legitimately allows repeats.
        Index(
            "uq_campaign_metrics_sync_row",
            "campaign_id",
            "channel",
            "date",
            unique=True,
            postgresql_where=text("source = 'sync'"),
            sqlite_where=text("source = 'sync'"),
        ),
    )
