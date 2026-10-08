"""AI access over MCP: personal tokens, read/write rules and every tracker tool."""
import functools
import json
from datetime import datetime, timedelta, timezone

import pytest

from helpers import make_member

pytestmark = pytest.mark.asyncio

MCP = "/api/mcp/"
HEADERS = {"Accept": "application/json, text/event-stream", "Content-Type": "application/json"}


def with_mcp(test):
    """Run the MCP session manager for the test (the ASGI client skips the app lifespan).

    Started inside the test itself: its task group must be entered and exited in
    the same task, which an async fixture's setup and teardown are not.
    """

    @functools.wraps(test)
    async def wrapper(client, auth):
        from app.api import pm_mcp

        async with pm_mcp.running():
            await test(client, auth)

    return wrapper


async def rpc(client, token, method, params=None, id_=1):
    headers = {**HEADERS, **({"Authorization": f"Bearer {token}"} if token else {})}
    return await client.post(MCP, headers=headers, json={"jsonrpc": "2.0", "id": id_, "method": method, "params": params or {}})


async def call(client, token, tool, **arguments):
    r = await rpc(client, token, "tools/call", {"name": tool, "arguments": arguments})
    assert r.status_code == 200, r.text
    result = r.json()["result"]
    text = result["content"][0]["text"] if result.get("content") else ""
    return result.get("isError", False), (result.get("structuredContent") or (json.loads(text) if text.startswith("{") else text))


async def _token(client, headers, **body):
    r = await client.post("/api/pm/ai/tokens", headers=headers, json={"name": "Claude", **body})
    assert r.status_code == 201, r.text
    return r.json()


async def _setup(client, auth):
    project = (await client.post("/api/pm/projects", headers=auth, json={"key": "LIMS", "name": "LIMS v3"})).json()
    other = (await client.post("/api/pm/projects", headers=auth, json={"key": "HR", "name": "Hidden"})).json()
    pid = project["id"]
    dev, dev_id = await make_member(client, auth, "dev@agholding.net")
    viewer, viewer_id = await make_member(client, auth, "drt@agholding.net")
    await client.post(f"/api/pm/projects/{pid}/members", headers=auth, json={"user_id": dev_id, "role": "member"})
    await client.post(f"/api/pm/projects/{pid}/members", headers=auth, json={"user_id": viewer_id, "role": "viewer"})
    epic = (await client.post(f"/api/pm/projects/{pid}/issues", headers=auth, json={"issue_type": "epic", "summary": "AI file analysis"})).json()
    story = (await client.post(f"/api/pm/projects/{pid}/issues", headers=auth, json={
        "issue_type": "story", "summary": "Analyse uploaded PDFs", "parent_id": epic["id"], "story_points": 5,
        "description": "Extract text", "assignee_id": dev_id,
        "due_date": (datetime.now(timezone.utc).date() - timedelta(days=2)).isoformat(),
    })).json()
    await client.post(f"/api/pm/issues/{story['id']}/comments", headers=auth, json={"body": "Use OCR for scans"})
    return {"project": project, "other": other, "dev": (dev, dev_id), "viewer": (viewer, viewer_id), "epic": epic, "story": story}


@with_mcp
async def test_tokens_are_personal_hashed_and_write_needs_permission(client, auth):
    ctx = await _setup(client, auth)
    dev, dev_id = ctx["dev"]
    status = (await client.get("/api/pm/ai/status", headers=dev)).json()
    assert status == {"mcp_path": MCP, "can_write_allowed": False}
    r = await client.post("/api/pm/ai/tokens", headers=dev, json={"name": "GPT", "can_write": True})
    assert r.status_code == 403
    token = await _token(client, dev)
    assert token["token"].startswith("pmt_") and token["can_write"] is False and token["state"] == "active"
    listed = (await client.get("/api/pm/ai/tokens", headers=dev)).json()
    assert len(listed) == 1 and "token" not in listed[0]
    # Administrators see every token; members can't.
    assert (await client.get("/api/pm/ai/tokens/all", headers=dev)).status_code == 403
    assert [t["owner_name"] for t in (await client.get("/api/pm/ai/tokens/all", headers=auth)).json()] == ["dev"]
    # Write access is granted per person through the normal permission system.
    await client.patch(f"/api/users/{dev_id}", headers=auth, json={"extra_permissions": ["projects_ai_write"]})
    assert (await client.get("/api/pm/ai/status", headers=dev)).json()["can_write_allowed"] is True
    assert (await _token(client, dev, can_write=True))["can_write"] is True
    # Other people's tokens can't be revoked by members.
    admin_token = await _token(client, auth)
    assert (await client.delete(f"/api/pm/ai/tokens/{admin_token['id']}", headers=dev)).status_code == 404


