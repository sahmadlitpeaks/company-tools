import pytest

from helpers import make_member

pytestmark = pytest.mark.asyncio


async def test_webhook_crud_and_validation(client, auth):
    # Unknown event rejected.
    bad = await client.post("/api/webhooks", headers=auth, json={"url": "https://x.test/hook", "events": ["nope.event"]})
    assert bad.status_code == 422

    created = await client.post("/api/webhooks", headers=auth, json={
        "url": "https://x.test/hook", "description": "My integration", "events": ["submission.created"],
    })
    assert created.status_code == 201
    body = created.json()
    assert body["secret"] and body["has_secret"] is True  # secret returned once

    wid = body["id"]
    lst = (await client.get("/api/webhooks", headers=auth)).json()
    assert any(w["id"] == wid for w in lst)
    # Secret is never returned on list.
    assert "secret" not in lst[0]

    upd = await client.patch(f"/api/webhooks/{wid}", headers=auth, json={"active": False})
    assert upd.status_code == 200 and upd.json()["active"] is False

    # Non-admin is forbidden.
    member_hdr, _ = await make_member(client, auth, "hook-member@agholding.net")
    assert (await client.get("/api/webhooks", headers=member_hdr)).status_code == 403


async def test_webhook_delivery_records_failure(client, auth):
    # Point at a closed local port so delivery fails fast and is logged.
    created = (await client.post("/api/webhooks", headers=auth, json={
        "url": "http://127.0.0.1:9/hook", "events": ["submission.created"],
    })).json()
    wid = created["id"]

    # Trigger a submission via intake → emits submission.created.
    src = (await client.post("/api/intake/sources", headers=auth, json={"name": "Hooked site"})).json()
    r = await client.post("/api/intake/ingest", headers={"X-API-Key": src["key"]}, json={
        "name": "Lead", "email": "lead@acme.com", "message": "interested",
    })
    assert r.status_code == 200

    deliveries = (await client.get(f"/api/webhooks/{wid}/deliveries", headers=auth)).json()
    assert len(deliveries) >= 1
    d = deliveries[0]
    assert d["event"] == "submission.created"
    assert d["success"] is False and d["error"]


async def test_webhook_test_endpoint(client, auth):
    created = (await client.post("/api/webhooks", headers=auth, json={
        "url": "http://127.0.0.1:9/hook",
    })).json()
    res = (await client.post(f"/api/webhooks/{created['id']}/test", headers=auth)).json()
    assert res["success"] is False and res["error"]
