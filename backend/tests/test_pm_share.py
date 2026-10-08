"""Read-only share links: admin-only management, minimal public payload, expiry/revocation."""
from datetime import date, datetime, timedelta, timezone

import pytest

from helpers import make_member

pytestmark = pytest.mark.asyncio


async def _project(client, auth, **extra):
    project = (await client.post("/api/pm/projects", headers=auth, json={"key": "LIMS", "name": "LIMS v3", **extra})).json()
    pid = project["id"]
    epic = (await client.post(f"/api/pm/projects/{pid}/issues", headers=auth, json={"issue_type": "epic", "summary": "AI file analysis"})).json()
    story = (await client.post(f"/api/pm/projects/{pid}/issues", headers=auth, json={
        "issue_type": "story", "summary": "Analyse PDFs", "parent_id": epic["id"], "story_points": 5,
        "description": "Patient sample handling notes", "labels": ["confidential"],
        "start_date": date.today().isoformat(), "due_date": (date.today() + timedelta(days=5)).isoformat(),
    })).json()
    await client.post(f"/api/pm/issues/{story['id']}/comments", headers=auth, json={"body": "Internal remark"})
    return project, epic, story


async def test_only_project_admins_manage_links(client, auth):
    project, _, _ = await _project(client, auth)
    pid = project["id"]
    member, member_id = await make_member(client, auth, "dev@agholding.net")
    await client.post(f"/api/pm/projects/{pid}/members", headers=auth, json={"user_id": member_id, "role": "member"})
    assert (await client.post(f"/api/pm/projects/{pid}/shares", headers=member, json={"view": "board"})).status_code == 403
    assert (await client.get(f"/api/pm/projects/{pid}/shares", headers=member)).status_code == 403
    assert (await client.post(f"/api/pm/projects/{pid}/shares", headers=auth, json={"view": "kanban"})).status_code == 422
    created = (await client.post(f"/api/pm/projects/{pid}/shares", headers=auth, json={"view": "timeline", "label": "For Dr T"})).json()
    assert created["path"] == f"/share/p/{created['token']}" and created["state"] == "active"
    listed = (await client.get(f"/api/pm/projects/{pid}/shares", headers=auth)).json()
    # The token is shown once and never listed again.
    assert len(listed) == 1 and "token" not in listed[0] and listed[0]["label"] == "For Dr T"
    assert (await client.delete(f"/api/pm/shares/{created['id']}", headers=member)).status_code == 403


async def test_public_views_are_minimal_and_need_no_login(client, auth):
    project, epic, story = await _project(client, auth)
    pid = project["id"]
    sprint = (await client.post(f"/api/pm/projects/{pid}/sprints", headers=auth, json={})).json()
    await client.patch(f"/api/pm/issues/{story['id']}", headers=auth, json={"sprint_id": sprint["id"]})
    await client.post(f"/api/pm/sprints/{sprint['id']}/start", headers=auth, json={
        "start_date": date.today().isoformat(), "end_date": (date.today() + timedelta(days=13)).isoformat()})

    tokens = {}
    for view in ("board", "timeline", "progress"):
        tokens[view] = (await client.post(f"/api/pm/projects/{pid}/shares", headers=auth, json={"view": view})).json()["token"]

    board = await client.get(f"/api/public/pm-shares/{tokens['board']}")
    assert board.status_code == 200
    assert board.headers["cache-control"] == "private, no-store" and "noindex" in board.headers["x-robots-tag"]
    data = board.json()
    assert data["project"]["name"] == "LIMS v3" and data["project"]["health"] == "on_track"
    assert data["board"]["sprint"]["name"] == "LIMS Sprint 1"
    [card] = data["board"]["issues"]
    assert card["key"] == "LIMS-2" and card["parent"]["summary"] == "AI file analysis" and card["story_points"] == 5
    # Nothing beyond the planning fields leaves the server.
    text = board.text
    for secret in ("Patient sample", "confidential", "Internal remark", "admin@agholding.net", "reporter", "description"):
        assert secret not in text

    timeline = (await client.get(f"/api/public/pm-shares/{tokens['timeline']}")).json()
    assert [i["key"] for i in timeline["timeline"]["issues"]] == ["LIMS-1", "LIMS-2"]
    assert timeline["timeline"]["sprints"][0]["status"] == "active"

    progress = (await client.get(f"/api/public/pm-shares/{tokens['progress']}")).json()["progress"]
    assert progress["counts"]["todo"] == 1 and progress["epics"][0]["issue_count"] == 1
    assert progress["burndown"]["total_points"] == 5 and progress["velocity"]["sprints"] == []

    listed = {s["view"]: s for s in (await client.get(f"/api/pm/projects/{pid}/shares", headers=auth)).json()}
    assert listed["board"]["view_count"] == 1 and listed["board"]["last_viewed_at"]


async def test_revoked_expired_and_unknown_links_look_the_same(client, auth):
    from sqlalchemy import update

    from app.core.database import AsyncSessionLocal
    from app.models.pm import PmShareLink

    project, _, _ = await _project(client, auth)
    pid = project["id"]
    revoked = (await client.post(f"/api/pm/projects/{pid}/shares", headers=auth, json={"view": "board"})).json()
    expired = (await client.post(f"/api/pm/projects/{pid}/shares", headers=auth, json={"view": "board", "expires_in_days": 1})).json()
    forever = (await client.post(f"/api/pm/projects/{pid}/shares", headers=auth, json={"view": "board", "expires_in_days": 0})).json()
    assert forever["expires_at"] is None
    assert (await client.delete(f"/api/pm/shares/{revoked['id']}", headers=auth)).status_code == 204
    async with AsyncSessionLocal() as db:
        await db.execute(update(PmShareLink).where(PmShareLink.token_hash.isnot(None), PmShareLink.label.is_(None),
                                                   PmShareLink.expires_at.isnot(None))
                         .values(expires_at=datetime.now(timezone.utc) - timedelta(minutes=1)))
        await db.commit()
    responses = [await client.get(f"/api/public/pm-shares/{token}") for token in (revoked["token"], expired["token"], "not-a-real-token")]
    assert {r.status_code for r in responses} == {404}
    assert len({r.json()["detail"] for r in responses}) == 1
    states = {s["id"]: s["state"] for s in (await client.get(f"/api/pm/projects/{pid}/shares", headers=auth)).json()}
    assert states == {revoked["id"]: "revoked", expired["id"]: "expired", forever["id"]: "active"}
    assert (await client.get(f"/api/public/pm-shares/{forever['token']}")).status_code == 200

    # Switching the Projects module off org-wide stops every link.
    r = await client.put("/api/settings/modules", headers=auth, json={"disabled": ["projects"]})
    assert r.status_code in (200, 204), r.text
    assert (await client.get(f"/api/public/pm-shares/{forever['token']}")).status_code == 404
