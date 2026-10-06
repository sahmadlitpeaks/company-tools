"""Project tracker: per-project access, issue hierarchy, history and notifications."""
import pytest

from helpers import make_member

pytestmark = pytest.mark.asyncio


async def _me(client, headers):
    return (await client.get("/api/auth/me", headers=headers)).json()


async def _project(client, auth, key="LIMS", **extra):
    r = await client.post("/api/pm/projects", headers=auth, json={"key": key, "name": f"{key} project", **extra})
    assert r.status_code == 201, r.text
    return r.json()


async def _team(client, auth, project_id):
    """dev (member), stakeholder (viewer) and outsider (not on the project)."""
    dev, dev_id = await make_member(client, auth, "dev@agholding.net")
    viewer, viewer_id = await make_member(client, auth, "drt@agholding.net")
    outsider, _ = await make_member(client, auth, "other@agholding.net")
    for user_id, role in ((dev_id, "member"), (viewer_id, "viewer")):
        r = await client.post(
            f"/api/pm/projects/{project_id}/members", headers=auth,
            json={"user_id": user_id, "role": role},
        )
        assert r.status_code == 201, r.text
    return (dev, dev_id), (viewer, viewer_id), outsider


async def _issue(client, headers, project_id, **body):
    r = await client.post(f"/api/pm/projects/{project_id}/issues", headers=headers, json=body)
    assert r.status_code == 201, r.text
    return r.json()


async def test_only_admins_create_projects_and_keys_are_validated(client, auth):
    member, _ = await make_member(client, auth, "dev@agholding.net")
    r = await client.post("/api/pm/projects", headers=member, json={"key": "ABC", "name": "Nope"})
    assert r.status_code == 403
    for key in ("1AB", "A", "TOOLONGKEY1", "AB-1"):
        r = await client.post("/api/pm/projects", headers=auth, json={"key": key, "name": "Bad"})
        assert r.status_code == 422, key
    project = await _project(client, auth, key="lims")
    assert project["key"] == "LIMS" and project["my_role"] == "admin"
    r = await client.post("/api/pm/projects", headers=auth, json={"key": "LIMS", "name": "Again"})
    assert r.status_code == 409
    me = await _me(client, auth)
    members = (await client.get(f"/api/pm/projects/{project['id']}/members", headers=auth)).json()
    assert members == [
        {"user_id": me["id"], "name": members[0]["name"], "email": me["email"], "role": "admin"}
    ]


async def test_projects_are_visible_only_to_their_members(client, auth):
    project = await _project(client, auth)
    (dev, _), (viewer, _), outsider = await _team(client, auth, project["id"])
    issue = await _issue(client, auth, project["id"], summary="Upload files")

    assert [p["key"] for p in (await client.get("/api/pm/projects", headers=dev)).json()] == ["LIMS"]
    viewer_list = (await client.get("/api/pm/projects", headers=viewer)).json()
    assert viewer_list[0]["my_role"] == "viewer"
    assert (await client.get("/api/pm/projects", headers=outsider)).json() == []
    # Other teams' projects and issues are reported as missing, not forbidden.
    assert (await client.get("/api/pm/projects/LIMS", headers=outsider)).status_code == 404
    assert (await client.get(f"/api/pm/issues/{issue['key']}", headers=outsider)).status_code == 404
    assert (await client.get(f"/api/pm/projects/{project['id']}/issues", headers=outsider)).status_code == 404
    r = await client.post(
        f"/api/pm/projects/{project['id']}/issues", headers=outsider, json={"summary": "Sneaky"}
    )
    assert r.status_code == 404
    # Members can't browse the people directory; project administrators can.
    assert (await client.get("/api/pm/people", headers=dev)).status_code == 403
    assert (await client.get("/api/pm/people", headers=auth)).status_code == 200


async def test_module_switch_gates_the_tracker(client, auth):
    member, member_id = await make_member(client, auth, "dev@agholding.net")
    await client.patch(
        f"/api/users/{member_id}", headers=auth, json={"revoked_permissions": ["projects"]}
    )
    assert (await client.get("/api/pm/projects", headers=member)).status_code == 403


