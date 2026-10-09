"""Saved perspectives, configurable workflow and atomic editing boundaries."""
import uuid

import pytest

from test_pm import _project, _team, _issue

pytestmark = pytest.mark.asyncio


async def config(client, auth, pid):
    return (await client.get(f"/api/pm/projects/{pid}/configuration", headers=auth)).json()


async def save_config(client, auth, pid, data, expected=200):
    response = await client.put(f"/api/pm/projects/{pid}/configuration", headers=auth, json=data)
    assert response.status_code == expected, response.text
    return response


async def test_project_mode_and_default_board(client, auth):
    project = await _project(client, auth, sprints_enabled=False)
    assert not project["sprints_enabled"]
    views = (await client.get(f"/api/pm/projects/{project['id']}/views", headers=auth)).json()
    assert len(views) == 1
    assert views[0]["name"] == "Team board"
    assert views[0]["settings"]["board_type"] == "kanban"
    assert views[0]["can_manage"]


async def test_view_privacy_permissions_and_revoked_membership(client, auth):
    project = await _project(client, auth)
    pid = project["id"]
    (dev, dev_id), (viewer, _), outsider = await _team(client, auth, pid)
    path = f"/api/pm/projects/{pid}/views"
    team = (await client.get(path, headers=viewer)).json()[0]
    assert not team["can_manage"]
    assert (await client.get(path, headers=outsider)).status_code == 404
    body = {"project_id": pid, "name": "My bugs", "visibility": "private", "settings": {"filters": {"issue_type": "bug"}}}
    response = await client.post("/api/pm/views", headers=dev, json=body)
    assert response.status_code == 201, response.text
    own = response.json()
    assert own["can_manage"]
    assert len((await client.get(path, headers=viewer)).json()) == 1
    assert len((await client.get(path, headers=auth)).json()) == 1  # no admin peek into private views
    update = {key: own[key] for key in ("name", "visibility", "settings")}
    assert (await client.patch(f"/api/pm/views/{own['id']}", headers=auth, json=update)).status_code == 404
    assert (await client.patch(f"/api/pm/views/{team['id']}", headers=dev,
                               json={"name": "Hijack", "visibility": "team", "settings": {}})).status_code == 403
    assert (await client.post("/api/pm/views", headers=viewer, json={**body, "visibility": "team"})).status_code == 403
    assert (await client.delete(f"/api/pm/projects/{pid}/members/{dev_id}", headers=auth)).status_code == 204
    assert (await client.patch(f"/api/pm/views/{own['id']}", headers=dev, json=update)).status_code == 404


async def test_columns_mappings_and_view_deletion_preserve_issues(client, auth):
    project = await _project(client, auth, sprints_enabled=False)
    pid = project["id"]
    issue = await _issue(client, auth, pid, summary="Keep this work")
    base = {"project_id": pid, "name": "QA", "visibility": "team", "settings": {"board_type": "kanban"}}
    columns = [{"key": "waiting", "name": "Waiting", "states": ["todo"], "limit": 2},
               {"key": "working", "name": "Working", "states": ["in_progress", "in_review", "done"]}]
    response = await client.post("/api/pm/views", headers=auth, json={**base, "settings": {**base["settings"], "columns": columns}})
    assert response.status_code == 201, response.text
    assert response.json()["settings"]["columns"][0]["limit"] == 2
    assert (await client.post("/api/pm/views", headers=auth, json={**base, "settings": {"board_type": "kanban", "columns": columns[:1]}})).status_code == 422
    duplicate = columns + [{"key": "repeat", "name": "Repeat", "states": ["todo"]}]
    assert (await client.post("/api/pm/views", headers=auth, json={**base, "settings": {"board_type": "kanban", "columns": duplicate}})).status_code == 422
    assert (await client.post("/api/pm/views", headers=auth, json={**base, "settings": {"board_type": "scrum"}})).status_code == 409
    assert (await client.delete(f"/api/pm/views/{response.json()['id']}", headers=auth)).status_code == 204
    assert (await client.get(f"/api/pm/issues/{issue['id']}", headers=auth)).status_code == 200


