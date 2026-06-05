"""A tiny in-process background scheduler.

Runs asset alerts (warranty + maintenance) periodically so admins are notified
without anyone hitting an endpoint. Enabled via settings.RUN_SCHEDULER (off in
tests). For multi-replica deployments, prefer an external cron hitting the
manual endpoint instead.
"""
import asyncio
import logging

from app.core.database import AsyncSessionLocal
from app.services.asset_alerts import run_asset_alerts

log = logging.getLogger("scheduler")

# Run a few seconds after boot, then on this cadence.
INTERVAL_SECONDS = 12 * 60 * 60


async def _loop() -> None:
    await asyncio.sleep(15)
    while True:
        try:
            async with AsyncSessionLocal() as db:
                result = await run_asset_alerts(db)
            if result["created"]:
                log.info("asset alerts: created %s notification(s)", result["created"])
        except Exception as e:  # noqa: BLE001 — never let the loop die
            log.warning("asset alert run failed: %s", e)
        await asyncio.sleep(INTERVAL_SECONDS)


def start_scheduler(app) -> None:
    @app.on_event("startup")
    async def _start() -> None:  # pragma: no cover - timing-dependent
        app.state.scheduler_task = asyncio.create_task(_loop())
