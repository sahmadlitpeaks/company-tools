"""Moving issues between projects (BRD section 8: MOV-01..10, MCP-01/02/06)."""
from datetime import date, timedelta

from helpers import make_member


async def _project(client, headers, key):
    r = await client.post("/api/pm/projects", headers=headers, json={"key": key, "name": key})
    assert r.status_code == 201, r.text
    return r.json()


async def _issue(client, headers, pid, **body):
    r = await client.post(f"/api/pm/projects/{pid}/issues", headers=headers, json={"summary": "Work", **body})
    assert r.status_code == 201, r.text
    return r.json()


async def _move(client, headers, ids, target, preview=False, **options):
    url = "/api/pm/issues/move/preview" if preview else "/api/pm/issues/move"
    return await client.post(url, headers=headers, json={"issue_ids": ids, "target_project_id": target, **options})


async def test_move_gives_a_new_key_keeps_identity_and_the_old_key_resolves(client, auth):
    team, lims = await _project(client, auth, "TEAM"), await _project(client, auth, "LIMS")
    for _ in range(3):
        await _issue(client, auth, lims["id"])
    issue = await _issue(client, auth, team["id"], summary="Triaged bug", issue_type="bug", labels=["intake"],
                         story_points=3, priority="high")
    await client.post(f"/api/pm/issues/{issue['id']}/comments", headers=auth, json={"body": "Context"})

    preview = (await _move(client, auth, [issue["id"]], lims["id"], preview=True)).json()
    assert [(i["old_key"], i["new_key"]) for i in preview["issues"]] == [("TEAM-1", "LIMS-4")]
    # Preview changes nothing (MOV-02).
    assert (await client.get("/api/pm/issues/TEAM-1", headers=auth)).json()["key"] == "TEAM-1"

    r = await _move(client, auth, [issue["id"]], lims["id"])
    assert r.status_code == 200, r.text
    assert r.json()["moved"] == [{"id": issue["id"], "old_key": "TEAM-1", "new_key": "LIMS-4"}]

    # MOV-04: the old key resolves to the same issue, which lists it.
    moved = (await client.get("/api/pm/issues/TEAM-1", headers=auth)).json()
    assert moved["id"] == issue["id"] and moved["key"] == "LIMS-4" and moved["project_key"] == "LIMS"
    assert moved["previous_keys"] == ["TEAM-1"]
    assert moved["labels"] == ["intake"] and moved["story_points"] == 3 and moved["priority"] == "high"
    assert len((await client.get(f"/api/pm/issues/{issue['id']}/comments", headers=auth)).json()) == 1
    history = (await client.get(f"/api/pm/issues/{issue['id']}/history", headers=auth)).json()
    assert any(h["field"] == "project" and h["old_value"] == "TEAM-1 (project TEAM)" and h["new_value"] == "LIMS-4"
               for h in history)
    # The next new issue in LIMS continues the sequence.
    assert (await _issue(client, auth, lims["id"]))["key"] == "LIMS-5"
    assert [i["key"] for i in (await client.get(f"/api/pm/projects/{team['id']}/issues", headers=auth)).json()] == []


async def test_move_needs_move_out_on_source_and_move_in_on_target(client, auth):
    team, lims = await _project(client, auth, "TEAM"), await _project(client, auth, "LIMS")
    dev, dev_id = await make_member(client, auth, "dev@agholding.net")
    await client.post(f"/api/pm/projects/{team['id']}/members", headers=auth, json={"user_id": dev_id, "role": "viewer"})
    issue = await _issue(client, auth, team["id"])
    # Not on the target: it doesn't exist as far as dev knows.
    assert (await _move(client, dev, [issue["id"]], lims["id"])).status_code in (403, 404)
    await client.post(f"/api/pm/projects/{lims['id']}/members", headers=auth, json={"user_id": dev_id, "role": "member"})
    r = await _move(client, dev, [issue["id"]], lims["id"])
    assert r.status_code == 403 and "issue.move_out" in r.json()["detail"]
    # A Contributor holds both move permissions.
    await client.patch(f"/api/pm/projects/{team['id']}/members/{dev_id}", headers=auth, json={"role": "member"})
    await client.patch(f"/api/pm/projects/{lims['id']}/members/{dev_id}", headers=auth, json={"deny": ["issue.move_in"]})
    r = await _move(client, dev, [issue["id"]], lims["id"])
    assert r.status_code == 403 and "issue.move_in" in r.json()["detail"]
    await client.patch(f"/api/pm/projects/{lims['id']}/members/{dev_id}", headers=auth, json={"deny": []})
    assert (await _move(client, dev, [issue["id"]], lims["id"])).status_code == 200


