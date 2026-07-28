import pytest

from helpers import MEMBER_PW, make_member

pytestmark = pytest.mark.asyncio

EMAIL = "phone-user@agholding.net"


async def _login(client, *, device=None, platform=None, email=EMAIL):
    body = {"email": email, "password": MEMBER_PW}
    if device:
        body["device"] = device
    if platform:
        body["platform"] = platform
    return await client.post("/api/auth/login", json=body)


async def test_web_login_gets_no_refresh_token(client, auth):
    """The browser SPA sends no device, so nothing long-lived is minted."""
    await make_member(client, auth, EMAIL)
    r = await _login(client)
    assert r.status_code == 200
    body = r.json()
    assert body["access_token"]
    assert "refresh_token" not in body


async def test_device_login_issues_a_refresh_token(client, auth):
    await make_member(client, auth, EMAIL)
    r = await _login(client, device="Sam's iPhone", platform="ios")
    assert r.status_code == 200
    assert r.json()["refresh_token"].startswith("rt_")


async def test_refresh_rotates_and_old_token_is_dead(client, auth):
    await make_member(client, auth, EMAIL)
    first = (await _login(client, device="iPhone", platform="ios")).json()["refresh_token"]

    r = await client.post("/api/auth/refresh", json={"refresh_token": first})
    assert r.status_code == 200
    body = r.json()
    assert body["access_token"]
    second = body["refresh_token"]
    assert second != first

    # The new token works...
    assert (await client.post("/api/auth/refresh", json={"refresh_token": second})).status_code == 200
    # ...and the rotated-out one does not.
    reused = await client.post("/api/auth/refresh", json={"refresh_token": first})
    assert reused.status_code == 401


async def test_reuse_of_a_rotated_token_kills_the_whole_chain(client, auth):
    """A stale token in the wild means it leaked — drop every session."""
    await make_member(client, auth, EMAIL)
    first = (await _login(client, device="iPhone")).json()["refresh_token"]
    second = (
        await client.post("/api/auth/refresh", json={"refresh_token": first})
    ).json()["refresh_token"]

    # Presenting the old copy revokes everything, including the live token.
    assert (await client.post("/api/auth/refresh", json={"refresh_token": first})).status_code == 401
    assert (await client.post("/api/auth/refresh", json={"refresh_token": second})).status_code == 401


async def test_access_token_from_refresh_actually_works(client, auth):
    await make_member(client, auth, EMAIL)
    rt = (await _login(client, device="Android phone", platform="android")).json()["refresh_token"]
    access = (
        await client.post("/api/auth/refresh", json={"refresh_token": rt})
    ).json()["access_token"]
    me = await client.get("/api/auth/me", headers={"Authorization": f"Bearer {access}"})
    assert me.status_code == 200 and me.json()["email"] == EMAIL


async def test_logout_revokes_the_device(client, auth):
    await make_member(client, auth, EMAIL)
    rt = (await _login(client, device="iPad")).json()["refresh_token"]
    assert (await client.post("/api/auth/logout", json={"refresh_token": rt})).status_code == 200
    assert (await client.post("/api/auth/refresh", json={"refresh_token": rt})).status_code == 401


async def test_garbage_and_missing_tokens_are_rejected(client):
    assert (await client.post("/api/auth/refresh", json={"refresh_token": "rt_nope"})).status_code == 401
    assert (await client.post("/api/auth/refresh", json={"refresh_token": ""})).status_code == 401


async def test_disabled_user_cannot_refresh(client, auth):
    hdr, uid = await make_member(client, auth, EMAIL)
    rt = (await _login(client, device="iPhone")).json()["refresh_token"]
    await client.patch(f"/api/users/{uid}", headers=auth, json={"status": "disabled"})
    r = await client.post("/api/auth/refresh", json={"refresh_token": rt})
    assert r.status_code == 403


async def test_sessions_list_and_revoke(client, auth):
    hdr, _ = await make_member(client, auth, EMAIL)
    rt = (await _login(client, device="Work iPhone", platform="ios")).json()["refresh_token"]

    sessions = (await client.get("/api/auth/sessions", headers=hdr)).json()
    assert [s["device_label"] for s in sessions] == ["Work iPhone"]
    assert sessions[0]["platform"] == "ios"

    revoked = await client.delete(f"/api/auth/sessions/{sessions[0]['id']}", headers=hdr)
    assert revoked.status_code == 200
    assert (await client.post("/api/auth/refresh", json={"refresh_token": rt})).status_code == 401
    assert (await client.get("/api/auth/sessions", headers=hdr)).json() == []


async def test_a_user_cannot_revoke_someone_elses_session(client, auth):
    hdr_a, _ = await make_member(client, auth, EMAIL)
    await _login(client, device="Victim phone")
    sessions = (await client.get("/api/auth/sessions", headers=hdr_a)).json()

    hdr_b, _ = await make_member(client, auth, "other-user@agholding.net")
    r = await client.delete(f"/api/auth/sessions/{sessions[0]['id']}", headers=hdr_b)
    assert r.status_code == 404


async def test_unknown_platform_falls_back_to_web(client, auth):
    hdr, _ = await make_member(client, auth, EMAIL)
    await _login(client, device="Weird client", platform="blackberry")
    assert (await client.get("/api/auth/sessions", headers=hdr)).json()[0]["platform"] == "web"