async def test_issue_hierarchy_keys_and_validation(client, auth):
    project = await _project(client, auth)
    pid = project["id"]
    epic = await _issue(client, auth, pid, issue_type="epic", summary="AI file analysis")
    story = await _issue(
        client, auth, pid, issue_type="story", summary="Analyse PDFs",
        parent_id=epic["id"], story_points=5, labels=["ai", "ai", " pdf parsing "],
    )
    sub = await _issue(client, auth, pid, issue_type="subtask", summary="Extract text", parent_id=story["id"])
    assert [epic["key"], story["key"], sub["key"]] == ["LIMS-1", "LIMS-2", "LIMS-3"]
    assert story["labels"] == ["ai", "pdf-parsing"] and story["story_points"] == 5
    assert story["parent"]["key"] == "LIMS-1" and story["reporter_name"]

    bad = [
        {"issue_type": "subtask", "summary": "Orphan"},
        {"issue_type": "subtask", "summary": "Under epic", "parent_id": epic["id"]},
        {"issue_type": "story", "summary": "Under story", "parent_id": story["id"]},
        {"issue_type": "epic", "summary": "Nested epic", "parent_id": epic["id"]},
        {"issue_type": "feature", "summary": "Unknown type"},
        {"summary": "Bad status", "status": "blocked"},
        {"summary": "Backwards", "start_date": "2026-10-10", "due_date": "2026-10-01"},
    ]
    for body in bad:
        r = await client.post(f"/api/pm/projects/{pid}/issues", headers=auth, json=body)
        assert r.status_code == 422, body

    detail = (await client.get("/api/pm/issues/lims-2", headers=auth)).json()
    assert detail["project_key"] == "LIMS" and [c["key"] for c in detail["children"]] == ["LIMS-3"]
    epic_detail = (await client.get(f"/api/pm/issues/{epic['id']}", headers=auth)).json()
    assert epic_detail["child_count"] == 1
    # A story with sub-tasks can't become a sub-task or an epic.
    r = await client.patch(f"/api/pm/issues/{story['id']}", headers=auth, json={"issue_type": "epic"})
    assert r.status_code == 409
    # Same level is fine.
    r = await client.patch(f"/api/pm/issues/{story['id']}", headers=auth, json={"issue_type": "bug"})
    assert r.status_code == 200 and r.json()["issue_type"] == "bug"

    stories = (await client.get(f"/api/pm/projects/{pid}/issues?parent_id={epic['id']}", headers=auth)).json()
    assert [i["key"] for i in stories] == ["LIMS-2"]
    found = (await client.get(f"/api/pm/projects/{pid}/issues?q=lims-3", headers=auth)).json()
    assert [i["key"] for i in found] == ["LIMS-3"]
    labelled = (await client.get(f"/api/pm/projects/{pid}/issues?label=ai", headers=auth)).json()
    assert [i["key"] for i in labelled] == ["LIMS-2"]
    project = (await client.get("/api/pm/projects/LIMS", headers=auth)).json()
    # Epics are containers, so they don't count towards progress.
    assert project["issue_count"] == 2


