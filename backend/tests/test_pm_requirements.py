"""Requirements are the source brief; tasks and decisions retain traceability."""
import uuid

import pytest
import pytest_asyncio

from helpers import make_member

pytestmark = pytest.mark.asyncio


@pytest_asyncio.fixture
async def setup(client, auth):
    project = (await client.post("/api/pm/projects", headers=auth, json={"key": "REQ", "name": "Requirements"})).json()
    member, uid = await make_member(client, auth, "requirement-member@agholding.net")
    viewer, vid = await make_member(client, auth, "requirement-viewer@agholding.net")
    outsider, _ = await make_member(client, auth, "requirement-outsider@agholding.net", role="manager")
    for user_id, role in ((uid, "member"), (vid, "viewer")):
        assert (await client.post(f"/api/pm/projects/{project['id']}/members", headers=auth, json={"user_id": user_id, "role": role})).status_code == 201
    content = {"title": "Jira clone", "original_request": "Build a Jira clone", "context": "Coordinate delivery",
               "functional_requirements": "Manage boards, tasks and assignments", "technical_requirements": "PostgreSQL and React",
               "scope": "Internal project management", "expected_outcome": "One place to track delivery",
               "acceptance_criteria": "Users can create and move tasks", "supporting_information": "https://example.test/spec",
               "status": "ready", "owner_id": uid}
    response = await client.post(f"/api/pm/projects/{project['id']}/requirements", headers=member, json=content)
    assert response.status_code == 201, response.text
    return project, member, viewer, outsider, content, response.json()


async def test_complete_workflow_persists_multiple_tasks_decisions_files_history(client, auth, setup):
    project, member, viewer, _, content, row = setup
    assert row["key"] == "REQ-REQ-1" and row["events"][0]["details"]["content"]["original_request"] == content["original_request"]
    issues = []
    for name in ("Frontend board", "Backend API", "Database design"):
        response = await client.post(f"/api/pm/projects/{project['id']}/issues", headers=member,
                                     json={"summary": name, "requirement_id": row["id"]})
        assert response.status_code == 201, response.text
        issues.append(response.json())
    assert (await client.patch(f"/api/pm/issues/{issues[0]['id']}", headers=member, json={"status": "done"})).status_code == 200
    response = await client.post(f"/api/pm/projects/{project['id']}/decisions", headers=member,
                                 json={"title": "Database architecture", "context": "Concurrent task updates", "approach": "Use PostgreSQL",
                                       "rationale": "Transactional consistency", "owner_id": content["owner_id"], "requirement_id": row["id"], "issue_ids": [issues[2]["id"]]})
    assert response.status_code == 201, response.text
    decision = response.json()
    attachment = await client.post(f"/api/attachments/by/pm_requirement/{row['id']}", headers=member,
                                   files={"file": ("request.txt", b"Original full request", "text/plain")})
    assert attachment.status_code == 201, attachment.text
    assert (await client.get(f"/api/attachments/{attachment.json()['id']}/download", headers=viewer)).content == b"Original full request"
    current = (await client.get(f"/api/pm/requirements/{row['id']}", headers=viewer)).json()
    assert current["task_count"] == 3 and current["task_done"] == 1 and current["decision_count"] == 1
    assert len(current["issues"]) == 3 and current["decisions"][0]["id"] == decision["id"]
    assert "attachment_added" in [event["action"] for event in current["events"]]
    for path in (f"issues/{issues[0]['id']}", f"decisions/{decision['id']}"):
        reverse = (await client.get(f"/api/pm/{path}/requirements", headers=viewer)).json()
        assert reverse[0]["id"] == row["id"]
    updated = await client.patch(f"/api/pm/requirements/{row['id']}", headers=member,
                                 json={**content, "version": current["version"], "scope": "Internal use only"})
    assert updated.status_code == 200, updated.text
    event = updated.json()["events"][-1]
    assert event["details"]["before"]["scope"] == content["scope"]
    assert event["details"]["after"]["scope"] == "Internal use only"
    assert (await client.patch(f"/api/pm/requirements/{row['id']}", headers=member,
                              json={**content, "version": current["version"]})).status_code == 409
    assert (await client.delete(f"/api/pm/requirements/{row['id']}/links/decisions/{decision['id']}", headers=member)).status_code == 204
    assert (await client.get(f"/api/pm/decisions/{decision['id']}", headers=member)).json()["status"] == "draft"
    assert (await client.get(f"/api/pm/decisions/{decision['id']}/requirements", headers=member)).json() == []


