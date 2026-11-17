"""Roles, grants and per-person overrides (BRD section 7: PRM-01..04, 06, 09, 10)."""
from helpers import make_member


async def _role_id(client, auth, key):
    roles = (await client.get("/api/access/roles", headers=auth)).json()
    return next(r["id"] for r in roles if r["key"] == key)


async def _me(client, headers):
    return (await client.get("/api/auth/me", headers=headers)).json()


async def _project(client, headers, key="LIMS"):
    r = await client.post("/api/pm/projects", headers=headers, json={"key": key, "name": key})
    assert r.status_code == 201, r.text
    return r.json()


async def _add(client, headers, project_id, user_id, role="member", **extra):
    return await client.post(f"/api/pm/projects/{project_id}/members", headers=headers,
                             json={"user_id": user_id, "role": role, **extra})


async def test_catalog_lists_both_scopes_and_starter_roles(client, auth):
    catalog = (await client.get("/api/access/catalog", headers=auth)).json()
    platform = {p["key"] for p in catalog["platform"]}
    project = {p["key"] for p in catalog["project"]}
    assert {"projects.create", "roles.manage", "projects.view_all", "projects", "crm"} <= platform
    assert {"project.view", "issue.delete", "sprint.manage", "members.manage"} <= project
    roles = {r["key"]: r for r in (await client.get("/api/access/roles", headers=auth)).json()}
    assert roles["admin"]["name"] == "Project Admin" and roles["admin"]["is_system"]
    assert roles["member"]["name"] == "Contributor" and "sprint.manage" not in roles["member"]["permissions"]
    assert roles["viewer"]["permissions"] == ["project.view", "issue.comment", "reports.view"]


async def test_project_creator_role_lets_a_member_create_a_project_and_nothing_more(client, auth):
    member, member_id = await make_member(client, auth, "lead@agholding.net")
    r = await client.post("/api/pm/projects", headers=member, json={"key": "NOPE", "name": "Nope"})
    assert r.status_code == 403 and "projects.create" in r.json()["detail"]

    creator = await _role_id(client, auth, "project_creator")
    r = await client.put(f"/api/access/users/{member_id}", headers=auth, json={"role_ids": [creator]})
    assert r.status_code == 200, r.text
    assert r.json()["platform_permissions"] == ["projects.create"]
    assert r.json()["sources"]["projects.create"] == ["Role: Project Creator"]

    me = await _me(client, member)
    assert me["platform_permissions"] == ["projects.create"] and not me["is_admin"]
    project = await _project(client, member, key="TEAM")
    # PRM-06: the creator administers the new project.
    assert project["my_role"] == "admin" and "members.manage" in project["my_permissions"]
    # ... but gains nothing else: the roles screen stays closed.
    r = await client.post("/api/access/roles", headers=member,
                          json={"name": "X", "scope": "project", "permissions": []})
    assert r.status_code == 403


async def test_deny_override_beats_role_and_audit_records_it(client, auth):
    _, member_id = await make_member(client, auth, "lead@agholding.net")
    creator = await _role_id(client, auth, "project_creator")
    r = await client.put(f"/api/access/users/{member_id}", headers=auth,
                         json={"role_ids": [creator], "deny": ["projects.create"]})
    assert r.status_code == 200 and r.json()["platform_permissions"] == []
    r = await client.put(f"/api/access/users/{member_id}", headers=auth,
                         json={"allow": ["projects.create"], "deny": ["projects.create"]})
    assert r.status_code == 422
    r = await client.put(f"/api/access/users/{member_id}", headers=auth, json={"allow": ["no.such"]})
    assert r.status_code == 422
    audit = (await client.get("/api/audit", headers=auth)).json()
    rows = audit if isinstance(audit, list) else audit.get("items", [])
    assert any("platform access" in (row.get("summary") or "") for row in rows)


