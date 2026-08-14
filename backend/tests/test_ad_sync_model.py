"""The sync-row uniqueness guarantee, which is what makes re-running safe."""
from datetime import date

import pytest
from sqlalchemy.exc import IntegrityError

from app.core.database import AsyncSessionLocal
from app.models.campaign import Campaign, CampaignMetric


async def _campaign(db, **kw) -> Campaign:
    c = Campaign(name="C", **kw)
    db.add(c)
    await db.commit()
    await db.refresh(c)
    return c


@pytest.mark.asyncio
async def test_sync_rows_are_unique_per_campaign_channel_date(client):
    async with AsyncSessionLocal() as db:
        c = await _campaign(db, provider="meta", external_id="123")
        db.add(CampaignMetric(campaign_id=c.id, channel="facebook",
                              date=date(2026, 8, 1), source="sync"))
        await db.commit()
        db.add(CampaignMetric(campaign_id=c.id, channel="facebook",
                              date=date(2026, 8, 1), source="sync"))
        with pytest.raises(IntegrityError):
            await db.commit()


@pytest.mark.asyncio
async def test_manual_rows_may_repeat_channel_and_date(client):
    """The partial index must not restrict hand-entered rows."""
    async with AsyncSessionLocal() as db:
        c = await _campaign(db)
        for _ in range(2):
            db.add(CampaignMetric(campaign_id=c.id, channel="facebook",
                                  date=date(2026, 8, 1), source="manual"))
        await db.commit()  # must not raise


@pytest.mark.asyncio
async def test_provider_external_id_is_unique(client):
    async with AsyncSessionLocal() as db:
        await _campaign(db, provider="meta", external_id="dup")
        db.add(Campaign(name="other", provider="meta", external_id="dup"))
        with pytest.raises(IntegrityError):
            await db.commit()


@pytest.mark.asyncio
async def test_manual_campaigns_may_repeat_null_provider(client):
    async with AsyncSessionLocal() as db:
        await _campaign(db)
        await _campaign(db)  # must not raise