async def test_subtasks_follow_and_epics_choose_whether_children_follow(client, auth):
    team, lims = await _project(client, auth, "TEAM"), await _project(client, auth, "LIMS")
    epic = await _issue(client, auth, team["id"], issue_type="epic", summary="Epic")
    story = await _issue(client, auth, team["id"], issue_type="story", parent_id=epic["id"])
    sub = await _issue(client, auth, team["id"], issue_type="subtask", parent_id=story["id"])
    r = await _move(client, auth, [sub["id"]], lims["id"])
    assert r.status_code == 422 and "parent" in r.json()["detail"]

    # A story leaves its epic behind; its sub-task follows it.
    r = await _move(client, auth, [story["id"]], lims["id"])
    assert [m["old_key"] for m in r.json()["moved"]] == ["TEAM-2", "TEAM-3"]
    moved_story = (await client.get(f"/api/pm/issues/{story['id']}", headers=auth)).json()
    assert moved_story["parent"] is None and [c["key"] for c in moved_story["children"]] == ["LIMS-2"]

    # An epic moved without its issues leaves them unlinked.
    other = await _issue(client, auth, team["id"], issue_type="task", parent_id=epic["id"])
    r = await _move(client, auth, [epic["id"]], lims["id"], move_children=False)
    assert [m["new_key"] for m in r.json()["moved"]] == ["LIMS-3"]
    assert (await client.get(f"/api/pm/issues/{other['id']}", headers=auth)).json()["parent"] is None


async def test_status_component_and_assignee_are_mapped_and_drops_recorded(client, auth):
    team, lims = await _project(client, auth, "TEAM"), await _project(client, auth, "LIMS")
    config = (await client.get(f"/api/pm/projects/{team['id']}/configuration", headers=auth)).json()
    config["states"].append({"key": "qa", "name": "QA", "category": "in_review", "allowed_next": None})
    config["components"] = [{"key": "api", "name": "API", "lead_id": None}]
    r = await client.put(f"/api/pm/projects/{team['id']}/configuration", headers=auth, json=config)
    assert r.status_code == 200, r.text
    _, dev_id = await make_member(client, auth, "dev@agholding.net")
    await client.post(f"/api/pm/projects/{team['id']}/members", headers=auth, json={"user_id": dev_id, "role": "member"})
    issue = await _issue(client, auth, team["id"], workflow_state="qa", component="api", assignee_id=dev_id)

    preview = (await _move(client, auth, [issue["id"]], lims["id"], preview=True)).json()["issues"][0]
    assert preview["status_from"] == "qa" and preview["status_to"] == "in_review"
    assert preview["dropped"] == ["component api"] and any("unassigned" in n for n in preview["notes"])
    await _move(client, auth, [issue["id"]], lims["id"])
    moved = (await client.get(f"/api/pm/issues/{issue['id']}", headers=auth)).json()
    assert moved["workflow_state"] == "in_review" and moved["component"] is None and moved["assignee_id"] is None
    history = (await client.get(f"/api/pm/issues/{issue['id']}/history", headers=auth)).json()
    assert any(h["field"] == "dropped on move" and h["old_value"] == "component api" for h in history)


