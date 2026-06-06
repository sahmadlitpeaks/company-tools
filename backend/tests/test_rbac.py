import pytest

pytestmark = pytest.mark.asyncio


async def _member_token(client) -> str:
    r = await client.post("/api/auth/dev-login", params={"email": "bob@agholding.net"})
    return r.json()["access_token"]


async def _member_id(client, auth) -> str:
    users = (await client.get("/api/users", headers=auth)).json()
    return next(u["id"] for u in users if u["email"] == "bob@agholding.net")


async def test_first_user_is_admin(client, auth):
    me = (await client.get("/api/auth/me", headers=auth)).json()
    assert me["is_admin"] is True and me["role"] == "admin" and me["status"] == "active"
    # Admin sees every module.
    assert "crm" in me["effective_permissions"]


async def test_new_user_is_pending_and_blocked(client, auth):
    token = await _member_token(client)
    hdr = {"Authorization": f"Bearer {token}"}
    # Pending account can't touch anything that needs a real session.
    assert (await client.get("/api/auth/me", headers=hdr)).status_code == 403
    assert (await client.get("/api/cards", headers=hdr)).status_code == 403


async def test_member_module_gating(client, auth):
    token = await _member_token(client)
    hdr = {"Authorization": f"Bearer {token}"}
    mid = await _member_id(client, auth)

    # Approve as an active member.
    await client.patch(
        f"/api/users/{mid}", headers=auth, json={"status": "active", "role": "member"}
    )

    # Member defaults include cards but not CRM / asset tracker.
    assert (await client.get("/api/cards", headers=hdr)).status_code == 200
    assert (await client.get("/api/crm/leads", headers=hdr)).status_code == 403
    assert (await client.get("/api/asset-tracker", headers=hdr)).status_code == 403

    # me reflects the default permission set.
    me = (await client.get("/api/auth/me", headers=hdr)).json()
    assert "cards" in me["effective_permissions"]
    assert "crm" not in me["effective_permissions"]


async def test_admin_grants_extra_module(client, auth):
    token = await _member_token(client)
    hdr = {"Authorization": f"Bearer {token}"}
    mid = await _member_id(client, auth)

    # Grant an explicit permission set that adds CRM.
    await client.patch(
        f"/api/users/{mid}",
        headers=auth,
        json={"status": "active", "permissions": ["dashboard", "cards", "crm"]},
    )
    assert (await client.get("/api/crm/leads", headers=hdr)).status_code == 200
    # Not granted -> still blocked.
    assert (await client.get("/api/campaigns", headers=hdr)).status_code == 403


async def test_disabled_user_blocked(client, auth):
    token = await _member_token(client)
    hdr = {"Authorization": f"Bearer {token}"}
    mid = await _member_id(client, auth)
    await client.patch(f"/api/users/{mid}", headers=auth, json={"status": "active"})
    assert (await client.get("/api/cards", headers=hdr)).status_code == 200
    await client.patch(f"/api/users/{mid}", headers=auth, json={"status": "disabled"})
    assert (await client.get("/api/cards", headers=hdr)).status_code == 403


async def test_non_admin_cannot_manage_users(client, auth):
    token = await _member_token(client)
    hdr = {"Authorization": f"Bearer {token}"}
    mid = await _member_id(client, auth)
    await client.patch(f"/api/users/{mid}", headers=auth, json={"status": "active"})
    # A member may not change roles/permissions.
    r = await client.patch(
        f"/api/users/{mid}", headers=hdr, json={"role": "admin"}
    )
    assert r.status_code == 403
    assert (await client.get("/api/users/modules", headers=hdr)).status_code == 403


async def test_modules_catalogue(client, auth):
    cat = (await client.get("/api/users/modules", headers=auth)).json()
    keys = {m["key"] for m in cat["modules"]}
    assert {"crm", "asset_tracker", "cards"} <= keys
    assert "crm" in cat["role_defaults"]["admin"]
    assert "crm" not in cat["role_defaults"]["member"]


