"""Azure SSO sign-in policy.

Who may use the platform is decided in Azure (the app registration is limited
to an approved group), so completing SSO activates a pending account. A locally
disabled account must still be refused, which is the one thing Azure cannot
express for us.
"""
import pytest
from sqlalchemy import select

from app.models.user import User

SSO_EMAIL = "new.joiner@agholding.net"


class _FakeAzureClient:
    async def authorize_access_token(self, request):
        return {"access_token": "fake-graph-token"}


class _FakeOAuth:
    azure = _FakeAzureClient()


@pytest.fixture
def sso(monkeypatch):
    """Stand in for Azure: configured tenant, and a fixed Graph profile."""
    import app.auth.router as router

    async def fake_config(db):
        return {
            "tenant_id": "tenant",
            "client_id": "client",
            "client_secret": "secret",
            "redirect_uri": "http://test/api/auth/callback",
            "configured": True,
            "source": "environment",
        }

    profile = {
        "id": "azure-oid-1",
        "displayName": "New Joiner",
        "mail": SSO_EMAIL,
        "userPrincipalName": SSO_EMAIL,
    }

    async def fake_graph_me(access_token):
        return dict(profile)

    monkeypatch.setattr(router, "get_azure_config", fake_config)
    monkeypatch.setattr(router, "build_oauth", lambda *a, **k: _FakeOAuth())
    monkeypatch.setattr(router, "fetch_graph_me", fake_graph_me)
    return profile


async def _get_user(email: str) -> User | None:
    from app.core.database import AsyncSessionLocal

    async with AsyncSessionLocal() as db:
        return (
            await db.execute(select(User).where(User.email == email))
        ).scalar_one_or_none()


async def _set_status(email: str, status: str) -> None:
    from app.core.database import AsyncSessionLocal

    async with AsyncSessionLocal() as db:
        user = (
            await db.execute(select(User).where(User.email == email))
        ).scalar_one()
        user.status = status
        await db.commit()


@pytest.mark.anyio
async def test_sso_signin_activates_a_new_account_without_admin_approval(client, sso):
    """Azure vouched for them, so they are signed straight in."""
    r = await client.get("/api/auth/callback")

    assert r.status_code in (302, 307)
    assert "error=" not in r.headers["location"]
    assert "ag_platform_session" in r.cookies

    user = await _get_user(SSO_EMAIL)
    assert user is not None
    assert user.status == "active"
    # Azure decides membership; it must not silently confer admin rights.
    assert user.is_admin is False


@pytest.mark.anyio
async def test_disabled_account_cannot_sign_in_through_sso(client, sso):
    """A local deactivation outranks Azure and must not hand out a session."""
    await client.get("/api/auth/callback")
    await _set_status(SSO_EMAIL, "disabled")

    r = await client.get("/api/auth/callback")

    assert r.status_code in (302, 307)
    assert "error=account_inactive" in r.headers["location"]
    assert "ag_platform_session" not in r.cookies
    assert (await _get_user(SSO_EMAIL)).status == "disabled"


@pytest.mark.anyio
async def test_sso_does_not_resurrect_a_disabled_account_on_repeat_attempts(client, sso):
    """Retrying the sign-in must not wear the deactivation down."""
    await client.get("/api/auth/callback")
    await _set_status(SSO_EMAIL, "disabled")

    for _ in range(3):
        r = await client.get("/api/auth/callback")
        assert "error=account_inactive" in r.headers["location"]

    assert (await _get_user(SSO_EMAIL)).status == "disabled"


@pytest.mark.anyio
async def test_disallowed_email_domain_is_still_refused(client, sso, monkeypatch):
    """The domain allowlist stays the outer gate and runs before provisioning."""
    import app.auth.router as router

    async def only_other_domain(db):
        return ["other.example"]

    monkeypatch.setattr(router, "get_allowed_domains", only_other_domain)

    r = await client.get("/api/auth/callback")

    assert "error=domain_not_allowed" in r.headers["location"]
    assert "ag_platform_session" not in r.cookies
    assert await _get_user(SSO_EMAIL) is None


@pytest.mark.anyio
async def test_password_login_still_requires_an_active_account(client):
    """Only SSO auto-activates; local accounts keep the admin approval step."""
    from app.core.database import AsyncSessionLocal
    from app.core.security import hash_password

    async with AsyncSessionLocal() as db:
        db.add(
            User(
                email="local.pending@agholding.net",
                display_name="Local Pending",
                password_hash=hash_password("Password123"),
                status="pending",
            )
        )
        await db.commit()

    r = await client.post(
        "/api/auth/login",
        json={"email": "local.pending@agholding.net", "password": "Password123"},
    )
    assert r.status_code == 403
