"""A tiny in-process background scheduler.

Runs asset alerts (warranty + maintenance), service-desk SLA breach checks and
HR people reminders periodically so notifications fire without anyone hitting an
endpoint. Enabled via settings.RUN_SCHEDULER (off in tests). For multi-replica
deployments, prefer an external cron hitting the manual endpoints instead.
"""
import asyncio
import logging
from collections.abc import Coroutine
from typing import Any

from app.core.database import AsyncSessionLocal
from app.services.asset_alerts import run_asset_alerts
from app.services.checklist_runs import run_checklist_generation, run_missed_alerts
from app.services.hr_reminders import run_hr_reminders
from app.services.sla_alerts import run_sla_alerts
from app.services.time_reminders import run_time_reminders
from app.services.backups import run_scheduled_backup

log = logging.getLogger("scheduler")

# Asset alerts change slowly; SLA breaches need a tighter cadence.
ASSET_INTERVAL_SECONDS = 12 * 60 * 60
SLA_INTERVAL_SECONDS = 30 * 60
# HR reminders are date-based (expiries, birthdays, deadlines); twice a day is
# plenty and dedup keys keep re-runs from spamming.
HR_INTERVAL_SECONDS = 12 * 60 * 60
# Checklist runs are generated hourly: generation is idempotent (unique on
# template + run_date), so an hourly tick simply picks up templates that became
# due, including after a restart.
CHECKLIST_INTERVAL_SECONDS = 60 * 60
# Late-run nags check a little less often; dedup keys stop repeats.
CHECKLIST_LATE_INTERVAL_SECONDS = 2 * 60 * 60
TIME_INTERVAL_SECONDS = 12 * 60 * 60
BACKUP_INTERVAL_SECONDS = 60 * 60


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


def start_scheduler() -> list[asyncio.Task[Any]]:
    """Start the in-process jobs and return handles for lifespan cleanup."""
    jobs: list[Coroutine[Any, Any, None]] = [
        _periodic("asset alerts", run_asset_alerts, ASSET_INTERVAL_SECONDS, 15),
        _periodic("sla alerts", run_sla_alerts, SLA_INTERVAL_SECONDS, 45),
        _periodic("hr reminders", run_hr_reminders, HR_INTERVAL_SECONDS, 60),
        _periodic(
            "checklist runs",
            run_checklist_generation,
            CHECKLIST_INTERVAL_SECONDS,
            20,
        ),
        _periodic(
            "checklist late alerts",
            run_missed_alerts,
            CHECKLIST_LATE_INTERVAL_SECONDS,
            90,
        ),
        _periodic("time reminders", run_time_reminders, TIME_INTERVAL_SECONDS, 90),
        _periodic("backups", run_scheduled_backup, BACKUP_INTERVAL_SECONDS, 120),
    ]
    return [asyncio.create_task(job) for job in jobs]