async def test_named_workflow_transitions_and_legacy_status_edits(client, auth):
    project = await _project(client, auth)
    pid = project["id"]
    data = await config(client, auth, pid)
    data["states"].append({"key": "qa", "name": "QA testing", "category": "in_review", "allowed_next": ["done"]})
    data["states"][0]["allowed_next"] = ["qa"]
    await save_config(client, auth, pid, data)
    issue = await _issue(client, auth, pid, summary="Test workflow")
    path = f"/api/pm/issues/{issue['id']}"
    assert (await client.patch(path, headers=auth, json={"status": "done"})).status_code == 409
    response = await client.patch(path, headers=auth, json={"workflow_state": "qa", "status": "todo"})
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "in_review"
    assert response.json()["workflow_name"] == "QA testing"
    assert response.json()["resolved_at"] is None
    # Editing another field with the same reporting category retains the named state.
    response = await client.patch(path, headers=auth, json={"summary": "Keep QA", "status": "in_review"})
    assert response.json()["workflow_state"] == "qa"
    assert (await client.patch(path, headers=auth, json={"status": "todo"})).status_code == 409
    await save_config(client, auth, pid, {**data, "states": data["states"][:-1]}, expected=422)  # dangling transition
    changed = {**data, "states": [item for item in data["states"] if item["key"] != "qa"]}
    changed["states"][0]["allowed_next"] = None
    await save_config(client, auth, pid, changed, expected=409)
    response = await client.patch(path, headers=auth, json={"status": "done"})
    assert response.json()["workflow_state"] == "done" and response.json()["resolved_at"]


@pytest.mark.parametrize("value", [True, "12", {}, 1e13])
async def test_custom_fields_validate_types_and_preserve_configuration(client, auth, value):
    project = await _project(client, auth)
    pid = project["id"]
    data = await config(client, auth, pid)
    data["fields"] = [{"key": "effort", "name": "Effort", "kind": "number", "required": True}]
    await save_config(client, auth, pid, data)
    assert (await client.post(f"/api/pm/projects/{pid}/issues", headers=auth, json={"summary": "Invalid", "custom_fields": {"effort": value}})).status_code == 422
    assert (await client.post(f"/api/pm/projects/{pid}/issues", headers=auth, json={"summary": "Missing"})).status_code == 422
    issue = await _issue(client, auth, pid, summary="Valid", custom_fields={"effort": 2.5})
    assert issue["custom_fields"] == {"effort": 2.5}
    await save_config(client, auth, pid, {**data, "fields": []}, expected=409)
    # Import must not bypass required fields; it makes no partial issues or members.
    csv_data = "Issue key,Summary,Issue Type\nOLD-1,Imported,Task\n"
    response = await client.post(f"/api/pm/projects/{pid}/import/jira", headers=auth, files={"file": ("jira.csv", csv_data, "text/csv")})
    assert response.status_code == 422 and "custom fields" in response.text
    assert len((await client.get(f"/api/pm/projects/{pid}/issues", headers=auth)).json()) == 1


async def test_bulk_is_atomic_for_issues_history_and_notifications(client, auth):
    project = await _project(client, auth)
    pid = project["id"]
    (dev, dev_id), _, _ = await _team(client, auth, pid)
    data = await config(client, auth, pid)
    data["states"][0]["allowed_next"] = []
    await save_config(client, auth, pid, data)
    first = await _issue(client, auth, pid, summary="Allowed", status="in_progress", assignee_id=dev_id)
    second = await _issue(client, auth, pid, summary="Blocked", assignee_id=dev_id)
    body = {"issue_ids": [first["id"], second["id"]], "changes": {"status": "done"}}
    before = (await client.get("/api/notifications", headers=dev)).json()
    response = await client.post("/api/pm/issues/bulk", headers=auth, json=body)
    assert response.status_code == 409, response.text
    assert (await client.get(f"/api/pm/issues/{first['id']}", headers=auth)).json()["status"] == "in_progress"
    assert (await client.get(f"/api/pm/issues/{first['id']}/history", headers=auth)).json() == []
    assert (await client.get("/api/notifications", headers=dev)).json() == before
    response = await client.post("/api/pm/issues/bulk", headers=auth, json={**body, "changes": {"priority": "high"}})
    assert response.status_code == 200 and response.json()["updated"] == 2
    assert all(item["priority"] == "high" for item in response.json()["items"])
    assert (await client.post("/api/pm/issues/bulk", headers=auth, json={**body, "issue_ids": [first["id"]]*2})).status_code == 422


