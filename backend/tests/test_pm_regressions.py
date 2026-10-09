"""Regression coverage for PR #45's share, archive, sprint and import boundaries."""
import csv
import io
import json
import uuid
from datetime import date, timedelta

import pytest
from sqlalchemy import update

from app.core.database import AsyncSessionLocal
from app.models.user import User
from helpers import make_member

pytestmark = pytest.mark.asyncio


async def _project(client, auth, **extra):
    response = await client.post("/api/pm/projects", headers=auth, json={"key": "REV", "name": "Review", **extra})
    assert response.status_code == 201, response.text
    pid = response.json()["id"]
    if "sprints_enabled" in extra:
        settings = await client.patch(f"/api/pm/projects/{pid}", headers=auth, json={"sprints_enabled": extra["sprints_enabled"]})
        assert settings.status_code == 200, settings.text
    return pid


async def _issue(client, auth, pid, **extra):
    response = await client.post(f"/api/pm/projects/{pid}/issues", headers=auth, json={"summary": "Review issue", **extra})
    assert response.status_code == 201, response.text
    return response.json()


async def _closed_sprint(client, auth, pid):
    response = await client.post(f"/api/pm/projects/{pid}/sprints", headers=auth, json={})
    sid = response.json()["id"]
    finished = await _issue(client, auth, pid, sprint_id=sid, story_points=5)
    spillover = await _issue(client, auth, pid, sprint_id=sid, story_points=3)
    today = date.today()
    response = await client.post(f"/api/pm/sprints/{sid}/start", headers=auth,
                                 json={"start_date": str(today - timedelta(days=3)), "end_date": str(today + timedelta(days=7))})
    assert response.status_code == 200, response.text
    assert (await client.patch(f"/api/pm/issues/{finished['id']}", headers=auth, json={"status": "done"})).status_code == 200
    assert (await client.post(f"/api/pm/sprints/{sid}/complete", headers=auth, json={"move_to": "backlog"})).status_code == 200
    return sid, finished, spillover


@pytest.mark.parametrize("view", ["board", "timeline"])
@pytest.mark.parametrize("display_name", [None, "", "  ", "private.employee@agholding.net"])
async def test_public_assignee_names_never_fall_back_to_email(client, auth, view, display_name):
    pid = await _project(client, auth, sprints_enabled=False)
    _, user_id = await make_member(client, auth, "private.employee@agholding.net")
    assert (await client.post(f"/api/pm/projects/{pid}/members", headers=auth,
                              json={"user_id": user_id, "role": "member"})).status_code == 201
    async with AsyncSessionLocal() as db:
        await db.execute(update(User).where(User.id == uuid.UUID(user_id)).values(display_name=display_name))
        await db.commit()
    await _issue(client, auth, pid, assignee_id=user_id)
    link = (await client.post(f"/api/pm/projects/{pid}/shares", headers=auth, json={"view": view})).json()
    response = await client.get("/api/public/pm-shares/" + link["token"])
    assert response.status_code == 200, response.text
    assert "private.employee@agholding.net" not in response.text
    assert response.json()[view]["issues"][0]["assignee_name"] == "Team member"
    # The internal account/people view still includes the email for authorized users.
    internal = (await client.get(f"/api/pm/projects/{pid}/members", headers=auth)).json()
    assert next(person for person in internal if person["user_id"] == user_id)["email"] == "private.employee@agholding.net"


@pytest.mark.parametrize("destination", ["unchanged", "omitted", "future", "backlog"])
async def test_reopening_completed_issue_handles_full_edit_and_explicit_destination(client, auth, destination):
    pid = await _project(client, auth)
    sid, finished, _ = await _closed_sprint(client, auth, pid)
    body = {"summary": "Reopened through Edit", "status": "todo"}
    expected = None
    if destination == "unchanged":
        body["sprint_id"] = sid
    elif destination == "backlog":
        body["sprint_id"] = None
    elif destination == "future":
        expected = (await client.post(f"/api/pm/projects/{pid}/sprints", headers=auth, json={})).json()["id"]
        body["sprint_id"] = expected
    response = await client.patch(f"/api/pm/issues/{finished['id']}", headers=auth, json=body)
    assert response.status_code == 200, response.text
    assert response.json()["sprint_id"] == expected
    assert response.json()["resolved_at"] is None
    history = (await client.get(f"/api/pm/issues/{finished['id']}/history", headers=auth)).json()
    assert any(entry["field"] == "sprint" and entry["old_value"] for entry in history)
    # Explicitly assigning unrelated work into the closed sprint is still rejected.
    another = await _issue(client, auth, pid)
    assert (await client.patch(f"/api/pm/issues/{another['id']}", headers=auth, json={"sprint_id": sid})).status_code == 422