async def test_department_roles_apply_to_every_member(client, auth):
    member, member_id = await make_member(client, auth, "lead@agholding.net")
    depts = (await client.get("/api/departments", headers=auth)).json()
    dept = depts[0]
    r = await client.post(f"/api/departments/{dept['id']}/members", headers=auth, json={"user_id": member_id})
    assert r.status_code in (200, 201), r.text
    creator = await _role_id(client, auth, "project_creator")
    r = await client.put(f"/api/access/departments/{dept['id']}/roles", headers=auth,
                         json={"role_ids": [creator]})
    assert r.status_code == 200, r.text
    assert (await _me(client, member))["platform_permissions"] == ["projects.create"]


async def test_role_crud_validation_and_in_use_protection(client, auth):
    r = await client.post("/api/access/roles", headers=auth,
                          json={"name": "Sprint Lead", "scope": "project", "permissions": ["no.such"]})
    assert r.status_code == 422
    r = await client.post("/api/access/roles", headers=auth, json={
        "name": "Sprint Lead", "scope": "project",
        "permissions": ["sprint.manage", "project.view", "issue.edit"],
    })
    assert r.status_code == 201, r.text
    role = r.json()
    assert role["key"] == "sprint_lead" and role["permissions"] == ["project.view", "issue.edit", "sprint.manage"]

    clone = (await client.post(f"/api/access/roles/{role['id']}/clone", headers=auth)).json()
    assert clone["name"] == "Sprint Lead (copy)" and clone["key"] == "sprint_lead_copy"
    r = await client.patch(f"/api/access/roles/{clone['id']}", headers=auth,
                           json={"permissions": ["project.view"]})
    assert r.json()["permissions"] == ["project.view"]

    project = await _project(client, auth)
    _, dev_id = await make_member(client, auth, "dev@agholding.net")
    assert (await _add(client, auth, project["id"], dev_id, role="sprint_lead")).status_code == 201
    r = await client.delete(f"/api/access/roles/{role['id']}", headers=auth)
    assert r.status_code == 409 and "in use" in r.json()["detail"]
    assert (await client.delete(f"/api/access/roles/{clone['id']}", headers=auth)).status_code == 204
    starter = await _role_id(client, auth, "viewer")
    assert (await client.delete(f"/api/access/roles/{starter}", headers=auth)).status_code == 409


async def test_project_overrides_allow_and_deny_named_actions(client, auth):
    project = await _project(client, auth)
    pid = project["id"]
    dev, dev_id = await make_member(client, auth, "dev@agholding.net")
    lead, lead_id = await make_member(client, auth, "lead@agholding.net")
    # PRM-04: a Contributor with a sprint.manage allow can run sprints...
    r = await _add(client, auth, pid, dev_id, allow=["sprint.manage"])
    assert r.status_code == 201 and "sprint.manage" in r.json()["permissions"]
    assert (await client.post(f"/api/pm/projects/{pid}/sprints", headers=dev, json={})).status_code == 201
    # ... and a Project Admin with an issue.delete deny can't delete.
    r = await _add(client, auth, pid, lead_id, role="admin", deny=["issue.delete"])
    assert r.status_code == 201
    issue = (await client.post(f"/api/pm/projects/{pid}/issues", headers=dev, json={"summary": "Bug"})).json()
    r = await client.delete(f"/api/pm/issues/{issue['id']}", headers=lead)
    assert r.status_code == 403 and "issue.delete" in r.json()["detail"]
    # The creator can still delete their own issue.
    assert (await client.delete(f"/api/pm/issues/{issue['id']}", headers=dev)).status_code == 204


async def test_status_and_assignee_changes_need_their_own_permissions(client, auth):
    project = await _project(client, auth)
    pid = project["id"]
    dev, dev_id = await make_member(client, auth, "dev@agholding.net")
    assert (await _add(client, auth, pid, dev_id, deny=["issue.transition", "issue.assign"])).status_code == 201
    issue = (await client.post(f"/api/pm/projects/{pid}/issues", headers=dev, json={"summary": "Bug"})).json()
    url = f"/api/pm/issues/{issue['id']}"
    assert (await client.patch(url, headers=dev, json={"summary": "Renamed"})).status_code == 200
    r = await client.patch(url, headers=dev, json={"status": "done"})
    assert r.status_code == 403 and "issue.transition" in r.json()["detail"]
    r = await client.patch(url, headers=dev, json={"assignee_id": dev_id})
    assert r.status_code == 403 and "issue.assign" in r.json()["detail"]


