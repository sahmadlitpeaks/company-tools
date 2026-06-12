import pytest

from helpers import make_member

pytestmark = pytest.mark.asyncio


async def test_template_crud_and_apply(client, auth):
    tpl = await client.post("/api/people/templates", headers=auth, json={
        "name": "Engineer onboarding", "kind": "onboarding",
        "items": [
            {"title": "Create email account", "category": "accounts", "sort": 0},
            {"title": "Issue laptop", "category": "equipment", "sort": 1},
            {"title": "Sign employment contract", "category": "hr", "sort": 2},
        ],
    })
    assert tpl.status_code == 201
    tid = tpl.json()["id"]
    assert len(tpl.json()["items"]) == 3

    listed = (await client.get("/api/people/templates?kind=onboarding", headers=auth)).json()
    assert any(t["id"] == tid for t in listed)

    # Start a journey from the template -> tasks come from the packet.
    _, uid = await make_member(client, auth, "tpl-hire@agholding.net")
    j = (await client.post("/api/people/journeys", headers=auth, json={
        "kind": "onboarding", "target_user_id": uid, "template_id": tid,
    })).json()
    detail = (await client.get(f"/api/people/journeys/{j['id']}", headers=auth)).json()
    titles = [t["title"] for t in detail["tasks"]]
    assert titles == ["Create email account", "Issue laptop", "Sign employment contract"]

    # Update replaces items.
    upd = await client.patch(f"/api/people/templates/{tid}", headers=auth, json={
        "items": [{"title": "Welcome lunch", "category": "other", "sort": 0}],
    })
    assert upd.status_code == 200 and len(upd.json()["items"]) == 1

    assert (await client.delete(f"/api/people/templates/{tid}", headers=auth)).status_code == 204
    assert not any(t["id"] == tid for t in (await client.get("/api/people/templates", headers=auth)).json())


async def test_journey_without_template_uses_defaults(client, auth):
    _, uid = await make_member(client, auth, "tpl-default@agholding.net")
    j = (await client.post("/api/people/journeys", headers=auth, json={
        "kind": "onboarding", "target_user_id": uid,
    })).json()
    detail = (await client.get(f"/api/people/journeys/{j['id']}", headers=auth)).json()
    assert len(detail["tasks"]) > 0  # built-in default checklist