async def test_completed_burndown_survives_reopen_point_edits_moves_and_deletion(client, auth):
    pid = await _project(client, auth)
    sid, finished, spillover = await _closed_sprint(client, auth, pid)
    url = f"/api/pm/projects/{pid}/reports/burndown?sprint_id={sid}"
    before = (await client.get(url, headers=auth)).json()
    assert before["total_points"] == 8
    assert next(day for day in before["days"] if day["date"] == str(date.today()))["remaining"] == 3
    link = (await client.post(f"/api/pm/projects/{pid}/shares", headers=auth, json={"view": "progress"})).json()
    for item, changes in ((finished, {"status": "todo", "story_points": 13}), (spillover, {"status": "done", "story_points": 21})):
        assert (await client.patch(f"/api/pm/issues/{item['id']}", headers=auth, json=changes)).status_code == 200
        assert (await client.get(url, headers=auth)).json() == before
    assert (await client.delete(f"/api/pm/issues/{finished['id']}", headers=auth)).status_code == 204
    assert (await client.delete(f"/api/pm/issues/{spillover['id']}", headers=auth)).status_code == 204
    assert (await client.get(url, headers=auth)).json() == before
    public = await client.get("/api/public/pm-shares/" + link["token"])
    assert public.json()["progress"]["burndown"] == before


async def test_archived_attachment_content_is_readable_but_cannot_change(client, auth):
    pid = await _project(client, auth)
    item = await _issue(client, auth, pid)
    path = f"/api/attachments/by/pm_issue/{item['id']}"
    files = {"file": ("evidence.txt", b"evidence", "text/plain")}
    uploaded = await client.post(path, headers=auth, files=files)
    assert uploaded.status_code == 201, uploaded.text
    attachment_id = uploaded.json()["id"]
    assert (await client.patch(f"/api/pm/projects/{pid}", headers=auth, json={"status": "archived"})).status_code == 200
    assert (await client.post(path, headers=auth, files=files)).status_code == 409
    assert (await client.delete(f"/api/attachments/{attachment_id}", headers=auth)).status_code == 409
    assert (await client.get(path, headers=auth)).json()[0]["id"] == attachment_id
    assert (await client.get(f"/api/attachments/{attachment_id}/download", headers=auth)).content == b"evidence"
    user_id = (await client.get("/api/auth/me", headers=auth)).json()["id"]
    assert (await client.post(f"/api/pm/issues/{item['id']}/watchers", headers=auth, json={"user_id": user_id})).status_code == 409
    assert (await client.delete(f"/api/pm/issues/{item['id']}/watchers/{user_id}", headers=auth)).status_code == 409
    assert (await client.patch(f"/api/pm/projects/{pid}", headers=auth, json={"status": "active"})).status_code == 200
    assert (await client.delete(f"/api/attachments/{attachment_id}", headers=auth)).status_code == 204


async def test_large_jira_description_previews_and_imports_without_truncation(client, auth):
    pid = await _project(client, auth)
    description = "Requirement, with quotes \" and Arabic متطلبات\n" * 5000
    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow(["Summary", "Issue key", "Issue Type", "Description"])
    writer.writerow(["Long requirement", "OLD-1", "Story", description])
    files = {"file": ("jira.csv", out.getvalue().encode(), "text/csv")}
    path = f"/api/pm/projects/{pid}/import/jira"
    preview = await client.post(path + "/preview", headers=auth, files=files)
    assert preview.status_code == 200, preview.text
    imported = await client.post(path, headers=auth, files=files, data={"mapping": json.dumps({})})
    assert imported.status_code == 200, imported.text
    item = (await client.get("/api/pm/issues/" + imported.json()["first_key"], headers=auth)).json()
    assert item["description"] == description.strip() + "\n\nImported from Jira OLD-1."


@pytest.mark.parametrize("suffix", ["", "/preview"])
async def test_malformed_csv_returns_validation_error_without_writes(client, auth, suffix):
    pid = await _project(client, auth)
    files = {"file": ("jira.csv", b'Summary,Issue key,Description\nBad,OLD-1,"unterminated', "text/csv")}
    response = await client.post(f"/api/pm/projects/{pid}/import/jira{suffix}", headers=auth, files=files)
    assert response.status_code == 422, response.text
    assert "malformed" in response.json()["detail"]
    assert (await client.get(f"/api/pm/projects/{pid}/issues", headers=auth)).json() == []
