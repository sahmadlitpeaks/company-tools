"""Opt-in PostgreSQL coverage for membership locks (SQLite ignores FOR UPDATE)."""
import asyncio
import os
import sys
import uuid

import httpx
import pytest
from sqlalchemy import select, text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.database import Base, get_db
from app.core.security import create_access_token
from app.main import app
from app.models.activity import ActivityLog
from app.models.department import Department
from app.models.user import User


@pytest.mark.skipif(not os.environ.get("DEPARTMENT_TEST_DATABASE_URL"),
                    reason="Requires disposable local PostgreSQL")
@pytest.mark.parametrize("with_manager", [False, True])
def test_membership_locks_on_postgres(with_manager):
    url = make_url(os.environ["DEPARTMENT_TEST_DATABASE_URL"])
    # Refuse remote or ordinary application databases, even if configured by mistake.
    assert url.drivername == "postgresql+psycopg"
    assert url.host in {"localhost", "127.0.0.1"}
    assert url.database == "department_lock_test"

    async def scenario():
        engine = create_async_engine(url)
        schema = f"department_lock_{uuid.uuid4().hex}"
        scoped_engine = engine.execution_options(schema_translate_map={None: schema})
        sessions = async_sessionmaker(scoped_engine, expire_on_commit=False)
        previous_overrides = app.dependency_overrides.copy()

        async def database():
            async with sessions() as db:
                try:
                    yield db
                    await db.commit()
                except Exception:
                    await db.rollback()
                    raise

        try:
            async with engine.begin() as connection:
                await connection.execute(text(f'CREATE SCHEMA "{schema}"'))
            async with scoped_engine.begin() as connection:
                await connection.run_sync(Base.metadata.create_all)
            async with sessions() as db:
                manager = User(email="manager@example.test", display_name="Manager", status="active")
                db.add(manager)
                await db.flush()
                # Assign the signed-in admin too: auth already loaded this User
                # into the session before the membership handler requests its lock.
                admin = User(email="admin@example.test", display_name="Admin", status="active",
                             is_admin=True, role="admin", manager_id=manager.id if with_manager else None)
                member = User(email="member@example.test", display_name="Member", status="active",
                              manager_id=manager.id if with_manager else None,
                              permissions=["dashboard", "cards"], revoked_permissions=["crm"])
                first = Department(name="Management", permissions=["dashboard", "crm"])
                second = Department(name="Marketing", permissions=["dashboard", "sharepoint_intelligence"])
                db.add_all([admin, member, first, second])
                await db.commit()
                admin_id, member_id, first_id, second_id = admin.id, member.id, first.id, second.id

            app.dependency_overrides[get_db] = database
            headers = {"Authorization": f"Bearer {create_access_token(str(admin_id))}"}
            member_headers = {"Authorization": f"Bearer {create_access_token(str(member_id))}"}
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
                for user_id in (admin_id, member_id):
                    path = f"/api/departments/{first_id}/members"
                    added = await client.post(path, headers=headers, json={"user_id": str(user_id)})
                    assert added.status_code == 201, added.text
                    assert added.json()["id"] == str(user_id)
                    duplicate = await client.post(path, headers=headers, json={"user_id": str(user_id)})
                    assert duplicate.status_code == 409

                me = (await client.get("/api/auth/me", headers=member_headers)).json()
                assert me["department_name"] == "Management"
                assert "cards" in me["effective_permissions"]
                assert "crm" not in me["effective_permissions"]
                path = f"/api/departments/{second_id}/members"
                moved = await client.post(path, headers=headers, json={"user_id": str(member_id)})
                assert moved.status_code == 201, moved.text
                assert (await client.post(path, headers=member_headers,
                                          json={"user_id": str(admin_id)})).status_code == 403
                me = (await client.get("/api/auth/me", headers=member_headers)).json()
                assert me["department_name"] == "Marketing"
                assert {"cards", "sharepoint_intelligence"} <= set(me["effective_permissions"])

                for user_id, department_id in ((member_id, second_id), (admin_id, first_id)):
                    removed = await client.delete(f"/api/departments/{department_id}/members/{user_id}", headers=headers)
                    assert removed.status_code == 204, removed.text
                me = (await client.get("/api/auth/me", headers=member_headers)).json()
                assert me["department_id"] is None
                assert "cards" in me["effective_permissions"]
                assert "sharepoint_intelligence" not in me["effective_permissions"]

            async with sessions() as db:
                audit = (await db.scalars(select(ActivityLog).where(ActivityLog.entity_type == "user"))).all()
                assert len(audit) == 5  # Two additions, one move, two removals.
                assert all(entry.user_id == admin_id for entry in audit)
        finally:
            app.dependency_overrides.clear()
            app.dependency_overrides.update(previous_overrides)
            async with engine.begin() as connection:
                await connection.execute(text(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE'))
            await engine.dispose()

    if sys.platform == "win32":
        with asyncio.Runner(loop_factory=asyncio.SelectorEventLoop) as runner:
            runner.run(scenario())
    else:
        asyncio.run(scenario())
