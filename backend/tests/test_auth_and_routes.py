import pytest

pytestmark = pytest.mark.asyncio


async def _set_forced_change(email: str, value: bool) -> None:
    from sqlalchemy import func, select

    from app.core.database import AsyncSessionLocal
    from app.models.user import User

    async with AsyncSessionLocal() as db:
        user = (
            await db.execute(select(User).where(func.lower(User.email) == email))
        ).scalar_one()
        user.must_change_password = value
        await db.commit()


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
    # The `auth` fixture lifts the forced-change flag for the benefit of other
    # tests; put it back so this one still proves the change clears it.
    await _set_forced_change("admin@agholding.net", True)
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


async def test_forced_password_change_is_enforced_server_side(client):
    """A temporary password travels by email, so the browser can't be the only
    thing insisting on the change."""
    token = (
        await client.post(
            "/api/auth/login",
            json={"email": "admin@agholding.net", "password": "admin"},
        )
    ).json()["access_token"]
    h = {"Authorization": f"Bearer {token}"}

    # Everything is refused while the change is outstanding...
    blocked = await client.get("/api/users", headers=h)
    assert blocked.status_code == 403
    assert blocked.headers.get("X-Password-Change-Required") == "1"
    # ...except what the change screen itself needs.
    assert (await client.get("/api/auth/me", headers=h)).status_code == 200
    assert (await client.get("/api/auth/config")).status_code == 200

    # After changing it, the same token works everywhere.
    assert (
        await client.post(
            "/api/auth/change-password",
            headers=h,
            json={"current_password": "admin", "new_password": "AdminPass123"},
        )
    ).status_code == 200
    assert (await client.get("/api/users", headers=h)).status_code == 200


async def test_new_user_gets_emailed_temp_password(client, auth):
    """No password supplied => one is generated so the account is actually usable.

    SMTP is unconfigured under test, so the password comes back to the admin
    instead of being silently swallowed.
    """
    from app.core.security import password_policy_error

    r = await client.post(
        "/api/users",
        headers=auth,
        json={"email": "joiner@agholding.net", "display_name": "New Joiner"},
    )
    assert r.status_code == 201
    body = r.json()
    assert body["must_change_password"] is True
    assert body["credentials_emailed"] is False
    temp = body["temp_password"]
    assert temp and password_policy_error(temp) is None

    # The generated password really does sign in.
    login = await client.post(
        "/api/auth/login", json={"email": "joiner@agholding.net", "password": temp}
    )
    assert login.status_code == 200
    assert login.json()["must_change_password"] is True


async def test_admin_reset_password_reissues_and_rearms(client, auth):
    from tests.helpers import MEMBER_PW, make_member

    _, uid = await make_member(client, auth, email="resettee@agholding.net")
    r = await client.post(f"/api/users/{uid}/reset-password", headers=auth)
    assert r.status_code == 200
    temp = r.json()["temp_password"]
    assert temp

    # Old password is dead, new one works and owes a change again.
    assert (
        await client.post(
            "/api/auth/login",
            json={"email": "resettee@agholding.net", "password": MEMBER_PW},
        )
    ).status_code == 401
    login = await client.post(
        "/api/auth/login", json={"email": "resettee@agholding.net", "password": temp}
    )
    assert login.status_code == 200
    assert login.json()["must_change_password"] is True


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
