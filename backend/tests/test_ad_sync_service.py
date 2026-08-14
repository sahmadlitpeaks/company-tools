from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy import select

from app.core.database import AsyncSessionLocal
from app.models.campaign import Campaign, CampaignMetric
from app.services.ad_sync.base import NormalizedMetric
from app.services.ad_sync.service import sync_provider
from app.services.app_settings import set_many


def row(day, spend="100.00", conversions=10, channel="facebook", currency="USD"):
    return NormalizedMetric(
        external_campaign_id="111",
        campaign_name="Summer Sale",
        campaign_status="active",
        channel=channel,
        date=day,
        spend=Decimal(spend),
        impressions=5000,
        clicks=250,
        conversions=conversions,
        revenue=Decimal("900.00"),
        currency=currency,
    )


class FakeProvider:
    """Stands in for a platform client; the orchestrator is what's under test."""

    key = "meta"

    def __init__(self, rows, error=None):
        self.rows = rows
        self.error = error

    async def fetch(self, cfg, since, until):
        if self.error:
            raise RuntimeError(self.error)
        return self.rows

    async def verify(self, cfg):
        return {"ok": True}


async def _configure(db):
    """Only the FX rate. Credentials go through set_integration so the secret is
    encrypted the same way production stores it."""
    await set_many(db, {"fx_rate_USD": "3.6725"})


async def _seed_token(db):
    from app.services.app_settings import set_integration

    await set_integration(
        db, "facebook", {"ad_account_id": "act_1", "access_token": "tok"}
    )


@pytest.mark.asyncio
async def test_sync_creates_campaign_and_converts_to_aed(client):
    async with AsyncSessionLocal() as db:
        await _configure(db)
        await _seed_token(db)
        result = await sync_provider(
            db, "meta", FakeProvider([row(date(2026, 8, 1))]), since=date(2026, 8, 1)
        )
        assert result["ok"] is True
        campaign = (await db.execute(select(Campaign))).scalars().one()
        assert campaign.provider == "meta"
        assert campaign.external_id == "111"
        metric = (await db.execute(select(CampaignMetric))).scalars().one()
        assert metric.source == "sync"
        assert Decimal(metric.spend) == Decimal("367.25")   # 100 USD * 3.6725
        assert Decimal(metric.spend_original) == Decimal("100.00")
        assert metric.currency == "USD"


@pytest.mark.asyncio
async def test_running_twice_does_not_double_count(client):
    """The single most important guarantee: re-running is idempotent."""
    async with AsyncSessionLocal() as db:
        await _configure(db)
        await _seed_token(db)
        rows = [row(date(2026, 8, 1))]
        await sync_provider(db, "meta", FakeProvider(rows), since=date(2026, 8, 1))
        await sync_provider(db, "meta", FakeProvider(rows), since=date(2026, 8, 1))
        metrics = (await db.execute(select(CampaignMetric))).scalars().all()
        assert len(metrics) == 1
        assert Decimal(metrics[0].spend) == Decimal("367.25")
        campaigns = (await db.execute(select(Campaign))).scalars().all()
        assert len(campaigns) == 1


@pytest.mark.asyncio
async def test_restated_conversions_update_in_place(client):
    """Platforms revise history for weeks; the row must move, not duplicate."""
    async with AsyncSessionLocal() as db:
        await _configure(db)
        await _seed_token(db)
        await sync_provider(
            db, "meta", FakeProvider([row(date(2026, 8, 1), conversions=10)]),
            since=date(2026, 8, 1),
        )
        await sync_provider(
            db, "meta", FakeProvider([row(date(2026, 8, 1), conversions=17)]),
            since=date(2026, 8, 1),
        )
        metric = (await db.execute(select(CampaignMetric))).scalars().one()
        assert metric.conversions == 17


@pytest.mark.asyncio
async def test_manual_rows_are_never_touched(client):
    async with AsyncSessionLocal() as db:
        await _configure(db)
        await _seed_token(db)
        await sync_provider(
            db, "meta", FakeProvider([row(date(2026, 8, 1))]), since=date(2026, 8, 1)
        )
        campaign = (await db.execute(select(Campaign))).scalars().one()
        db.add(
            CampaignMetric(
                campaign_id=campaign.id, channel="facebook", date=date(2026, 8, 1),
                spend=Decimal("5.00"), source="manual",
            )
        )
        await db.commit()
        await sync_provider(
            db, "meta", FakeProvider([row(date(2026, 8, 1))]), since=date(2026, 8, 1)
        )
        manual = (
            await db.execute(
                select(CampaignMetric).where(CampaignMetric.source == "manual")
            )
        ).scalars().all()
        assert len(manual) == 1
        assert Decimal(manual[0].spend) == Decimal("5.00")


@pytest.mark.asyncio
async def test_missing_fx_rate_fails_the_run_and_writes_nothing(client):
    async with AsyncSessionLocal() as db:
        await _seed_token(db)  # no fx_rate_EUR configured
        result = await sync_provider(
            db,
            "meta",
            FakeProvider([row(date(2026, 8, 1), currency="EUR")]),
            since=date(2026, 8, 1),
        )
        assert result["ok"] is False
        assert "EUR" in result["error"]
        assert (await db.execute(select(CampaignMetric))).scalars().all() == []
        # A rolled-back run must not report rows it never committed.
        assert result["metrics_upserted"] == 0


@pytest.mark.asyncio
async def test_provider_error_is_recorded_not_raised(client):
    async with AsyncSessionLocal() as db:
        await _configure(db)
        await _seed_token(db)
        result = await sync_provider(
            db, "meta", FakeProvider([], error="Invalid OAuth access token"),
            since=date(2026, 8, 1),
        )
        assert result["ok"] is False
        assert "Invalid OAuth" in result["error"]


@pytest.mark.asyncio
async def test_unconfigured_provider_is_skipped(client):
    async with AsyncSessionLocal() as db:
        result = await sync_provider(
            db, "meta", FakeProvider([row(date(2026, 8, 1))]), since=date(2026, 8, 1)
        )
        assert result["ok"] is False
        assert result["skipped"] is True
