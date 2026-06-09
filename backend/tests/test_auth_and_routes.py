import pytest

pytestmark = pytest.mark.asyncio


async def test_health_ok(client):
    r = await client.get("/health")
    assert r.status_code == 200 and r.json()["status"] == "ok"


async def test_default_admin_can_sign_in(client):
    r = await client.post(
        "/api/auth/login", json={"email": "admin@agholding.net", "password": "admin"}
    )
    assert r.status_code == 200
    body = r.json()
    assert "access_token" in body and body["must_change_password"] is True


async def test_bad_credentials_rejected(client):
    r = await client.post(
        "/api/auth/login", json={"email": "admin@agholding.net", "password": "wrong"}
    )
    assert r.status_code == 401
    r2 = await client.post(
        "/api/auth/login", json={"email": "nobody@agholding.net", "password": "x"}
    )
    assert r2.status_code == 401


async def test_dev_login_removed(client):
    r = await client.post("/api/auth/dev-login", params={"email": "x@agholding.net"})
    assert r.status_code in (404, 405)


async def test_auth_config_reports_password_login(client):
    r = await client.get("/api/auth/config")
    assert r.json()["password"] is True
    assert "dev_login" not in r.json()


async def test_change_password_flow(client, auth):
    # Wrong current password is rejected.
    bad = await client.post(
        "/api/auth/change-password",
        headers=auth,
        json={"current_password": "nope", "new_password": "BrandNew123"},
    )
    assert bad.status_code == 400
    # Correct change clears the force-change flag and updates the credential.
    ok = await client.post(
        "/api/auth/change-password",
        headers=auth,
        json={"current_password": "admin", "new_password": "BrandNew123"},
    )
    assert ok.status_code == 200
    me = (await client.get("/api/auth/me", headers=auth)).json()
    assert me["must_change_password"] is False
    # Old password no longer works; new one does.
    assert (
        await client.post(
            "/api/auth/login", json={"email": "admin@agholding.net", "password": "admin"}
        )
    ).status_code == 401
    assert (
        await client.post(
            "/api/auth/login",
            json={"email": "admin@agholding.net", "password": "BrandNew123"},
        )
    ).status_code == 200


async def test_public_base_url_resolver():
    from app.core.urls import frontend_base_url, public_base_url, set_request_base

    # With nothing explicit, the per-request host is used (trailing slash dropped).
    set_request_base("http://203.0.113.5:8080")
    assert public_base_url() == "http://203.0.113.5:8080"
    assert frontend_base_url() == "http://203.0.113.5:8080"
    set_request_base(None)


async def test_generated_links_use_request_host(client, auth):
    # Simulate the app being reached at an IP behind nginx (forwarded headers).
    fwd = {
        **auth,
        "X-Forwarded-Proto": "http",
        "X-Forwarded-Host": "203.0.113.5:8080",
    }
    r = await client.post(
        "/api/transfers",
        headers=fwd,
        files={"file": ("note.txt", b"hello", "text/plain")},
        data={"recipient_email": "x@agholding.net"},
    )
    assert r.status_code == 201
    # The share link points at the host the request came in on, not localhost.
    assert r.json()["share_url"].startswith("http://203.0.113.5:8080/t/")


async def test_unknown_api_route_404(client, auth):
    r = await client.get("/api/does-not-exist", headers=auth)
    assert r.status_code == 404
