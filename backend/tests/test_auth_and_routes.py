import pytest

from app.core.config import settings

pytestmark = pytest.mark.asyncio


async def test_health_ok(client):
    r = await client.get("/health")
    assert r.status_code == 200 and r.json()["status"] == "ok"


async def test_dev_login_works_in_development(client):
    r = await client.post("/api/auth/dev-login", params={"email": "x@agholding.net"})
    assert r.status_code == 200 and "access_token" in r.json()


async def test_dev_login_disabled_outside_development(client, monkeypatch):
    monkeypatch.setattr(settings, "ENVIRONMENT", "production")
    r = await client.post("/api/auth/dev-login", params={"email": "x@agholding.net"})
    assert r.status_code == 404


async def test_auth_config_reports_dev_login(client):
    r = await client.get("/api/auth/config")
    assert r.json()["dev_login"] is True


async def test_unknown_api_route_404(client, auth):
    r = await client.get("/api/does-not-exist", headers=auth)
    assert r.status_code == 404
