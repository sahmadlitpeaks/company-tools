"""Opt-in PostgreSQL regression for freezing legacy burndown on upgrade."""
import importlib.util
import os
import uuid
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import create_engine, inspect, select, text
from sqlalchemy.engine import make_url

from app.core.database import Base
from app.models.pm import PmIssue, PmIssueHistory, PmProject, PmSprint


@pytest.mark.skipif(not os.environ.get("PM_TEST_DATABASE_URL"), reason="Requires disposable local PostgreSQL")
def test_snapshot_upgrade_backfills_legacy_spillover_and_downgrades(monkeypatch):
    url = make_url(os.environ["PM_TEST_DATABASE_URL"])
    assert url.drivername == "postgresql+psycopg"
    assert url.host in {"localhost", "127.0.0.1"}
    assert url.database == "pm_regression_test"
    engine = create_engine(url)
    schema = f"pm_migration_{uuid.uuid4().hex}"
    path = Path(__file__).resolve().parents[1] / "alembic/versions/x0b1c2d3e4f5_pm_burndown_snapshot.py"
    spec = importlib.util.spec_from_file_location("review_snapshot_migration", path)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    try:
        with engine.begin() as db:
            db.execute(text(f'CREATE SCHEMA "{schema}"'))
            db.execute(text(f'SET LOCAL search_path TO "{schema}"'))
            Base.metadata.create_all(db)
            monkeypatch.setattr(migration, "op", Operations(MigrationContext.configure(db)))
            migration.downgrade()
            pid, sid, done_id, spillover_id = [uuid.uuid4() for _ in range(4)]
            today, now = date.today(), datetime.now(timezone.utc)
            db.execute(PmProject.__table__.insert().values(id=pid, key="OLD", name="Legacy project"))
            db.execute(PmSprint.__table__.insert().values(id=sid, project_id=pid, name="Old sprint", status="closed",
                       start_date=today - timedelta(days=3), end_date=today + timedelta(days=7),
                       started_at=now - timedelta(days=3), completed_at=now, committed_points=8, completed_points=5))
            db.execute(PmIssue.__table__.insert().values(id=done_id, project_id=pid, number=1, summary="Finished",
                       sprint_id=sid, status="done", story_points=5, resolved_at=now))
            db.execute(PmIssue.__table__.insert().values(id=spillover_id, project_id=pid, number=2, summary="Spillover",
                       status="todo", story_points=3))
            db.execute(PmIssueHistory.__table__.insert().values(id=uuid.uuid4(), issue_id=spillover_id,
                       field="sprint", old_value="Old sprint", new_value=None, created_at=now))
            migration.upgrade()
            snapshot = db.scalar(select(PmSprint.__table__.c.burndown_snapshot).where(PmSprint.__table__.c.id == sid))
            assert snapshot["total_points"] == 8
            assert snapshot["sprint"]["status"] == "closed"
            assert next(day for day in snapshot["days"] if day["date"] == str(today))["remaining"] == 3
            db.execute(PmIssue.__table__.update().where(PmIssue.__table__.c.id == done_id).values(status="todo", story_points=99))
            assert db.scalar(select(PmSprint.__table__.c.burndown_snapshot).where(PmSprint.__table__.c.id == sid)) == snapshot
            migration.downgrade()
            assert "burndown_snapshot" not in {column["name"] for column in inspect(db).get_columns("pm_sprints", schema=schema)}
            migration.upgrade()
            assert db.scalar(select(PmSprint.__table__.c.burndown_snapshot).where(PmSprint.__table__.c.id == sid)) is not None
    finally:
        with engine.begin() as db:
            db.execute(text(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE'))
        engine.dispose()