async def test_permissions_cross_project_and_atomic_creation(client, auth, setup):
    project, member, viewer, outsider, content, row = setup
    path = f"/api/pm/requirements/{row['id']}"
    for route in (path, f"/api/attachments/by/pm_requirement/{row['id']}"):
        assert (await client.get(route, headers=outsider)).status_code == 404
    assert (await client.get("/api/pm/requirements", headers=outsider)).json()["items"] == []
    assert (await client.patch(path, headers=viewer, json={**content, "version": 1})).status_code == 403
    assert (await client.post(f"/api/pm/projects/{project['id']}/requirements", headers=viewer, json=content)).status_code == 403
    assert (await client.post(f"/api/attachments/by/pm_requirement/{row['id']}", headers=viewer, files={"file": ("x.txt", b"x")})).status_code == 403
    other = (await client.post("/api/pm/projects", headers=auth, json={"key": "OTHER", "name": "Other"})).json()
    other_issue = (await client.post(f"/api/pm/projects/{other['id']}/issues", headers=auth, json={"summary": "Private"})).json()
    assert (await client.post(f"{path}/links/issues", headers=member, json={"target_id": other_issue["id"]})).status_code == 422
    for requirement_id in (str(uuid.uuid4()), row["id"]):
        response = await client.post(f"/api/pm/projects/{other['id']}/issues", headers=auth,
                                     json={"summary": "Should not exist", "requirement_id": requirement_id})
        assert response.status_code == 422
    issues = (await client.get(f"/api/pm/projects/{other['id']}/issues", headers=auth)).json()
    assert [issue["summary"] for issue in issues] == ["Private"]
    assert (await client.post(f"/api/pm/projects/{project['id']}/requirements", headers=member,
                              json={**content, "owner_id": other_issue["reporter_id"]})).status_code == 201  # platform admin owner is valid


async def test_drafts_readiness_search_pagination_and_archive(client, auth, setup):
    project, member, viewer, _, content, row = setup
    base = f"/api/pm/projects/{project['id']}"
    draft = await client.post(f"{base}/requirements", headers=member, json={"title": "Unfinished"})
    assert draft.status_code == 201
    assert (await client.patch(f"/api/pm/requirements/{draft.json()['id']}", headers=member,
                              json={"title": "Unfinished", "status": "ready", "version": 1})).status_code == 422
    for params, total in (({"q": "Jira"}, 1), ({"q": row["key"]}, 1), ({"q": "%"}, 0), ({"status": "draft"}, 1), ({"limit": 1, "offset": 1}, 2)):
        response = await client.get("/api/pm/requirements", headers=viewer, params=params)
        assert response.status_code == 200 and response.json()["total"] == total, response.text
    path = f"/api/pm/requirements/{row['id']}"
    archived = await client.patch(path, headers=member, json={**content, "version": 1, "status": "archived"})
    assert archived.status_code == 200
    assert (await client.post(f"{base}/issues", headers=member, json={"summary": "No", "requirement_id": row["id"]})).status_code == 409
    assert (await client.post(f"/api/attachments/by/pm_requirement/{row['id']}", headers=member, files={"file": ("x.txt", b"x")})).status_code == 409
    restored = await client.patch(path, headers=member, json={**content, "version": archived.json()["version"]})
    assert restored.status_code == 200
    assert (await client.patch(base, headers=auth, json={"status": "archived"})).status_code == 200
    assert (await client.get(f"/api/pm/requirements?project_id={project['id']}", headers=viewer)).json()["total"] == 2
    assert (await client.patch(path, headers=member, json={**content, "version": restored.json()["version"]})).status_code == 409


async def test_link_existing_approved_decision_keeps_approval_and_is_idempotent(client, auth, setup):
    project, member, viewer, outsider, content, row = setup
    members = (await client.get(f"/api/pm/projects/{project['id']}/members", headers=member)).json()
    approver_id = next(m["user_id"] for m in members if m["role"] == "viewer")
    decision = (await client.post(f"/api/pm/projects/{project['id']}/decisions", headers=member,
                                 json={"title": "Architecture", "context": "Data integrity", "approach": "Transactions", "rationale": "Consistency",
                                       "owner_id": content["owner_id"], "approver_id": approver_id})).json()
    pending = (await client.post(f"/api/pm/decisions/{decision['id']}/submit", headers=member,
                                json={"version": decision["version"], "change_summary": "Architecture review"})).json()
    approved = (await client.post(f"/api/pm/decisions/{decision['id']}/approval", headers=viewer,
                                 json={"version": pending["version"], "revision_number": 1, "outcome": "approved"})).json()
    path = f"/api/pm/requirements/{row['id']}/links/decisions"
    assert (await client.post(path, headers=viewer, json={"target_id": decision["id"]})).status_code == 403
    assert (await client.post(path, headers=outsider, json={"target_id": decision["id"]})).status_code == 404
    first = (await client.post(path, headers=member, json={"target_id": decision["id"]})).json()
    duplicate = (await client.post(path, headers=member, json={"target_id": decision["id"]})).json()
    assert first["version"] == duplicate["version"] and len(duplicate["decisions"]) == 1
    assert (await client.delete(f"{path}/{decision['id']}", headers=member)).status_code == 204
    current = (await client.get(f"/api/pm/decisions/{decision['id']}", headers=member)).json()
    for field in ("status", "version", "approved_at", "approved_revision_number", "revisions"):
        assert current[field] == approved[field]


async def test_partial_edit_preserves_brief_and_null_title_is_rejected(client, setup):
    _, member, _, _, content, row = setup
    path = f"/api/pm/requirements/{row['id']}"
    edited = await client.patch(path, headers=member, json={"version": 1, "title": "Updated title"})
    assert edited.status_code == 200, edited.text
    for field in ("original_request", "context", "functional_requirements", "scope", "status", "owner_id"):
        assert edited.json()[field] == content[field]
    assert (await client.patch(path, headers=member, json={"version": edited.json()["version"], "title": None})).status_code == 422
