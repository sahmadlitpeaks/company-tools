"""Offline overview benchmark. Creates only a disposable temporary SQLite DB."""
import asyncio
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import statistics
import sys
import tempfile
import time
import tracemalloc
import uuid

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ["DATABASE_URL"] = "sqlite+aiosqlite:///:memory:"
os.environ["RUN_SCHEDULER"] = "false"

from sqlalchemy import event, insert  # noqa: E402
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine  # noqa: E402
import app.models  # noqa: E402,F401
from app.api.analytics import overview  # noqa: E402
from app.core.database import Base  # noqa: E402
from app.models.card import CardScan  # noqa: E402
from app.models.shortlink import LinkClick  # noqa: E402


async def main():
    label = sys.argv[1] if len(sys.argv) > 1 else "baseline"
    size = int(os.environ.get("BENCHMARK_EVENTS", "50000"))
    with tempfile.TemporaryDirectory(prefix="company-tools-analytics-") as folder:
        engine = create_async_engine(f"sqlite+aiosqlite:///{Path(folder).as_posix()}/benchmark.db")
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
            now = datetime.now(timezone.utc)
            parent_id = uuid.uuid4()
            for model, key in [(LinkClick, "link_id"), (CardScan, "card_id")]:
                for offset in range(0, size, 5000):
                    await conn.execute(insert(model), [
                        {"id": uuid.uuid4(), key: parent_id, "created_at": now - timedelta(days=i % 14)}
                        for i in range(offset, min(offset + 5000, size))
                    ])
        queries = []

        def record(_conn, _cursor, statement, _parameters, _context, _many):
            if statement.lstrip().upper().startswith("SELECT"):
                queries.append(statement)

        event.listen(engine.sync_engine, "before_cursor_execute", record)
        factory = async_sessionmaker(engine)
        samples = []
        try:
            async with factory() as db:
                await overview(db, None)  # Warm imports and SQL compilation.
                for _ in range(7):
                    queries.clear()
                    tracemalloc.start()
                    start = time.perf_counter()
                    result = await overview(db, None)
                    elapsed = (time.perf_counter() - start) * 1000
                    _, peak = tracemalloc.get_traced_memory()
                    tracemalloc.stop()
                    samples.append({"ms": round(elapsed, 2), "selects": len(queries), "peakBytes": peak})
            output = {
                "label": label, "database": "disposable SQLite", "eventsPerTable": size,
                "runs": len(samples), "medianMs": statistics.median(s["ms"] for s in samples),
                "medianPeakBytes": statistics.median(s["peakBytes"] for s in samples),
                "selects": samples[0]["selects"], "seriesTotals": {
                    name: sum(day["count"] for day in values) for name, values in result["series"].items()
                }, "samples": samples,
            }
            destination = Path(__file__).resolve().parents[2] / "qa-out" / "performance" / f"analytics-{label}.json"
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_text(json.dumps(output, indent=2) + "\n", encoding="utf-8")
            print(json.dumps(output))
        finally:
            await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
