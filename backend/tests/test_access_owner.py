"""Owner and Administrator roles; admin screens checked by named permission (PRM-05/10)."""
from helpers import make_member


async def _role_id(client, auth, key):
    roles = (await client.get("/api/access/roles", headers=auth)).json()
    return next(r["id"] for r in roles if r["key"] == key)


async def _me(client, auth):
    return (await client.get("/api/auth/me", headers=auth)).json()


async def test_administrator_role_opens_admin_screens_without_the_admin_flag(client, auth):
    ops, ops_id = await make_member(client, auth, "ops@agholding.net")
    for url in ("/api/departments", "/api/audit", "/api/settings/bamboo", "/api/backups", "/api/webhooks"):
        assert (await client.get(url, headers=ops)).status_code == 403, url
    administrator = await _role_id(client, auth, "administrator")
    r = await client.put(f"/api/access/users/{ops_id}", headers=auth, json={"role_ids": [administrator]})
    assert r.status_code == 200, r.text
    me = await _me(client, ops)
    assert not me["is_admin"] and {"users.manage", "settings.manage", "audit.view"} <= set(me["platform_permissions"])
    for url in ("/api/departments", "/api/audit", "/api/settings/bamboo", "/api/backups", "/api/webhooks"):
        assert (await client.get(url, headers=ops)).status_code == 200, url
    # PRM-03: projects.create came with the role.
    r = await client.post("/api/pm/projects", headers=ops, json={"key": "OPS", "name": "Ops"})
    assert r.status_code == 201


async def test_administrators_cannot_escalate_to_owner(client, auth):
    ops, ops_id = await make_member(client, auth, "ops@agholding.net")
    administrator = await _role_id(client, auth, "administrator")
    owner = await _role_id(client, auth, "owner")
    await client.put(f"/api/access/users/{ops_id}", headers=auth, json={"role_ids": [administrator]})
    me = await _me(client, auth)

    r = await client.post("/api/users", headers=ops, json={"email": "new@agholding.net", "display_name": "New",
                                                          "password": "Str0ng-Passw0rd!", "role": "admin"})
    assert r.status_code == 403 and "Owner" in r.json()["detail"]
    _, other_id = await make_member(client, auth, "other@agholding.net")
    assert (await client.patch(f"/api/users/{other_id}", headers=ops, json={"role": "admin"})).status_code == 403
    assert (await client.put(f"/api/access/users/{other_id}", headers=ops, json={"role_ids": [owner]})).status_code == 403
    # Owner accounts are out of reach: no password reset, edit or delete.
    r = await client.post(f"/api/users/{me['id']}/set-password", headers=ops, json={"password": "An0ther-Passw0rd!"})
    assert r.status_code == 403
    assert (await client.patch(f"/api/users/{me['id']}", headers=ops, json={"status": "disabled"})).status_code == 403
    # Ordinary accounts are still managed.
    assert (await client.patch(f"/api/users/{other_id}", headers=ops, json={"job_title": "Analyst"})).status_code == 200


async def test_owner_role_holds_everything_and_is_protected(client, auth):
    boss, boss_id = await make_member(client, auth, "boss@agholding.net")
    owner = await _role_id(client, auth, "owner")
    r = await client.put(f"/api/access/users/{boss_id}", headers=auth, json={"role_ids": [owner]})
    assert r.status_code == 200 and r.json()["is_admin"]
    me = await _me(client, boss)
    assert "projects" in me["effective_permissions"] and "roles.manage" in me["platform_permissions"]
    assert (await client.get("/api/audit", headers=boss)).status_code == 200

    assert (await client.patch(f"/api/access/roles/{owner}", headers=auth, json={"permissions": []})).status_code == 409
    assert (await client.delete(f"/api/access/roles/{owner}", headers=auth)).status_code == 409
    assert (await client.post(f"/api/access/roles/{owner}/clone", headers=auth)).status_code == 409
    dept = (await client.get("/api/departments", headers=auth)).json()[0]
    r = await client.put(f"/api/access/departments/{dept['id']}/roles", headers=auth, json={"role_ids": [owner]})
    assert r.status_code == 422


async def test_the_platform_always_keeps_an_active_owner(client, auth):
    me = await _me(client, auth)
    boss, boss_id = await make_member(client, auth, "boss@agholding.net")
    owner = await _role_id(client, auth, "owner")
    await client.put(f"/api/access/users/{boss_id}", headers=auth, json={"role_ids": [owner]})
    # Two Owners: the bootstrap admin can step down...
    assert (await client.patch(f"/api/users/{me['id']}", headers=boss, json={"role": "member"})).status_code == 200
    # ...but the last one can't lose the role, be disabled or be deleted.
    r = await client.put(f"/api/access/users/{boss_id}", headers=boss, json={"role_ids": []})
    assert r.status_code == 409 and "Owner" in r.json()["detail"]
    assert (await client.patch(f"/api/users/{boss_id}", headers=boss, json={"status": "disabled"})).status_code == 409
