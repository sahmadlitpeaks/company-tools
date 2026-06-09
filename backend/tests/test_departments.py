import pytest

from helpers import make_member

pytestmark = pytest.mark.asyncio


async def test_default_departments_seeded(client, auth):
    depts = (await client.get("/api/departments", headers=auth)).json()
    names = {d["name"] for d in depts}
    assert {"Management", "Marketing", "Sales", "IT", "HR", "Finance", "Operations"} <= names
    it = next(d for d in depts if d["name"] == "IT")
    assert "asset_tracker" in it["permissions"]


async def test_department_drives_access_with_overrides(client, auth):
    # A department that grants only CRM on top of the dashboard.
    d = await client.post(
        "/api/departments",
        headers=auth,
        json={"name": "Growth", "description": "Growth squad", "permissions": ["dashboard", "crm"]},
    )
    assert d.status_code == 201
    did = d.json()["id"]

    hdr, uid = await make_member(client, auth, "growth@agholding.net")
    # Plain member can't see CRM by default.
    assert (await client.get("/api/crm/leads", headers=hdr)).status_code == 403

    # Put them in the department -> CRM unlocks, cards (not granted) stays blocked.
    await client.patch(f"/api/users/{uid}", headers=auth, json={"department_id": did})
    assert (await client.get("/api/crm/leads", headers=hdr)).status_code == 200
    assert (await client.get("/api/cards", headers=hdr)).status_code == 403

    # Grant cards to just this person.
    await client.patch(f"/api/users/{uid}", headers=auth, json={"extra_permissions": ["cards"]})
    assert (await client.get("/api/cards", headers=hdr)).status_code == 200

    # Revoke CRM for this person despite the department granting it.
    await client.patch(f"/api/users/{uid}", headers=auth, json={"revoked_permissions": ["crm"]})
    assert (await client.get("/api/crm/leads", headers=hdr)).status_code == 403

    me = (await client.get("/api/auth/me", headers=hdr)).json()
    assert me["department_name"] == "Growth"
    assert "cards" in me["effective_permissions"]
    assert "crm" not in me["effective_permissions"]

    # Member count is reflected; deleting the department is allowed.
    depts = (await client.get("/api/departments", headers=auth)).json()
    assert next(x for x in depts if x["id"] == did)["member_count"] == 1
    assert (await client.delete(f"/api/departments/{did}", headers=auth)).status_code == 204


async def test_departments_admin_only(client, auth):
    hdr, _ = await make_member(client, auth, "nodept@agholding.net")
    assert (await client.get("/api/departments", headers=hdr)).status_code == 403
    assert (await client.post("/api/departments", headers=hdr, json={"name": "X"})).status_code == 403


async def test_department_duplicate_and_validation(client, auth):
    await client.post("/api/departments", headers=auth, json={"name": "Dupe", "permissions": []})
    dup = await client.post("/api/departments", headers=auth, json={"name": "Dupe"})
    assert dup.status_code == 409
    bad = await client.post(
        "/api/departments", headers=auth, json={"name": "Bad", "permissions": ["not_a_module"]}
    )
    assert bad.status_code == 422