@with_mcp
async def test_endpoint_rejects_missing_bad_revoked_and_expired_tokens(client, auth):
    from sqlalchemy import update

    from app.core.database import AsyncSessionLocal
    from app.models.pm import PmAccessToken

    await _setup(client, auth)
    for token in (None, "pmt_not-real"):
        r = await rpc(client, token, "tools/list")
        assert r.status_code == 401 and "Bearer" in r.headers["www-authenticate"]
    revoked = await _token(client, auth)
    await client.delete(f"/api/pm/ai/tokens/{revoked['id']}", headers=auth)
    assert (await rpc(client, revoked["token"], "tools/list")).status_code == 401
    expired = await _token(client, auth, name="old", expires_in_days=1)
    async with AsyncSessionLocal() as db:
        await db.execute(update(PmAccessToken).where(PmAccessToken.name == "old")
                         .values(expires_at=datetime.now(timezone.utc) - timedelta(minutes=1)))
        await db.commit()
    assert (await rpc(client, expired["token"], "tools/list")).status_code == 401
    good = await _token(client, auth, name="good")
    assert (await rpc(client, good["token"], "tools/list")).status_code == 200
    # Switching the Projects module off org-wide cuts AI access too.
    await client.put("/api/settings/modules", headers=auth, json={"disabled": ["projects"]})
    assert (await rpc(client, good["token"], "tools/list")).status_code == 401


@with_mcp
async def test_handshake_and_tool_catalogue(client, auth):
    token = (await _token(client, auth))["token"]
    init = await rpc(client, token, "initialize", {
        "protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "pytest", "version": "1"},
    })
    assert init.status_code == 200, init.text
    assert init.json()["result"]["serverInfo"]["name"] == "company_tools_tracker_mcp"
    tools = {t["name"]: t for t in (await rpc(client, token, "tools/list")).json()["result"]["tools"]}
    assert set(tools) == {
        "tracker_list_projects", "tracker_get_project_summary", "tracker_search_issues", "tracker_get_issue",
        "tracker_create_issue", "tracker_update_issue", "tracker_move_issue", "tracker_add_comment",
    }
    assert tools["tracker_get_issue"]["annotations"]["readOnlyHint"] is True
    assert tools["tracker_create_issue"]["annotations"]["readOnlyHint"] is False
    assert tools["tracker_move_issue"]["inputSchema"]["properties"]["status"]["enum"] == ["todo", "in_progress", "in_review", "done"]


