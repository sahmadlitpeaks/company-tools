import pytest

from app.services import push
from helpers import make_member

pytestmark = pytest.mark.asyncio

TOKEN = "fcm-token-aaa"


def _enable(monkeypatch):
    """Turn push on without a real service account behind it."""
    monkeypatch.setattr(push.settings, "PUSH_ENABLED", True, raising=False)
    monkeypatch.setattr(push.settings, "FCM_PROJECT_ID", "demo-project", raising=False)
    monkeypatch.setattr(
        push.settings, "FCM_SERVICE_ACCOUNT_JSON", '{"client_email":"x","private_key":"y"}',
        raising=False,
    )


def _capture_sends(monkeypatch, dead=()):
    """Replace the FCM transport, recording what would have been sent."""
    sent = []

    async def fake_send(tokens, *, title, body, link):
        sent.append({"tokens": list(tokens), "title": title, "body": body, "link": link})
        return [t for t in tokens if t in dead]

    monkeypatch.setattr(push, "send_to_tokens", fake_send)
    return sent


async def test_push_disabled_by_default(client, auth):
    cfg = (await client.get("/api/devices/config", headers=auth)).json()
    assert cfg["push_enabled"] is False


async def test_config_reports_enabled(client, auth, monkeypatch):
    _enable(monkeypatch)
    cfg = (await client.get("/api/devices/config", headers=auth)).json()
    assert cfg["push_enabled"] is True


async def test_register_list_and_unregister(client, auth):
    r = await client.post(
        "/api/devices", headers=auth,
        json={"token": TOKEN, "platform": "ios", "device": "Sam's iPhone"},
    )
    assert r.status_code == 200
    device = r.json()
    assert device["platform"] == "ios" and device["device_label"] == "Sam's iPhone"

    listed = (await client.get("/api/devices", headers=auth)).json()
    assert [d["id"] for d in listed] == [device["id"]]

    assert (await client.delete(f"/api/devices/{device['id']}", headers=auth)).status_code == 200
    assert (await client.get("/api/devices", headers=auth)).json() == []


async def test_registering_the_same_token_twice_updates_in_place(client, auth):
    first = (await client.post("/api/devices", headers=auth, json={"token": TOKEN, "platform": "ios"})).json()
    second = (await client.post("/api/devices", headers=auth, json={"token": TOKEN, "platform": "android"})).json()
    assert first["id"] == second["id"]
    assert second["platform"] == "android"
    assert len((await client.get("/api/devices", headers=auth)).json()) == 1


async def test_a_handed_down_phone_moves_to_the_new_owner(client, auth):
    """Re-registering someone else's token must not leak their notifications."""
    hdr, _ = await make_member(client, auth, "new-owner@agholding.net")
    await client.post("/api/devices", headers=auth, json={"token": TOKEN})
    await client.post("/api/devices", headers=hdr, json={"token": TOKEN})

    assert (await client.get("/api/devices", headers=auth)).json() == []
    assert len((await client.get("/api/devices", headers=hdr)).json()) == 1


async def test_empty_token_rejected(client, auth):
    assert (await client.post("/api/devices", headers=auth, json={"token": "  "})).status_code == 422


async def test_cannot_unregister_someone_elses_device(client, auth):
    device = (await client.post("/api/devices", headers=auth, json={"token": TOKEN})).json()
    hdr, _ = await make_member(client, auth, "nosy@agholding.net")
    assert (await client.delete(f"/api/devices/{device['id']}", headers=hdr)).status_code == 404


async def test_notification_pushes_to_registered_devices(client, auth, monkeypatch):
    _enable(monkeypatch)
    sent = _capture_sends(monkeypatch)
    await client.post("/api/devices", headers=auth, json={"token": TOKEN, "platform": "ios"})

    await client.post("/api/notifications/test", headers=auth)

    assert len(sent) == 1
    assert sent[0]["tokens"] == [TOKEN]
    assert sent[0]["title"] == "Test notification"


async def test_no_push_when_disabled(client, auth, monkeypatch):
    sent = _capture_sends(monkeypatch)
    await client.post("/api/devices", headers=auth, json={"token": TOKEN})
    await client.post("/api/notifications/test", headers=auth)
    assert sent == []


async def test_muted_category_is_not_pushed(client, auth, monkeypatch):
    _enable(monkeypatch)
    sent = _capture_sends(monkeypatch)
    await client.post("/api/devices", headers=auth, json={"token": TOKEN})
    # The test notification is category "info".
    await client.put("/api/notifications/preferences", headers=auth, json={"muted": ["info"]})

    await client.post("/api/notifications/test", headers=auth)
    assert sent == []


async def test_dead_tokens_are_deactivated(client, auth, monkeypatch):
    _enable(monkeypatch)
    _capture_sends(monkeypatch, dead={TOKEN})
    await client.post("/api/devices", headers=auth, json={"token": TOKEN})

    await client.post("/api/notifications/test", headers=auth)

    # FCM said the token is gone, so it stops being pushed to.
    assert (await client.get("/api/devices", headers=auth)).json() == []


async def test_push_failure_never_breaks_the_notification(client, auth, monkeypatch):
    _enable(monkeypatch)

    async def boom(*a, **k):
        raise RuntimeError("fcm down")

    monkeypatch.setattr(push, "send_to_tokens", boom)
    await client.post("/api/devices", headers=auth, json={"token": TOKEN})

    r = await client.post("/api/notifications/test", headers=auth)
    assert r.status_code == 200 and r.json()["in_app"] is True
    notes = (await client.get("/api/notifications", headers=auth)).json()
    assert any(n["title"] == "Test notification" for n in notes)


def test_push_enabled_needs_all_three_settings(monkeypatch):
    monkeypatch.setattr(push.settings, "PUSH_ENABLED", True, raising=False)
    monkeypatch.setattr(push.settings, "FCM_PROJECT_ID", "", raising=False)
    monkeypatch.setattr(push.settings, "FCM_SERVICE_ACCOUNT_JSON", "{}", raising=False)
    assert push.push_enabled() is False


async def test_send_to_tokens_is_a_noop_when_disabled(monkeypatch):
    monkeypatch.setattr(push.settings, "PUSH_ENABLED", False, raising=False)
    assert await push.send_to_tokens(["a"], title="t", body=None, link=None) == []
