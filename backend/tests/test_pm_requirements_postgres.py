"""Migration and locking contracts on a disposable local PostgreSQL schema."""
import asyncio
import os
from pathlib import Path
import subprocess
import sys
import uuid

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine, select, text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api import pm_requirements as api
from app.core.database import Base
from app.models.pm import PmIssue, PmProject
from app.models.pm_requirement import PmRequirement, PmRequirementIssueLink
from app.models.user import User
from app.schemas.pm_requirement import RequirementContent, RequirementLinkInput, RequirementUpdate

pytestmark = pytest.mark.skipif(not os.environ.get("PM_TEST_DATABASE_URL"), reason="Requires disposable local PostgreSQL")


def local_url():
    url = make_url(os.environ["PM_TEST_DATABASE_URL"])
    assert url.drivername == "postgresql+psycopg" and url.host in {"localhost", "127.0.0.1"} and url.database == "pm_regression_test"
    return url


def test_requirement_migration_preserves_existing_records_and_round_trips():
    url = local_url()
    schema = f"requirements_migration_{uuid.uuid4().hex}"
    engine = create_engine(url)
    env = {**os.environ, "DATABASE_URL": url.render_as_string(hide_password=False), "PGOPTIONS": f"-csearch_path={schema}"}

    def migrate(*args):
        result = subprocess.run([sys.executable, "-m", "alembic", *args], cwd=Path(__file__).resolve().parents[1],
                                env=env, text=True, capture_output=True, timeout=90)
        assert result.returncode == 0, result.stdout + result.stderr

    try:
        with engine.begin() as db:
            db.execute(text(f'CREATE SCHEMA "{schema}"'))
        migrate("upgrade", "a3e4f5a6b7c8")
        pid, iid = uuid.uuid4(), uuid.uuid4()
        with engine.begin() as db:
            db.execute(text(f'SET search_path TO "{schema}"'))
            db.execute(text("INSERT INTO pm_projects (id,key,name) VALUES (:id,'OLD','Existing project')"), {"id": pid})
            db.execute(text("INSERT INTO pm_issues (id,project_id,number,summary) VALUES (:id,:pid,1,'Existing task')"), {"id": iid, "pid": pid})
        for _ in range(2):
            migrate("upgrade", "head")
            with engine.begin() as db:
                db.execute(text(f'SET search_path TO "{schema}"'))
                assert db.scalar(text("SELECT requirement_seq FROM pm_projects WHERE id=:id"), {"id": pid}) == 0
                assert db.scalar(text("SELECT count(*) FROM pm_requirements")) == 0
                assert db.scalar(text("SELECT summary FROM pm_issues WHERE id=:id"), {"id": iid}) == "Existing task"
            migrate("downgrade", "a3e4f5a6b7c8")
            with engine.begin() as db:
                assert db.scalar(text("SELECT to_regclass(:name)"), {"name": f"{schema}.pm_requirements"}) is None
        migrate("upgrade", "head")
    finally:
        with engine.begin() as db:
            db.execute(text(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE'))
        engine.dispose()


def test_concurrent_requirement_numbers_links_and_stale_content_are_serialized():
    async def scenario():
        engine = create_async_engine(local_url())
        schema = f"requirements_race_{uuid.uuid4().hex}"
        scoped = engine.execution_options(schema_translate_map={None: schema})
        sessions = async_sessionmaker(scoped, expire_on_commit=False)
        try:
            async with engine.begin() as db:
                await db.execute(text(f'CREATE SCHEMA "{schema}"'))
            async with scoped.begin() as db:
                await db.run_sync(Base.metadata.create_all)
            async with sessions() as db:
                user = User(email="requirements@example.test", display_name="Author", is_admin=True, status="active")
                db.add(user); await db.flush()
                project = PmProject(key="RACE", name="Concurrent requirements", created_by_id=user.id)
                db.add(project); await db.flush()
                issue = PmIssue(project_id=project.id, number=1, summary="Implement")
                db.add(issue); await db.commit()
                uid, pid, iid = user.id, project.id, issue.id

            async def create():
                async with sessions() as db:
                    return await api.create_requirement(pid, RequirementContent(title="Request"), db, await db.get(User, uid))

            rows = await asyncio.gather(create(), create())
            assert {row["key"] for row in rows} == {"RACE-REQ-1", "RACE-REQ-2"}
            rid = rows[0]["id"]

            async def link():
                async with sessions() as db:
                    return await api.add_link(rid, "issues", RequirementLinkInput(target_id=iid), db, await db.get(User, uid))

            await asyncio.gather(link(), link())
            async with sessions() as db:
                row = await db.get(PmRequirement, rid)
                version = row.version
                links = (await db.scalars(select(PmRequirementIssueLink).where(PmRequirementIssueLink.requirement_id == rid))).all()
                assert len(links) == 1 and version == 2

            async def update(title):
                async with sessions() as db:
                    try:
                        return await api.update_requirement(rid, RequirementUpdate(title=title, version=version), db, await db.get(User, uid))
                    except HTTPException as exc:
                        await db.rollback()
                        return exc.status_code

            results = await asyncio.gather(update("First edit"), update("Second edit"))
            assert sum(isinstance(result, dict) for result in results) == 1 and 409 in results
        finally:
            async with engine.begin() as db:
                await db.execute(text(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE'))
            await engine.dispose()

    with asyncio.Runner(loop_factory=asyncio.SelectorEventLoop) as runner:
        runner.run(scenario())
