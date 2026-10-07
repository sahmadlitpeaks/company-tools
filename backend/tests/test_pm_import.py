"""Jira CSV import: preview, mapping, hierarchy, comments, links, sprints, re-runs."""
import csv
import io
import json

import pytest

from helpers import make_member

pytestmark = pytest.mark.asyncio

HEADERS = [
    "Summary", "Issue key", "Issue id", "Issue Type", "Status", "Priority", "Assignee", "Reporter",
    "Created", "Resolved", "Due date", "Labels", "Labels", "Description", "Sprint", "Sprint",
    "Custom field (Story point estimate)", "Custom field (Epic Link)", "Parent",
    "Comment", "Comment", "Outward issue link (Blocks)", "Inward issue link (Relates)", "Attachment",
]


def _row(values: dict[int, str]) -> list[str]:
    """A CSV row with ``values`` at their column positions."""
    return [values.get(i, "") for i in range(len(HEADERS))]


def _export() -> bytes:
    rows = [
        # 0 Summary 1 key 2 id 3 type 4 status 5 priority 6 assignee 7 reporter 8 created 9 resolved
        # 10 due 11-12 labels 13 description 14-15 sprint 16 points 17 epic link 18 parent
        # 19-20 comments 21 blocks 22 relates 23 attachment
        _row({0: "AI file analysis", 1: "OLD-1", 2: "10001", 3: "Epic", 4: "In Progress", 5: "High",
                7: "Dr T", 8: "01/Sep/26 9:00 AM"}),
        _row({0: "Analyse PDFs", 1: "OLD-2", 2: "10002", 3: "Story", 4: "Code Review", 5: "Major",
                6: "Ali Dev", 7: "Dr T", 8: "02/Sep/26 10:30 AM", 10: "30/Sep/26 12:00 AM", 11: "ai", 12: "pdf parsing",
                13: "Extract text from PDFs.", 14: "OLD Sprint 1", 15: "OLD Sprint 2", 16: "5", 17: "OLD-1",
                19: "03/Sep/26 11:00 AM;Dr T;Please include scanned files", 20: "04/Sep/26 2:15 PM;Unknown Person;Noted",
                21: "OLD-4", 23: "05/Sep/26;Ali Dev;spec.pdf;https://jira.example/secure/attachment/1/spec.pdf"}),
        _row({0: "Extract text", 1: "OLD-3", 2: "10003", 3: "Sub-task", 4: "Done", 6: "Ali Dev",
                8: "02/Sep/26 11:00 AM", 9: "06/Sep/26 4:00 PM", 18: "10002"}),
        _row({0: "Upload limit", 1: "OLD-4", 2: "10004", 3: "Improvement", 4: "To Do", 5: "Trivial",
                8: "05/Sep/26 9:00 AM", 22: "OLD-2"}),
        _row({0: "Orphan sub-task", 1: "OLD-5", 2: "10005", 3: "Sub-task", 4: "Backlog", 18: "99999"}),
    ]
    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow(HEADERS)
    writer.writerows(rows)
    return out.getvalue().encode("utf-8-sig")


async def _setup(client, auth):
    project = (await client.post("/api/pm/projects", headers=auth, json={"key": "LIMS", "name": "LIMS"})).json()
    _, dev_id = await make_member(client, auth, "ali.dev@agholding.net")
    await client.patch(f"/api/users/{dev_id}", headers=auth, json={"display_name": "Ali Dev"})
    _, drt_id = await make_member(client, auth, "drt@agholding.net")
    return project, dev_id, drt_id


def _files(data: bytes):
    return {"file": ("jira.csv", data, "text/csv")}


async def test_preview_proposes_mappings_without_writing(client, auth):
    project, dev_id, _ = await _setup(client, auth)
    url = f"/api/pm/projects/{project['id']}/import/jira/preview"
    preview = (await client.post(url, headers=auth, files=_files(_export()))).json()
    assert preview["total"] == 5 and preview["already_imported"] == 0
    assert {s["name"]: s["suggested"] for s in preview["statuses"]} == {
        "In Progress": "in_progress", "Code Review": "in_review", "Done": "done", "To Do": "todo", "Backlog": "todo",
    }
    people = {p["name"]: p for p in preview["people"]}
    assert people["Ali Dev"]["suggested_user_id"] == dev_id
    assert people["Dr T"]["suggested_user_id"] is None and people["Unknown Person"]["count"] == 1
    assert preview["sprints"] == ["OLD Sprint 2"]
    assert preview["comments"] == 2 and preview["links"] == 2 and preview["attachments"] == 1
    assert any("Improvement will be imported as tasks" in w for w in preview["warnings"])
    assert any("attachment" in w for w in preview["warnings"])
    # Nothing was written.
    assert (await client.get(f"/api/pm/projects/{project['id']}/issues", headers=auth)).json() == []


async def test_rejects_files_that_are_not_jira_exports(client, auth):
    project, _, _ = await _setup(client, auth)
    url = f"/api/pm/projects/{project['id']}/import/jira/preview"
    r = await client.post(url, headers=auth, files=_files(b"name,email\nA,a@b.c\n"))
    assert r.status_code == 422 and "Jira CSV export" in r.json()["detail"]