async def test_roles_people_history_and_notifications(client, auth):
    project = await _project(client, auth)
    pid = project["id"]
    (dev, dev_id), (viewer, viewer_id), outsider = await _team(client, auth, pid)

    # Viewers read and comment but cannot create or edit issues.
    assert (await client.post(f"/api/pm/projects/{pid}/issues", headers=viewer, json={"summary": "x"})).status_code == 403
    # A stakeholder can be the reporter; only members can be assignees.
    r = await client.post(
        f"/api/pm/projects/{pid}/issues", headers=dev,
        json={"summary": "Export reports", "reporter_id": viewer_id, "assignee_id": viewer_id},
    )
    assert r.status_code == 422
    issue = await _issue(client, dev, pid, summary="Export reports", reporter_id=viewer_id)
    assert (await client.patch(f"/api/pm/issues/{issue['id']}", headers=viewer, json={"status": "done"})).status_code == 403

    detail = (await client.get(f"/api/pm/issues/{issue['key']}", headers=viewer)).json()
    assert detail["watching"] and {w["user_id"] for w in detail["watchers"]} == {dev_id, viewer_id}

    outsider_id = (await _me(client, outsider))["id"]
    r = await client.patch(
        f"/api/pm/issues/{issue['id']}", headers=dev,
        json={"status": "in_progress", "assignee_id": dev_id, "story_points": 3, "summary": "Export reports to PDF"},
    )
    assert r.status_code == 200, r.text
    r = await client.patch(f"/api/pm/issues/{issue['id']}", headers=dev, json={"status": "done"})
    assert r.json()["resolved_at"]
    r = await client.patch(f"/api/pm/issues/{issue['id']}", headers=dev, json={"status": "in_review"})
    assert r.json()["resolved_at"] is None
    # The assignee must be a project member or administrator.
    r = await client.patch(f"/api/pm/issues/{issue['id']}", headers=dev, json={"assignee_id": outsider_id})
    assert r.status_code == 422

    history = (await client.get(f"/api/pm/issues/{issue['id']}/history", headers=viewer)).json()
    changes = {(h["field"], h["old_value"], h["new_value"]) for h in history}
    assert ("status", "todo", "in_progress") in changes
    assert ("assignee", None, "dev") in changes
    assert ("story points", None, "3") in changes
    assert ("summary", "Export reports", "Export reports to PDF") in changes
    assert all(h["actor_name"] == "dev" for h in history)

    # The stakeholder is told about moves; the person who moved it is not.
    notes = (await client.get("/api/notifications", headers=viewer)).json()
    assert any("moved an issue" in n["title"] and n["link"] == "/projects/LIMS?issue=LIMS-1" for n in notes)
    assert not any("moved an issue" in n["title"] for n in (await client.get("/api/notifications", headers=dev)).json())

    comment = await client.post(f"/api/pm/issues/{issue['id']}/comments", headers=viewer, json={"body": "Looks good"})
    assert comment.status_code == 201
    dev_notes = (await client.get("/api/notifications", headers=dev)).json()
    assert any("commented" in n["title"] for n in dev_notes)
    assert (await client.patch(f"/api/pm/comments/{comment.json()['id']}", headers=dev, json={"body": "Edited"})).status_code == 403
    comments = (await client.get(f"/api/pm/issues/{issue['id']}/comments", headers=dev)).json()
    assert [c["body"] for c in comments] == ["Looks good"] and comments[0]["author_name"] == "drt"

    # Viewers manage only their own watching.
    assert (await client.delete(f"/api/pm/issues/{issue['id']}/watchers/{dev_id}", headers=viewer)).status_code == 403
    assert (await client.delete(f"/api/pm/issues/{issue['id']}/watchers/{viewer_id}", headers=viewer)).status_code == 204
    assert not (await client.get(f"/api/pm/issues/{issue['id']}", headers=viewer)).json()["watching"]


