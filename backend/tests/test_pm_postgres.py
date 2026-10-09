"""Real PostgreSQL concurrency regressions; opt in with a disposable local DB."""
import asyncio
import os
import sys
import uuid

import pytest
from fastapi import HTTPException
from sqlalchemy import func, select, text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api import pm
from app.core.database import Base
from app.models.pm import PmProject, PmProjectMember
from app.models.user import User
from app.schemas.pm import PmMemberUpdate


@pytest.mark.skipif(not os.environ.get("PM_TEST_DATABASE_URL"), reason="Requires disposable local PostgreSQL")
@pytest.mark.parametrize("operations", [("demote", "demote"), ("remove", "remove"), ("demote", "remove")])
def test_concurrent_changes_preserve_one_project_administrator(monkeypatch, operations):
    url = make_url(os.environ["PM_TEST_DATABASE_URL"])
    assert url.drivername == "postgresql+psycopg"
    assert url.host in {"localhost", "127.0.0.1"}
    assert url.database == "pm_regression_test"

    async def scenario():
        engine = create_async_engine(url)
        schema = f"pm_lock_{uuid.uuid4().hex}"
        scoped = engine.execution_options(schema_translate_map={None: schema})
        sessions = async_sessionmaker(scoped, expire_on_commit=False)
        first_counted, second_dispatched, release_first = asyncio.Event(), asyncio.Event(), asyncio.Event()
        require_project, admin_count = pm.require_project, pm._admin_count
        counts = []
        backend_pids = {}

        async def observed_access(*args, **kwargs):
            if asyncio.current_task().get_name() == "second membership change":
                second_dispatched.set()
            return await require_project(*args, **kwargs)

        async def observed_count(*args, **kwargs):
            count = await admin_count(*args, **kwargs)
            counts.append(count)
            if len(counts) == 1:
                first_counted.set()
                # Keep the first transaction open until the other operation
                # starts. No timing sleeps or SQLite lock approximations.
                await asyncio.wait_for(release_first.wait(), 10)
            elif not release_first.is_set():
                # The unfixed implementation reaches this with count == 2.
                # Let both commits finish so the final-state assertion fails.
                release_first.set()
            return count

        monkeypatch.setattr(pm, "require_project", observed_access)
        monkeypatch.setattr(pm, "_admin_count", observed_count)
        try:
            async with engine.begin() as connection:
                await connection.execute(text(f'CREATE SCHEMA "{schema}"'))
            async with scoped.begin() as connection:
                await connection.run_sync(Base.metadata.create_all)
            async with sessions() as db:
                users = [User(email=f"review-{index}@example.test", display_name=f"Admin {index}",
                              is_admin=True, status="active") for index in range(2)]
                db.add_all(users)
                await db.flush()
                project = PmProject(key="RACE", name="Concurrency regression", lead_id=users[0].id)
                db.add(project)
                await db.flush()
                db.add_all([PmProjectMember(project_id=project.id, user_id=person.id, role="admin") for person in users])
                await db.commit()
                pid, ids, caller = project.id, [person.id for person in users], users[0]

            async def mutate(index):
                async with sessions() as db:
                    backend_pids[index] = await db.scalar(text("SELECT pg_backend_pid()"))
                    try:
                        if operations[index] == "demote":
                            await pm.update_member(pid, ids[index], PmMemberUpdate(role="member"), db, caller)
                        else:
                            await pm.remove_member(pid, ids[index], db, caller)
                        return "changed"
                    except HTTPException as exc:
                        await db.rollback()
                        assert exc.status_code == 409
                        return "last admin protected"

            first = asyncio.create_task(mutate(0))
            await asyncio.wait_for(first_counted.wait(), 10)
            second = asyncio.create_task(mutate(1), name="second membership change")
            await asyncio.wait_for(second_dispatched.wait(), 10)
            # Prove the second transaction is blocked by the first in real
            # PostgreSQL, rather than assuming two quickly launched calls raced.
            async def wait_for_block():
                async with sessions() as monitor:
                    while not release_first.is_set():
                        blockers = await monitor.scalar(text("SELECT pg_blocking_pids(:pid)"), {"pid": backend_pids[1]})
                        if backend_pids[0] in blockers:
                            release_first.set()
                            return
                        await asyncio.sleep(0.01)
            await asyncio.wait_for(wait_for_block(), 10)
            results = await asyncio.wait_for(asyncio.gather(first, second), 20)
            assert results == ["changed", "last admin protected"]
            assert counts == [2, 1]
            async with sessions() as db:
                remaining = await db.scalar(select(func.count()).where(PmProjectMember.project_id == pid,
                                                                       PmProjectMember.role == "admin"))
                assert remaining == 1
        finally:
            async with engine.begin() as connection:
                await connection.execute(text(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE'))
            await engine.dispose()

    if sys.platform == "win32":
        with asyncio.Runner(loop_factory=asyncio.SelectorEventLoop) as runner:
            runner.run(scenario())
    else:
        asyncio.run(scenario())
