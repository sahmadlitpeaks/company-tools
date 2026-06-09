"""Pytest fixtures: an ASGI test client backed by a throwaway SQLite DB."""
import os

# Configure the environment BEFORE the app/config singletons are imported.
os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///./test.db")
os.environ.setdefault("ENVIRONMENT", "development")
os.environ.setdefault("SECRET_KEY", "test-secret-key")
os.environ.setdefault("RUN_SCHEDULER", "false")

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
    from app.services.bootstrap import ensure_default_admin

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    # Seed the bootstrap admin the way production startup does.
    async with AsyncSessionLocal() as db:
        await ensure_default_admin(db)
    transport = ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


@pytest_asyncio.fixture
async def auth(client):
    r = await client.post(
        "/api/auth/login",
        json={"email": "admin@agholding.net", "password": "admin"},
    )
    token = r.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}