async def test_links_and_deletion(client, auth):
    project = await _project(client, auth)
    pid = project["id"]
    (dev, _), _, _ = await _team(client, auth, pid)
    epic = await _issue(client, auth, pid, issue_type="epic", summary="Epic")
    story = await _issue(client, dev, pid, issue_type="story", summary="Story", parent_id=epic["id"])
    sub = await _issue(client, dev, pid, issue_type="subtask", summary="Sub", parent_id=story["id"])
    other = await _issue(client, auth, pid, summary="Other")

    r = await client.post(f"/api/pm/issues/{other['id']}/links", headers=dev, json={"target_id": story["id"], "relation": "is_blocked_by"})
    assert r.status_code == 201 and r.json()["relation"] == "is_blocked_by"
    dup = await client.post(f"/api/pm/issues/{story['id']}/links", headers=dev, json={"target_id": other["id"], "relation": "blocks"})
    assert dup.status_code == 409
    story_links = (await client.get(f"/api/pm/issues/{story['id']}", headers=dev)).json()["links"]
    assert [(link["relation"], link["issue"]["key"]) for link in story_links] == [("blocks", other["key"])]

    # Members can't delete issues they didn't create.
    assert (await client.delete(f"/api/pm/issues/{other['id']}", headers=dev)).status_code == 403
    # Deleting a story takes its sub-tasks with it.
    assert (await client.delete(f"/api/pm/issues/{story['id']}", headers=dev)).status_code == 204
    assert (await client.get(f"/api/pm/issues/{sub['id']}", headers=auth)).status_code == 404
    assert (await client.get(f"/api/pm/issues/{other['id']}", headers=auth)).json()["links"] == []
    # Deleting an epic keeps its issues.
    kept = await _issue(client, dev, pid, summary="Kept", parent_id=epic["id"])
    assert (await client.delete(f"/api/pm/issues/{epic['id']}", headers=auth)).status_code == 204
    assert (await client.get(f"/api/pm/issues/{kept['id']}", headers=auth)).json()["parent_id"] is None


async def test_membership_rules_and_archiving(client, auth):
    project = await _project(client, auth)
    pid = project["id"]
    (dev, dev_id), _, _ = await _team(client, auth, pid)
    admin_id = (await _me(client, auth))["id"]
    # The last administrator can't be demoted or removed.
    r = await client.patch(f"/api/pm/projects/{pid}/members/{admin_id}", headers=auth, json={"role": "member"})
    assert r.status_code == 409
    assert (await client.delete(f"/api/pm/projects/{pid}/members/{admin_id}", headers=auth)).status_code == 409
    # Members can't manage the team.
    assert (await client.post(f"/api/pm/projects/{pid}/members", headers=dev, json={"user_id": admin_id})).status_code == 403
    assert (await client.patch(f"/api/pm/projects/{pid}", headers=dev, json={"name": "Renamed"})).status_code == 403

    issue = await _issue(client, dev, pid, summary="Watch me")
    assert (await client.delete(f"/api/pm/projects/{pid}/members/{dev_id}", headers=auth)).status_code == 204
    detail = (await client.get(f"/api/pm/issues/{issue['id']}", headers=auth)).json()
    assert dev_id not in {w["user_id"] for w in detail["watchers"]}
    assert (await client.get(f"/api/pm/issues/{issue['id']}", headers=dev)).status_code == 404

    r = await client.patch(f"/api/pm/projects/{pid}", headers=auth, json={"status": "archived"})
    assert r.json()["status"] == "archived"
    assert (await client.get("/api/pm/projects", headers=auth)).json() == []
    assert len((await client.get("/api/pm/projects?status=archived", headers=auth)).json()) == 1
    r = await client.post(f"/api/pm/projects/{pid}/issues", headers=auth, json={"summary": "Late"})
    assert r.status_code == 409


async def test_issue_attachments_follow_project_access(client, auth):
    project = await _project(client, auth)
    (dev, _), (viewer, _), outsider = await _team(client, auth, project["id"])
    issue = await _issue(client, dev, project["id"], summary="Spec")
    url = f"/api/attachments/by/pm_issue/{issue['id']}"
    files = {"file": ("spec.txt", b"requirements", "text/plain")}
    up = await client.post(url, headers=dev, files=files)
    assert up.status_code == 201, up.text
    assert len((await client.get(url, headers=viewer)).json()) == 1
    assert (await client.get(f"/api/attachments/{up.json()['id']}/download", headers=viewer)).status_code == 200
    # Viewers read attachments but don't add them; outsiders get nothing.
    assert (await client.post(url, headers=viewer, files=files)).status_code == 403
    assert (await client.get(url, headers=outsider)).status_code in (403, 404)
    assert (await client.get(f"/api/attachments/{up.json()['id']}/download", headers=outsider)).status_code in (403, 404)
