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


async def test_manage_existing_department_members_and_access(client, auth):
    first = (await client.post("/api/departments", headers=auth,
        json={"name": "Compliance Team", "permissions": ["dashboard", "sharepoint_intelligence"]})).json()
    second = (await client.post("/api/departments", headers=auth,
        json={"name": "Finance Review", "permissions": ["dashboard", "crm"]})).json()
    member_auth, user_id = await make_member(client, auth, "dept-member@agholding.net")
    await client.patch(f"/api/users/{user_id}", headers=auth,
        json={"role": "manager", "permissions": ["dashboard", "cards"]})

    path = f"/api/departments/{first['id']}/members"
    assert (await client.get(path, headers=member_auth)).status_code == 403
    assert (await client.post(path, headers=member_auth, json={"user_id": user_id})).status_code == 403
    added = await client.post(path, headers=auth, json={"user_id": user_id})
    assert added.status_code == 201
    assert added.json()["email"] == "dept-member@agholding.net"
    assert [user["id"] for user in (await client.get(path, headers=auth)).json()] == [user_id]
    access = (await client.get("/api/auth/me", headers=member_auth)).json()
    assert access["department_name"] == "Compliance Team"
    assert {"sharepoint_intelligence", "cards"} <= set(access["effective_permissions"])
    assert (await client.post(path, headers=auth, json={"user_id": user_id})).status_code == 409

    moved = await client.post(f"/api/departments/{second['id']}/members", headers=auth,
        json={"user_id": user_id})
    assert moved.status_code == 201
    assert (await client.get(path, headers=auth)).json() == []
    access = (await client.get("/api/auth/me", headers=member_auth)).json()
    assert access["department_name"] == "Finance Review"
    assert {"crm", "cards"} <= set(access["effective_permissions"])

    remove_path = f"/api/departments/{second['id']}/members/{user_id}"
    assert (await client.delete(remove_path, headers=member_auth)).status_code == 403
    assert (await client.delete(remove_path, headers=auth)).status_code == 204
    assert (await client.delete(remove_path, headers=auth)).status_code == 404
    access = (await client.get("/api/auth/me", headers=member_auth)).json()
    assert access["department_id"] is None
    assert "cards" in access["effective_permissions"]
    assert "asset_tracker" not in access["effective_permissions"]  # No manager-default expansion.
    assert "crm" not in access["effective_permissions"]


async def test_admin_membership_and_missing_records(client, auth):
    dept = (await client.post("/api/departments", headers=auth,
        json={"name": "Access Team", "permissions": ["dashboard"]})).json()
    admin_id = (await client.get("/api/auth/me", headers=auth)).json()["id"]
    assert (await client.post(f"/api/departments/{dept['id']}/members", headers=auth,
        json={"user_id": admin_id})).status_code == 201
    assert (await client.get("/api/auth/me", headers=auth)).json()["department_name"] == "Access Team"
    missing = "00000000-0000-4000-8000-000000000001"
    assert (await client.get(f"/api/departments/{missing}/members", headers=auth)).status_code == 404
    assert (await client.post(f"/api/departments/{dept['id']}/members", headers=auth,
        json={"user_id": missing})).status_code == 404


async def test_department_duplicate_and_validation(client, auth):
    await client.post("/api/departments", headers=auth, json={"name": "Dupe", "permissions": []})
    dup = await client.post("/api/departments", headers=auth, json={"name": "Dupe"})
    assert dup.status_code == 409
    bad = await client.post(
        "/api/departments", headers=auth, json={"name": "Bad", "permissions": ["not_a_module"]}
    )
    assert bad.status_code == 422