async def test_paged_search_literal_filters_and_cross_project_visibility(client, auth):
    first = await _project(client, auth, key="ONE")
    second = await _project(client, auth, key="TWO")
    (dev, _), _, outsider = await _team(client, auth, first["id"])
    issue = await _issue(client, auth, first["id"], summary="100%_literal", labels=["مرحبا", "a%b", "quote\"inside"], due_date="2026-10-16")
    await _issue(client, auth, first["id"], summary="No deadline")
    await _issue(client, auth, second["id"], summary="Secret 100%_literal")
    response = await client.get("/api/pm/issues/page", headers=dev, params={"q": "%_", "limit": 1, "offset": 1000})
    assert response.status_code == 200, response.text
    assert response.json()["total"] == 1 and response.json()["offset"] == 0
    assert response.json()["items"][0]["id"] == issue["id"]
    for label in ("مرحبا", "a%b", "quote\"inside"):
        result = await client.get("/api/pm/issues/page", headers=dev, params={"label": label})
        assert result.json()["total"] == 1, result.text
    assert (await client.get("/api/pm/issues/page", headers=dev, params={"label": "a%"})).json()["total"] == 0
    assert (await client.get("/api/pm/issues/page", headers=dev, params={"due_after": "2026-10-01", "due_before": "2026-10-31"})).json()["total"] == 1
    assert (await client.get("/api/pm/issues/page", headers=dev, params={"project_ids": second["id"]})).json()["total"] == 0
    assert (await client.get("/api/pm/issues/page", headers=outsider)).json()["total"] == 0
    for params in ({"assignee": "bad"}, {"due_after": "bad"}, {"order_by": "bad"}, {"limit": 201}):
        assert (await client.get("/api/pm/issues/page", headers=dev, params=params)).status_code == 422
    search = await client.get("/api/search", headers=dev, params={"q": "ONE-1"})
    assert search.status_code == 200 and "ONE-1" in search.text, search.text
    assert "Secret" not in (await client.get("/api/search", headers=dev, params={"q": "literal"})).text


async def test_global_views_private_and_archive_mutations_blocked(client, auth):
    project = await _project(client, auth)
    (dev, _), (viewer, _), _ = await _team(client, auth, project["id"])
    body = {"name": "My deadlines", "visibility": "private", "settings": {"layout": "calendar", "filters": {"assignee": "me"}}}
    response = await client.post("/api/pm/views", headers=dev, json=body)
    assert response.status_code == 201, response.text
    assert (await client.get("/api/pm/views", headers=auth)).json() == []
    assert (await client.post("/api/pm/views", headers=dev, json={**body, "visibility": "team"})).status_code == 422
    assert (await client.post("/api/pm/views", headers=dev, json={**body, "settings": {"layout": "board"}})).status_code == 422
    issue = await _issue(client, auth, project["id"], summary="Archived work")
    assert (await client.post("/api/pm/issues/bulk", headers=viewer, json={"issue_ids": [issue["id"]], "changes": {"priority": "high"}})).status_code == 403
    await client.patch(f"/api/pm/projects/{project['id']}", headers=auth, json={"status": "archived"})
    assert (await client.post("/api/pm/issues/bulk", headers=auth, json={"issue_ids": [issue["id"]], "changes": {"priority": "high"}})).status_code == 409
    assert (await client.post("/api/pm/views", headers=auth, json={**body, "project_id": project["id"]})).status_code == 409
    assert (await client.get("/api/pm/issues/page", headers=dev)).json()["total"] == 0
    assert (await client.get("/api/pm/issues/page", headers=dev, params={"include_archived": True})).json()["total"] == 1


async def test_duplicate_and_mentions_follow_project_boundaries(client, auth):
    project = await _project(client, auth)
    (dev, dev_id), (viewer, _), _ = await _team(client, auth, project["id"])
    issue = await _issue(client, auth, project["id"], summary="Original", description="**Acceptance**", status="done")
    copy = await client.post(f"/api/pm/issues/{issue['id']}/duplicate", headers=dev)
    assert copy.status_code == 201, copy.text
    assert copy.json()["summary"] == "Copy of Original" and copy.json()["status"] == "todo"
    assert copy.json()["description"] == "**Acceptance**" and copy.json()["resolved_at"] is None
    assert (await client.post(f"/api/pm/issues/{issue['id']}/duplicate", headers=viewer)).status_code == 403
    path = f"/api/pm/issues/{issue['id']}/comments"
    assert (await client.post(path, headers=auth, json={"body": "Invalid", "mention_ids": [str(uuid.uuid4())]})).status_code == 422
    response = await client.post(path, headers=auth, json={"body": "@dev please review", "mention_ids": [dev_id, dev_id]})
    assert response.status_code == 201, response.text
    notifications = (await client.get("/api/notifications", headers=dev)).json()
    assert len([item for item in notifications if "mentioned" in item["title"]]) == 1
