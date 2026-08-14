"""Orchestrates the pull: fetch, convert, upsert, record.

Providers stay ignorant of the database and of currency; everything that can
corrupt stored numbers is concentrated here so it can be tested in one place.

Two invariants matter most:
  * Re-running must not double-count. Rows are keyed on
    (campaign, channel, date) and updated in place.
  * Hand-entered data is untouchable. Only ``source='sync'`` rows are written.
"""
import logging
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.ad_sync import AdSyncRun
from app.models.campaign import Campaign, CampaignMetric
from app.services.ad_sync.base import NormalizedMetric
from app.services.ad_sync.fx import MissingRateError, convert, get_rates
from app.services.ad_sync.google_ads import GoogleAdsProvider
from app.services.ad_sync.meta import MetaProvider
from app.services.ad_sync.tiktok import TikTokProvider
from app.services.app_settings import get_integration

log = logging.getLogger("ad_sync")

# Ad platforms restate history: a conversion attributed to Monday can arrive
# days later and keeps changing for the length of the attribution window. So
# every run re-reads the recent past rather than appending to it.
ROLLING_DAYS = 30
BACKFILL_DAYS = 90

PROVIDERS = {
    "meta": MetaProvider(),
    "google_ads": GoogleAdsProvider(),
    "tiktok": TikTokProvider(),
}

# Which stored integration credentials feed each provider. Meta's ad metrics
# come from the "facebook" entry; the separate "instagram" entry cannot supply
# ad data and is not consulted.
CREDENTIAL_KEY = {
    "meta": "facebook",
    "google_ads": "google_ads",
    "tiktok": "tiktok",
}


async def _window_start(db: AsyncSession, key: str) -> date:
    """First run backfills; later runs re-read the rolling window."""
    previous = (
        await db.execute(
            select(AdSyncRun).where(AdSyncRun.provider == key, AdSyncRun.ok.is_(True))
        )
    ).scalars().first()
    days = ROLLING_DAYS if previous else BACKFILL_DAYS
    return date.today() - timedelta(days=days)


async def _upsert_campaign(
    db: AsyncSession, key: str, row: NormalizedMetric
) -> Campaign:
    campaign = (
        await db.execute(
            select(Campaign).where(
                Campaign.provider == key,
                Campaign.external_id == row.external_campaign_id,
            )
        )
    ).scalars().first()
    if campaign is None:
        campaign = Campaign(
            name=row.campaign_name,
            provider=key,
            external_id=row.external_campaign_id,
            status=row.campaign_status,
        )
        db.add(campaign)
        await db.flush()
    else:
        campaign.name = row.campaign_name
        campaign.status = row.campaign_status
    return campaign


async def _upsert_metric(
    db: AsyncSession, campaign: Campaign, row: NormalizedMetric, rates: dict
) -> None:
    spend_aed, rate = convert(row.spend, row.currency, rates)
    revenue_aed, _ = convert(row.revenue, row.currency, rates)

    existing = (
        await db.execute(
            select(CampaignMetric).where(
                CampaignMetric.campaign_id == campaign.id,
                CampaignMetric.channel == row.channel,
                CampaignMetric.date == row.date,
                CampaignMetric.source == "sync",
            )
        )
    ).scalars().first()

    target = existing or CampaignMetric(
        campaign_id=campaign.id,
        channel=row.channel,
        date=row.date,
        source="sync",
    )
    target.spend = spend_aed
    target.revenue = revenue_aed
    target.impressions = row.impressions
    target.clicks = row.clicks
    target.conversions = row.conversions
    target.currency = row.currency
    target.spend_original = row.spend
    target.revenue_original = row.revenue
    target.fx_rate = rate
    if existing is None:
        db.add(target)


async def sync_provider(
    db: AsyncSession, key: str, provider, since: date | None = None
) -> dict:
    """Sync one provider. Never raises — the outcome is the return value, so one
    platform failing cannot abort the others."""
    started = datetime.now(timezone.utc)
    result = {
        "provider": key,
        "ok": False,
        "skipped": False,
        "campaigns_synced": 0,
        "metrics_upserted": 0,
        "error": None,
    }

    integration = await get_integration(db, CREDENTIAL_KEY.get(key, key))
    if not integration or not integration["configured"]:
        result["skipped"] = True
        result["error"] = "Not configured"
        return result

    window_start = since or await _window_start(db, key)
    until = date.today()

    try:
        rows = await provider.fetch(integration["values"], window_start, until)
        rates = await get_rates(db)
        campaigns: dict[str, Campaign] = {}
        for row in rows:
            if not row.external_campaign_id:
                continue
            campaign = campaigns.get(row.external_campaign_id)
            if campaign is None:
                campaign = await _upsert_campaign(db, key, row)
                campaigns[row.external_campaign_id] = campaign
            await _upsert_metric(db, campaign, row, rates)
            result["metrics_upserted"] += 1
        result["campaigns_synced"] = len(campaigns)
        await db.commit()
        result["ok"] = True
    except MissingRateError as e:
        await db.rollback()
        # The rollback discarded every row, so the counters must not survive it
        # and claim work that was never committed.
        result["campaigns_synced"] = 0
        result["metrics_upserted"] = 0
        result["error"] = str(e)
    except Exception as e:  # noqa: BLE001 — recorded, never propagated
        await db.rollback()
        result["campaigns_synced"] = 0
        result["metrics_upserted"] = 0
        result["error"] = str(e)[:500]
        log.warning("ad sync %s failed: %s", key, e)

    db.add(
        AdSyncRun(
            provider=key,
            started_at=started,
            finished_at=datetime.now(timezone.utc),
            ok=result["ok"],
            campaigns_synced=result["campaigns_synced"],
            metrics_upserted=result["metrics_upserted"],
            error=result["error"],
        )
    )
    await db.commit()
    return result


async def sync_all(
    db: AsyncSession, providers: list[str] | None = None, since: date | None = None
) -> list[dict]:
    keys = providers or list(PROVIDERS)
    return [
        await sync_provider(db, key, PROVIDERS[key], since=since)
        for key in keys
        if key in PROVIDERS
    ]


async def run_ad_sync(db: AsyncSession) -> dict:
    """Scheduler entry point, matching the _periodic runner contract."""
    results = await sync_all(db)
    return {"created": sum(r["metrics_upserted"] for r in results)}