async def test_appearance_default_and_admin_update(client, auth):
    # Default appearance is readable by any signed-in user.
    d = (await client.get("/api/settings/appearance", headers=auth)).json()
    assert d["mode"] == "light" and d["accent"] == "#0b5cab"

    # Admin can set the org default.
    r = await client.put(
        "/api/settings/appearance",
        headers=auth,
        json={"mode": "dark", "accent": "#7c3aed", "density": "compact"},
    )
    assert r.status_code == 200 and r.json()["mode"] == "dark"
    again = (await client.get("/api/settings/appearance", headers=auth)).json()
    assert again["accent"] == "#7c3aed" and again["density"] == "compact"

    # Invalid values are rejected.
    bad = await client.put(
        "/api/settings/appearance", headers=auth, json={"mode": "neon"}
    )
    assert bad.status_code == 422


async def test_appearance_update_is_admin_only(client, auth):
    token = await _member_token(client)
    hdr = {"Authorization": f"Bearer {token}"}
    mid = await _member_id(client, auth)
    await client.patch(f"/api/users/{mid}", headers=auth, json={"status": "active"})
    # Member can read the default but not change it.
    assert (await client.get("/api/settings/appearance", headers=hdr)).status_code == 200
    assert (
        await client.put("/api/settings/appearance", headers=hdr, json={"mode": "dark"})
    ).status_code == 403


async def test_audit_admin_only(client, auth):
    # Generate an activity entry, then read the audit log as admin.
    await client.post("/api/products", headers=auth, json={"name": "Auditable"})
    page = (await client.get("/api/audit", headers=auth)).json()
    assert "items" in page and "actions" in page
    # Member is blocked.
    token = await _member_token(client)
    hdr = {"Authorization": f"Bearer {token}"}
    mid = await _member_id(client, auth)
    await client.patch(f"/api/users/{mid}", headers=auth, json={"status": "active"})
    assert (await client.get("/api/audit", headers=hdr)).status_code == 403


async def test_create_employee_manual(client, auth):
    r = await client.post(
        "/api/users",
        headers=auth,
        json={"email": "Newjoiner@AGHolding.net", "display_name": "New Joiner", "job_title": "Analyst", "department": "Finance"},
    )
    assert r.status_code == 201
    body = r.json()
    assert body["email"] == "newjoiner@agholding.net" and body["status"] == "active"
    # Duplicate official email rejected.
    dup = await client.post(
        "/api/users",
        headers=auth,
        json={"display_name": "Dup", "email": "newjoiner@agholding.net"},
    )
    assert dup.status_code == 409
    # Member can't create users.
    token = await _member_token(client)
    hdr = {"Authorization": f"Bearer {token}"}
    mid = await _member_id(client, auth)
    await client.patch(f"/api/users/{mid}", headers=auth, json={"status": "active"})
    assert (await client.post("/api/users", headers=hdr, json={"email": "x@agholding.net"})).status_code == 403


async def test_create_employee_validation_and_personal_only(client, auth):
    # No name -> 422.
    assert (await client.post("/api/users", headers=auth, json={"email": "x@agholding.net"})).status_code == 422
    # No email at all -> 422.
    assert (await client.post("/api/users", headers=auth, json={"display_name": "No Email"})).status_code == 422
    # Invalid email -> 422.
    assert (await client.post("/api/users", headers=auth, json={"display_name": "Bad", "personal_email": "nope"})).status_code == 422
    # Personal email only (official not yet assigned) -> allowed.
    r = await client.post(
        "/api/users",
        headers=auth,
        json={"given_name": "Sara", "surname": "Khan", "personal_email": "sara@gmail.com", "passport_no": "A1234567", "nationality": "AE"},
    )
    assert r.status_code == 201
    body = r.json()
    assert body["email"] is None and body["personal_email"] == "sara@gmail.com"
    assert body["display_name"] == "Sara Khan" and body["passport_no"] == "A1234567"


async def test_sync_endpoints_report_not_configured(client, auth):
    me = (await client.get("/api/auth/me", headers=auth)).json()
    az = await client.post(f"/api/users/{me['id']}/sync-azure", headers=auth)
    # Already linked (dev admin has azure_oid None) -> attempts, Azure not configured.
    assert az.status_code in (400, 200)
    bamboo = await client.post(f"/api/users/{me['id']}/sync-bamboo", headers=auth)
    assert bamboo.status_code == 400 and "BambooHR" in bamboo.json()["detail"]
    # BambooHR settings are admin-managed.
    assert (await client.get("/api/settings/bamboo", headers=auth)).status_code == 200