@with_mcp
async def test_read_tools_respect_project_access(client, auth):
    ctx = await _setup(client, auth)
    viewer, _ = ctx["viewer"]
    token = (await _token(client, viewer))["token"]

    failed, data = await call(client, token, "tracker_list_projects")
    assert not failed and [p["key"] for p in data["projects"]] == ["LIMS"] and data["projects"][0]["your_role"] == "viewer"
    failed, message = await call(client, token, "tracker_get_project_summary", project_key="HR")
    assert failed and "not found" in message

    failed, summary = await call(client, token, "tracker_get_project_summary", project_key="lims")
    assert not failed and summary["issues_by_status"]["todo"] == 1 and summary["overdue_total"] == 1
    assert summary["epics"] == [{"key": "LIMS-1", "summary": "AI file analysis", "status": "todo", "done": 0, "issues": 1}]

    failed, found = await call(client, token, "tracker_search_issues", project_key="LIMS", assignee="dev@agholding.net", limit=1)
    assert not failed and found["total"] == 1 and found["issues"][0]["key"] == "LIMS-2" and found["issues"][0]["epic_or_parent"] == "LIMS-1"
    failed, paged = await call(client, token, "tracker_search_issues", project_key="LIMS", limit=1)
    assert paged["total"] == 2 and paged["has_more"] is True and paged["next_offset"] == 1

    failed, issue = await call(client, token, "tracker_get_issue", issue_key="lims-2")
    assert not failed and issue["description"] == "Extract text" and issue["comments"][0]["body"] == "Use OCR for scans"
    assert issue["your_role"] == "viewer"


@with_mcp
async def test_write_tools_need_a_write_token_permission_and_member_role(client, auth):
    ctx = await _setup(client, auth)
    dev, dev_id = ctx["dev"]
    viewer, viewer_id = ctx["viewer"]

    read_token = (await _token(client, dev))["token"]
    failed, message = await call(client, read_token, "tracker_create_issue", project_key="LIMS", summary="Nope")
    assert failed and "read-only" in message

    await client.patch(f"/api/users/{dev_id}", headers=auth, json={"extra_permissions": ["projects_ai_write"]})
    write_token = (await _token(client, dev, can_write=True))["token"]
    failed, created = await call(client, write_token, "tracker_create_issue", project_key="LIMS", summary="Export reports to PDF",
                                 issue_type="story", parent_key="LIMS-1", story_points=3, assignee="me", labels=["reporting"])
    assert not failed, created
    key = created["created"]["key"]
    assert key == "LIMS-3" and created["created"]["epic_or_parent"] == "LIMS-1" and created["created"]["assignee"] == "dev"

    failed, moved = await call(client, write_token, "tracker_move_issue", issue_key=key, status="in_progress")
    assert not failed and moved["moved"]["status"] == "in_progress"
    failed, updated = await call(client, write_token, "tracker_update_issue", issue_key=key, priority="high", assignee="none")
    assert not failed and updated["changed"] == ["assignee_id", "priority"] and updated["updated"]["assignee"] is None
    failed, message = await call(client, write_token, "tracker_update_issue", issue_key=key)
    assert failed and "at least one field" in message
    failed, _ = await call(client, write_token, "tracker_add_comment", issue_key=key, body="Started on this")
    assert not failed

    # Changes go through the normal app: history and comments are recorded as the token's owner.
    issue = (await client.get(f"/api/pm/issues/{key}", headers=auth)).json()
    history = (await client.get(f"/api/pm/issues/{issue['id']}/history", headers=auth)).json()
    assert {(h["field"], h["new_value"], h["actor_name"]) for h in history} >= {("status", "in_progress", "dev"), ("priority", "high", "dev")}
    comments = (await client.get(f"/api/pm/issues/{issue['id']}/comments", headers=auth)).json()
    assert [(c["author_name"], c["body"]) for c in comments] == [("dev", "Started on this")]

    # Losing the permission stops an existing write token at the next call.
    await client.patch(f"/api/users/{dev_id}", headers=auth, json={"extra_permissions": []})
    failed, message = await call(client, write_token, "tracker_move_issue", issue_key=key, status="done")
    assert failed and "AI write access" in message

    # A viewer with write permission still can't change issues; their project role decides.
    await client.patch(f"/api/users/{viewer_id}", headers=auth, json={"extra_permissions": ["projects_ai_write"]})
    viewer_token = (await _token(client, viewer, can_write=True))["token"]
    failed, message = await call(client, viewer_token, "tracker_move_issue", issue_key=key, status="done")
    assert failed and "role" in message
    failed, _ = await call(client, viewer_token, "tracker_add_comment", issue_key=key, body="Thanks")
    assert not failed
