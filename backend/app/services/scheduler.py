"""A tiny in-process background scheduler.

Runs asset alerts (warranty + maintenance) and service-desk SLA breach checks
periodically so people are notified without anyone hitting an endpoint. Enabled
via settings.RUN_SCHEDULER (off in tests). For multi-replica deployments,
prefer an external cron hitting the manual endpoints instead.
"""
import asyncio
import logging

from app.core.database import AsyncSessionLocal
from app.services.asset_alerts import run_asset_alerts
from app.services.sla_alerts import run_sla_alerts

log = logging.getLogger("scheduler")

# Asset alerts change slowly; SLA breaches need a tighter cadence.
ASSET_INTERVAL_SECONDS = 12 * 60 * 60
SLA_INTERVAL_SECONDS = 30 * 60


async def _periodic(name: str, runner, interval: int, warmup: int) -> None:
    await asyncio.sleep(warmup)
    while True:
        try:
            async with AsyncSessionLocal() as db:
                result = await runner(db)
            if result.get("created"):
                log.info("%s: created %s notification(s)", name, result["created"])
        except Exception as e:  # noqa: BLE001 — never let the loop die
            log.warning("%s run failed: %s", name, e)
        await asyncio.sleep(interval)


def start_scheduler(app) -> None:
    @app.on_event("startup")
    async def _start() -> None:  # pragma: no cover - timing-dependent
        app.state.scheduler_tasks = [
            asyncio.create_task(_periodic("asset alerts", run_asset_alerts, ASSET_INTERVAL_SECONDS, 15)),
            asyncio.create_task(_periodic("sla alerts", run_sla_alerts, SLA_INTERVAL_SECONDS, 45)),
        ]