async def test_assignee_can_be_added_to_the_target(client, auth):
    team, lims = await _project(client, auth, "TEAM"), await _project(client, auth, "LIMS")
    _, dev_id = await make_member(client, auth, "dev@agholding.net")
    await client.post(f"/api/pm/projects/{team['id']}/members", headers=auth, json={"user_id": dev_id, "role": "member"})
    issue = await _issue(client, auth, team["id"], assignee_id=dev_id)
    await _move(client, auth, [issue["id"]], lims["id"], assignee_action="add_member")
    assert (await client.get(f"/api/pm/issues/{issue['id']}", headers=auth)).json()["assignee_id"] == dev_id
    members = (await client.get(f"/api/pm/projects/{lims['id']}/members", headers=auth)).json()
    assert {m["user_id"]: m["role"] for m in members}[dev_id] == "member"


async def test_archived_projects_and_bulk_moves_are_all_or_nothing(client, auth):
    team, lims = await _project(client, auth, "TEAM"), await _project(client, auth, "LIMS")
    first, second = await _issue(client, auth, team["id"]), await _issue(client, auth, team["id"])
    await client.patch(f"/api/pm/projects/{lims['id']}", headers=auth, json={"status": "archived"})
    assert (await _move(client, auth, [first["id"]], lims["id"])).status_code == 409
    await client.patch(f"/api/pm/projects/{lims['id']}", headers=auth, json={"status": "active"})

    # One issue already in the target makes the whole request fail; nothing moves.
    in_target = await _issue(client, auth, lims["id"])
    r = await _move(client, auth, [first["id"], in_target["id"]], lims["id"])
    assert r.status_code == 422
    assert (await client.get(f"/api/pm/issues/{first['id']}", headers=auth)).json()["key"] == "TEAM-1"
    r = await _move(client, auth, [first["id"], second["id"]], lims["id"])
    assert [m["new_key"] for m in r.json()["moved"]] == ["LIMS-2", "LIMS-3"]
    over = await client.post("/api/pm/issues/move", headers=auth,
                             json={"issue_ids": [first["id"]] * 101, "target_project_id": team["id"]})
    assert over.status_code == 422


async def test_closed_sprint_points_do_not_change_when_an_issue_leaves(client, auth):
    team, lims = await _project(client, auth, "TEAM"), await _project(client, auth, "LIMS")
    sprint = (await client.post(f"/api/pm/projects/{team['id']}/sprints", headers=auth, json={})).json()
    done = await _issue(client, auth, team["id"], story_points=5, sprint_id=sprint["id"])
    await client.patch(f"/api/pm/issues/{done['id']}", headers=auth, json={"status": "done"})
    start = date.today() - timedelta(days=7)
    await client.post(f"/api/pm/sprints/{sprint['id']}/start", headers=auth,
                      json={"start_date": start.isoformat(), "end_date": date.today().isoformat()})
    await client.post(f"/api/pm/sprints/{sprint['id']}/complete", headers=auth, json={"move_to": "backlog"})
    before = (await client.get(f"/api/pm/projects/{team['id']}/reports/velocity", headers=auth)).json()
    await _move(client, auth, [done["id"]], lims["id"])
    after = (await client.get(f"/api/pm/projects/{team['id']}/reports/velocity", headers=auth)).json()
    assert before == after and after["sprints"][0]["completed"] == 5
    moved = (await client.get(f"/api/pm/issues/{done['id']}", headers=auth)).json()
    assert moved["sprint_id"] is None


async def test_watchers_who_lose_access_are_listed_and_removed(client, auth):
    team, lims = await _project(client, auth, "TEAM"), await _project(client, auth, "LIMS")
    viewer, viewer_id = await make_member(client, auth, "drt@agholding.net")
    await client.post(f"/api/pm/projects/{team['id']}/members", headers=auth, json={"user_id": viewer_id, "role": "viewer"})
    issue = await _issue(client, auth, team["id"])
    await client.post(f"/api/pm/issues/{issue['id']}/watchers", headers=viewer, json={"user_id": viewer_id})
    preview = (await _move(client, auth, [issue["id"]], lims["id"], preview=True)).json()
    assert len(preview["people_losing_access"]) == 1
    await _move(client, auth, [issue["id"]], lims["id"])
    assert (await client.get("/api/pm/issues/TEAM-1", headers=viewer)).status_code == 404
    watchers = (await client.get(f"/api/pm/issues/{issue['id']}", headers=auth)).json()["watchers"]
    assert viewer_id not in [w["user_id"] for w in watchers]
