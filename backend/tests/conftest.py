"""Pytest fixtures: an ASGI test client backed by a throwaway SQLite DB."""
import os

# Configure the environment BEFORE the app/config singletons are imported.
# Tests must never inherit the Docker service's live PostgreSQL URL. Assign
# these explicitly so the destructive drop_all/create_all fixture always uses
# the disposable SQLite database, even when pytest runs inside `docker compose`.
os.environ["DATABASE_URL"] = "sqlite+aiosqlite:///./test.db"
os.environ["ENVIRONMENT"] = "development"
os.environ["SECRET_KEY"] = "test-secret-key"
os.environ["RUN_SCHEDULER"] = "false"

import httpx  # noqa: E402
import pytest  # noqa: E402
import pytest_asyncio  # noqa: E402
from httpx import ASGITransport  # noqa: E402

import app.models  # noqa: E402,F401  (register all models)
from app.core.database import Base, engine  # noqa: E402
from app.main import app  # noqa: E402


@pytest_asyncio.fixture
async def client():
    from app.core.database import AsyncSessionLocal
    from app.services.bootstrap import (
        ensure_default_admin,
        ensure_default_departments,
        ensure_default_leave_types,
    )

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    # Seed the bootstrap admin + departments the way production startup does.
    async with AsyncSessionLocal() as db:
        await ensure_default_admin(db)
        await ensure_default_departments(db)
        await ensure_default_leave_types(db)
    transport = ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


@pytest_asyncio.fixture
async def auth(client):
    from helpers import clear_forced_password_change

    r = await client.post(
        "/api/auth/login",
        json={"email": "admin@agholding.net", "password": "admin"},
    )
    token = r.json()["access_token"]
    # The bootstrap admin must change its password before the API will serve it
    # anything else. Lift that here so every other test isn't testing the gate;
    # the password stays "admin" (the policy would reject it as a *new* one, and
    # test_change_password_flow still needs it as the current one).
    await clear_forced_password_change("admin@agholding.net")
    return {"Authorization": f"Bearer {token}"}
