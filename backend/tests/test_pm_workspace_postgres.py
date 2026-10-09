"""Opt-in migration round trip on a disposable local PostgreSQL database."""
import os
import asyncio
from pathlib import Path
import subprocess
import sys
import uuid

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api import pm
from app.core.database import Base
from app.models.pm import PmComment, PmIssue, PmProject, PmProjectMember
from app.models.user import User
from app.schemas.pm import PmCommentIn
from fastapi import HTTPException
from sqlalchemy import func, select


@pytest.mark.skipif(not os.environ.get("PM_WORKSPACE_TEST_DATABASE_URL"), reason="Requires disposable PostgreSQL")
def test_workspace_migration_backfills_legacy_and_round_trips():
    url = make_url(os.environ["PM_WORKSPACE_TEST_DATABASE_URL"])
    assert url.drivername == "postgresql+psycopg"
    assert url.host in {"localhost", "127.0.0.1", "host.docker.internal"}
    assert url.database == "pm_regression_test"
    schema = f"workspace_{uuid.uuid4().hex}"
    engine = create_engine(url)
    backend = Path(__file__).resolve().parents[1]
    env = {**os.environ, "DATABASE_URL": url.render_as_string(hide_password=False), "PGOPTIONS": f"-csearch_path={schema}"}

    def migrate(*args):
        result = subprocess.run([sys.executable, "-m", "alembic", *args], cwd=backend, env=env,
                                text=True, capture_output=True, timeout=90)
        assert result.returncode == 0, result.stdout + result.stderr

    try:
        with engine.begin() as db:
            db.execute(text(f'CREATE SCHEMA "{schema}"'))
        # A complete fresh installation up to the previous production revision.
        migrate("upgrade", "x0b1c2d3e4f5")
        user_id, scrum_id, kanban_id, issue_id = [uuid.uuid4() for _ in range(4)]
        with engine.begin() as db:
            db.execute(text(f'SET search_path TO "{schema}"'))
            db.execute(text("INSERT INTO users (id,email,display_name,is_admin,is_active,role,status,must_change_password,mfa_enabled) VALUES (:id,'migration@example.test','Migration admin',true,true,'admin','active',false,false)"), {"id": user_id})
            for pid, key, enabled in ((scrum_id, "SCRUM", True), (kanban_id, "KANBAN", False)):
                db.execute(text("INSERT INTO pm_projects (id,key,name,lead_id,created_by_id,sprints_enabled) VALUES (:id,:key,:key,:uid,:uid,:enabled)"), {"id": pid, "key": key, "uid": user_id, "enabled": enabled})
            db.execute(text("INSERT INTO pm_issues (id,project_id,number,summary,status) VALUES (:id,:pid,1,'Legacy review','in_review')"), {"id": issue_id, "pid": scrum_id})
        migrate("upgrade", "head")
        with engine.begin() as db:
            db.execute(text(f'SET search_path TO "{schema}"'))
            assert db.scalar(text("SELECT workflow_state FROM pm_issues WHERE id=:id"), {"id": issue_id}) == "in_review"
            boards = dict(db.execute(text("SELECT project_id,settings->>'board_type' FROM pm_views")).all())
            assert boards == {scrum_id: "scrum", kanban_id: "kanban"}
            assert db.scalar(text("SELECT version_num FROM alembic_version")) == "y1c2d3e4f5a6"
        migrate("downgrade", "x0b1c2d3e4f5")
        with engine.begin() as db:
            db.execute(text(f'SET search_path TO "{schema}"'))
            assert db.scalar(text("SELECT summary FROM pm_issues WHERE id=:id"), {"id": issue_id}) == "Legacy review"
            assert db.scalar(text("SELECT to_regclass('pm_views')")) is None
        migrate("upgrade", "head")
        with engine.begin() as db:
            db.execute(text(f'SET search_path TO "{schema}"'))
            assert db.scalar(text("SELECT count(*) FROM pm_views")) == 2
    finally:
        with engine.begin() as db:
            db.execute(text(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE'))
        engine.dispose()


@pytest.mark.skipif(not os.environ.get("PM_WORKSPACE_TEST_DATABASE_URL"), reason="Requires disposable PostgreSQL")
def test_comment_waits_for_archive_and_rechecks_writability(monkeypatch):
    url = make_url(os.environ["PM_WORKSPACE_TEST_DATABASE_URL"])
    assert url.drivername == "postgresql+psycopg"
    assert url.host in {"localhost", "127.0.0.1", "host.docker.internal"}
    assert url.database == "pm_regression_test"

    async def scenario():
        engine = create_async_engine(url)
        schema = f"workspace_lock_{uuid.uuid4().hex}"
        scoped = engine.execution_options(schema_translate_map={None: schema})
        sessions = async_sessionmaker(scoped, expire_on_commit=False)
        dispatched = asyncio.Event()
        original = pm.require_project

        async def observe_access(*args, **kwargs):
            if asyncio.current_task().get_name() == "comment writer":
                dispatched.set()
            return await original(*args, **kwargs)

        monkeypatch.setattr(pm, "require_project", observe_access)
        try:
            async with engine.begin() as db:
                await db.execute(text(f'CREATE SCHEMA "{schema}"'))
            async with scoped.begin() as db:
                await db.run_sync(Base.metadata.create_all)
            async with sessions() as db:
                admin = User(email="admin@example.test", status="active", is_admin=True)
                viewer = User(email="viewer@example.test", status="active")
                db.add_all([admin, viewer])
                await db.flush()
                project = PmProject(key="RACE", name="Archive race", lead_id=admin.id)
                db.add(project)
                await db.flush()
                db.add_all([PmProjectMember(project_id=project.id, user_id=admin.id, role="admin"),
                            PmProjectMember(project_id=project.id, user_id=viewer.id, role="viewer")])
                issue = PmIssue(project_id=project.id, number=1, summary="Keep archived content read-only", status="todo")
                db.add(issue)
                await db.commit()
                project_id, issue_id = project.id, issue.id
            async with sessions() as archiving:
                locked = await archiving.scalar(select(PmProject).where(PmProject.id == project_id).with_for_update())
                locked.status = "archived"
                await archiving.flush()
                archive_pid = await archiving.scalar(text("SELECT pg_backend_pid()"))
                writer_pid = None

                async def comment():
                    nonlocal writer_pid
                    async with sessions() as db:
                        writer_pid = await db.scalar(text("SELECT pg_backend_pid()"))
                        try:
                            await pm.add_comment(issue_id, PmCommentIn(body="Too late"), db, viewer)
                            return "written"
                        except HTTPException as exc:
                            await db.rollback()
                            return exc.status_code

                writer = asyncio.create_task(comment(), name="comment writer")
                await asyncio.wait_for(dispatched.wait(), 10)

                async def wait_for_block():
                    async with sessions() as db:
                        while not writer.done():
                            blockers = await db.scalar(text("SELECT pg_blocking_pids(:pid)"), {"pid": writer_pid})
                            if archive_pid in blockers:
                                return True
                            await asyncio.sleep(0.01)
                        return False

                blocked = await asyncio.wait_for(wait_for_block(), 10)
                await archiving.commit()
                assert await asyncio.wait_for(writer, 10) == 409
                assert blocked, "The comment must wait for the project transaction."
            async with sessions() as db:
                assert await db.scalar(select(func.count()).select_from(PmComment)) == 0
        finally:
            async with engine.begin() as db:
                await db.execute(text(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE'))
            await engine.dispose()

    if sys.platform == "win32":
        with asyncio.Runner(loop_factory=asyncio.SelectorEventLoop) as runner:
            runner.run(scenario())
    else:
        asyncio.run(scenario())