async def test_members_cannot_grant_beyond_their_own_access_and_a_manager_remains(client, auth):
    project = await _project(client, auth)
    pid = project["id"]
    me = await _me(client, auth)
    helper, helper_id = await make_member(client, auth, "helper@agholding.net")
    _, dev_id = await make_member(client, auth, "dev@agholding.net")
    # A member manager without sprint.manage can't hand it out.
    assert (await _add(client, auth, pid, helper_id, allow=["members.manage"])).status_code == 201
    r = await _add(client, helper, pid, dev_id, allow=["sprint.manage"])
    assert r.status_code == 403 and "sprint.manage" in r.json()["detail"]
    assert (await _add(client, helper, pid, dev_id)).status_code == 201
    r = await _add(client, helper, pid, dev_id)
    assert r.status_code == 409  # already on the project
    r = await client.patch(f"/api/pm/projects/{pid}/members/{dev_id}", headers=helper, json={"role": "admin"})
    assert r.status_code == 403
    # The last person who can manage members can't be removed or demoted.
    r = await client.patch(f"/api/pm/projects/{pid}/members/{helper_id}", headers=auth,
                           json={"allow": []})
    assert r.status_code == 200
    r = await client.patch(f"/api/pm/projects/{pid}/members/{me['id']}", headers=auth, json={"role": "viewer"})
    assert r.status_code == 409
    r = await client.delete(f"/api/pm/projects/{pid}/members/{me['id']}", headers=auth)
    assert r.status_code == 409


async def test_view_all_permission_reads_every_project(client, auth):
    project = await _project(client, auth)
    reader, reader_id = await make_member(client, auth, "reader@agholding.net")
    assert (await client.get(f"/api/pm/projects/{project['id']}", headers=reader)).status_code == 404
    await client.put(f"/api/access/users/{reader_id}", headers=auth, json={"allow": ["projects.view_all"]})
    r = await client.get(f"/api/pm/projects/{project['id']}", headers=reader)
    assert r.status_code == 200 and r.json()["my_role"] == "viewer"
    assert [p["key"] for p in (await client.get("/api/pm/projects", headers=reader)).json()] == ["LIMS"]
    r = await client.post(f"/api/pm/projects/{project['id']}/issues", headers=reader, json={"summary": "x"})
    assert r.status_code == 403


async def test_platform_grants_need_roles_manage_and_cannot_exceed_the_granter(client, auth):
    manager, manager_id = await make_member(client, auth, "roles@agholding.net")
    _, other_id = await make_member(client, auth, "other@agholding.net")
    assert (await client.put(f"/api/access/users/{other_id}", headers=manager, json={})).status_code == 403
    await client.put(f"/api/access/users/{manager_id}", headers=auth, json={"allow": ["roles.manage"]})
    r = await client.put(f"/api/access/users/{other_id}", headers=manager, json={"allow": ["projects.create"]})
    assert r.status_code == 403 and "projects.create" in r.json()["detail"]
    r = await client.post("/api/access/roles", headers=manager,
                          json={"name": "Creators", "scope": "platform", "permissions": ["projects.create"]})
    assert r.status_code == 403
    assert (await client.get(f"/api/access/users/{other_id}", headers=manager)).status_code == 200
    # People can always read their own access, but nobody else's.
    plain, plain_id = await make_member(client, auth, "plain@agholding.net")
    assert (await client.get(f"/api/access/users/{plain_id}", headers=plain)).status_code == 200
    assert (await client.get(f"/api/access/users/{other_id}", headers=plain)).status_code == 403