async def test_only_project_admins_import(client, auth):
    project, dev_id, _ = await _setup(client, auth)
    dev, _ = await make_member(client, auth, "ali.dev@agholding.net")
    await client.post(f"/api/pm/projects/{project['id']}/members", headers=auth, json={"user_id": dev_id, "role": "member"})
    url = f"/api/pm/projects/{project['id']}/import/jira/preview"
    assert (await client.post(url, headers=dev, files=_files(_export()))).status_code == 403
    outsider, _ = await make_member(client, auth, "other@agholding.net")
    assert (await client.post(url, headers=outsider, files=_files(_export()))).status_code == 404


async def test_import_keeps_hierarchy_people_comments_links_and_reruns_safely(client, auth):
    project, dev_id, drt_id = await _setup(client, auth)
    pid = project["id"]
    mapping = {"statuses": {"Backlog": "todo"}, "people": {"Ali Dev": dev_id, "Dr T": drt_id, "Unknown Person": None}, "add_members": True}
    r = await client.post(f"/api/pm/projects/{pid}/import/jira", headers=auth, files=_files(_export()), data={"mapping": json.dumps(mapping)})
    assert r.status_code == 200, r.text
    result = r.json()
    assert result["created"] == 5 and result["skipped"] == 0
    assert result["comments"] == 2 and result["links"] == 2
    assert result["sprints_created"] == 1 and result["members_added"] == 2
    assert any("imported as tasks" in w for w in result["warnings"])

    issues = {i["external_key"]: i for i in (await client.get(f"/api/pm/projects/{pid}/issues", headers=auth)).json()}
    epic, story, sub, other, orphan = (issues[f"OLD-{n}"] for n in range(1, 6))
    assert epic["issue_type"] == "epic" and epic["status"] == "in_progress" and epic["key"] == "LIMS-1"
    assert story["parent_id"] == epic["id"] and story["status"] == "in_review" and story["priority"] == "high"
    assert story["story_points"] == 5 and story["labels"] == ["ai", "pdf-parsing"] and story["due_date"] == "2026-09-30"
    assert story["assignee_id"] == dev_id and story["reporter_id"] == drt_id
    assert story["sprint_name"] == "OLD Sprint 2" and story["created_at"].startswith("2026-09-02T10:30")
    assert sub["issue_type"] == "subtask" and sub["parent_id"] == story["id"] and sub["status"] == "done"
    assert sub["resolved_at"].startswith("2026-09-06T16:00") and sub["sprint_id"] is None
    assert other["issue_type"] == "task" and other["priority"] == "lowest"
    assert orphan["issue_type"] == "task" and orphan["parent_id"] is None

    detail = (await client.get(f"/api/pm/issues/{story['id']}", headers=auth)).json()
    assert {(link["relation"], link["issue"]["key"]) for link in detail["links"]} == {("blocks", other["key"]), ("relates", other["key"])}
    assert "Imported from Jira OLD-2." in detail["description"]
    comments = (await client.get(f"/api/pm/issues/{story['id']}/comments", headers=auth)).json()
    assert [(c["author_id"], c["body"]) for c in comments] == [
        (drt_id, "Please include scanned files"), (None, "Unknown Person (in Jira): Noted"),
    ]
    roles = {m["user_id"]: m["role"] for m in (await client.get(f"/api/pm/projects/{pid}/members", headers=auth)).json()}
    assert roles[dev_id] == "member" and roles[drt_id] == "viewer"

    # Running the same export again creates nothing new.
    again = await client.post(f"/api/pm/projects/{pid}/import/jira", headers=auth, files=_files(_export()), data={"mapping": json.dumps(mapping)})
    assert again.json()["created"] == 0 and again.json()["skipped"] == 5 and again.json()["links"] == 0
    preview = (await client.post(f"/api/pm/projects/{pid}/import/jira/preview", headers=auth, files=_files(_export()))).json()
    assert preview["already_imported"] == 5


async def test_unmapped_people_are_noted_not_assigned(client, auth):
    project, _, _ = await _setup(client, auth)
    pid = project["id"]
    r = await client.post(f"/api/pm/projects/{pid}/import/jira", headers=auth, files=_files(_export()),
                          data={"mapping": json.dumps({"people": {}, "add_members": False})})
    assert r.status_code == 200 and r.json()["members_added"] == 0
    story = next(i for i in (await client.get(f"/api/pm/projects/{pid}/issues", headers=auth)).json() if i["external_key"] == "OLD-2")
    assert story["assignee_id"] is None
    detail = (await client.get(f"/api/pm/issues/{story['id']}", headers=auth)).json()
    assert "Reported in Jira by Dr T." in detail["description"] and "Assigned in Jira to Ali Dev." in detail["description"]
    bad = await client.post(f"/api/pm/projects/{pid}/import/jira", headers=auth, files=_files(_export()),
                            data={"mapping": json.dumps({"statuses": {"Done": "shipped"}})})
    assert bad.status_code == 422
