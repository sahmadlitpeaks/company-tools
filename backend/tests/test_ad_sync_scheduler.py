import pytest

from app.core.database import AsyncSessionLocal
from app.services.ad_sync.service import run_ad_sync


@pytest.mark.asyncio
async def test_run_ad_sync_matches_the_periodic_runner_contract(client):
    """_periodic reads result["created"]; a different shape breaks the loop."""
    async with AsyncSessionLocal() as db:
        result = await run_ad_sync(db)
    assert isinstance(result, dict)
    assert "created" in result
    assert result["created"] == 0  # nothing configured in a fresh test DB


def test_ad_sync_is_registered_in_the_scheduler():
    import app.services.scheduler as scheduler

    assert scheduler.AD_SYNC_INTERVAL_SECONDS == 24 * 60 * 60
    # The scheduler must call the real runner, not a stale copy of it.
    assert scheduler.run_ad_sync is run_ad_sync
