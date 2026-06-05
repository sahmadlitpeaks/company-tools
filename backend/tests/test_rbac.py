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
