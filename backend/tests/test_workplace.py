import pytest

pytestmark = pytest.mark.asyncio


async def _member(client, auth, email="mo@agholding.net", status="active"):
    """Create a second (member) user via dev-login, then activate them."""
    token = (
        await client.post("/api/auth/dev-login", params={"email": email})
    ).json()["access_token"]
    users = (await client.get("/api/users", headers=auth)).json()
    uid = next(u["id"] for u in users if u["email"] == email)
    await client.patch(
        f"/api/users/{uid}", headers=auth, json={"status": status, "role": "member"}
    )
    return {"Authorization": f"Bearer {token}"}, uid


# ---- Tasks ----
async def test_task_lifecycle(client, auth):
    me = (await client.get("/api/auth/me", headers=auth)).json()
    r = await client.post(
        "/api/tasks",
        headers=auth,
        json={"title": "Prepare board deck", "priority": "high", "assignee_id": me["id"]},
    )
    assert r.status_code == 201
    tid = r.json()["id"]
    assert r.json()["assignee_name"]

    mine = (await client.get("/api/tasks?mine=true", headers=auth)).json()
    assert any(t["id"] == tid for t in mine)

    done = await client.patch(f"/api/tasks/{tid}", headers=auth, json={"status": "done"})
    assert done.json()["status"] == "done" and done.json()["completed_at"]


async def test_task_assignment_notifies(client, auth):
    hdr, uid = await _member(client, auth)
    await client.post(
        "/api/tasks", headers=auth, json={"title": "Fix printer", "assignee_id": uid}
    )
    notes = (await client.get("/api/notifications", headers=hdr)).json()
    assert any(n["category"] == "task" for n in notes)


# ---- Approvals ----
async def test_approval_flow(client, auth):
    hdr, uid = await _member(client, auth)
    # Member submits a leave request.
    req = await client.post(
        "/api/approvals",
        headers=hdr,
        json={"type": "leave", "title": "Annual leave", "start_date": "2026-07-01"},
    )
    assert req.status_code == 201 and req.json()["status"] == "pending"
    rid = req.json()["id"]

    # Member can't decide their own request.
    forbidden = await client.post(
        f"/api/approvals/{rid}/decision", headers=hdr, json={"status": "approved"}
    )
    assert forbidden.status_code == 403

    # Admin approves -> requester is notified.
    ok = await client.post(
        f"/api/approvals/{rid}/decision",
        headers=auth,
        json={"status": "approved", "note": "Enjoy"},
    )
    assert ok.json()["status"] == "approved" and ok.json()["decided_by_name"]
    notes = (await client.get("/api/notifications", headers=hdr)).json()
    assert any(n["category"] == "approval" for n in notes)

    # Can't decide twice.
    again = await client.post(
        f"/api/approvals/{rid}/decision", headers=auth, json={"status": "rejected"}
    )
    assert again.status_code == 409


async def test_approval_scopes(client, auth):
    hdr, uid = await _member(client, auth)
    await client.post(
        "/api/approvals", headers=hdr, json={"type": "expense", "title": "Taxi"}
    )
    mine = (await client.get("/api/approvals?scope=mine", headers=hdr)).json()
    assert len(mine) == 1
    review = (await client.get("/api/approvals?scope=to_review", headers=auth)).json()
    assert any(r["title"] == "Taxi" for r in review)  # admin reviews unassigned


# ---- Service desk ----
async def test_ticket_flow(client, auth):
    hdr, uid = await _member(client, auth)
    # Member raises a ticket; admins get notified.
    t = await client.post(
        "/api/tickets",
        headers=hdr,
        json={"subject": "Laptop won't boot", "category": "it", "priority": "high"},
    )
    assert t.status_code == 201
    tid = t.json()["id"]
    admin_notes = (await client.get("/api/notifications", headers=auth)).json()
    assert any(n["category"] == "ticket" for n in admin_notes)

    # Admin (agent) replies and resolves.
    c = await client.post(
        f"/api/tickets/{tid}/comments", headers=auth, json={"body": "Rebooting it"}
    )
    assert c.status_code == 201
    upd = await client.patch(
        f"/api/tickets/{tid}", headers=auth, json={"status": "resolved"}
    )
    assert upd.json()["status"] == "resolved" and upd.json()["resolved_at"]

    detail = (await client.get(f"/api/tickets/{tid}", headers=auth)).json()
    assert detail["comment_count"] == 1 and detail["comments"][0]["author_name"]
    # Requester was notified of comment + resolution.
    notes = (await client.get("/api/notifications", headers=hdr)).json()
    assert sum(1 for n in notes if n["category"] == "ticket") >= 1


async def test_ticket_member_cannot_triage(client, auth):
    hdr, uid = await _member(client, auth)
    other = (
        await client.post("/api/tickets", headers=auth, json={"subject": "AC broken", "category": "facilities"})
    ).json()
    # A member who is neither requester nor assignee can't reassign.
    r = await client.patch(
        f"/api/tickets/{other['id']}", headers=hdr, json={"assignee_id": uid}
    )
    assert r.status_code == 403


# ---- Knowledge base ----
async def test_knowledge_publish_and_visibility(client, auth):
    hdr, uid = await _member(client, auth)
    # Admin writes a draft (unpublished) and a published article.
    draft = await client.post(
        "/api/knowledge",
        headers=auth,
        json={"title": "WIP policy", "category": "HR", "body": "...", "is_published": False},
    )
    await client.post(
        "/api/knowledge",
        headers=auth,
        json={"title": "Leave policy", "category": "HR", "body": "10 days", "pinned": True},
    )
    # Member only sees the published one.
    member_list = (await client.get("/api/knowledge", headers=hdr)).json()
    titles = {a["title"] for a in member_list}
    assert "Leave policy" in titles and "WIP policy" not in titles

    cats = (await client.get("/api/knowledge/categories", headers=hdr)).json()
    assert "HR" in cats

    # Reading increments view_count.
    pub_id = next(a["id"] for a in member_list if a["title"] == "Leave policy")
    art = (await client.get(f"/api/knowledge/{pub_id}", headers=hdr)).json()
    assert art["body"] == "10 days" and art["view_count"] == 1

    # Member can't read the draft.
    assert (await client.get(f"/api/knowledge/{draft.json()['id']}", headers=hdr)).status_code == 404


async def test_module_gating_blocks_unpermitted(client, auth):
    # A member without the 'approvals' permission is blocked server-side.
    hdr, uid = await _member(client, auth, email="zara@agholding.net")
    await client.patch(
        f"/api/users/{uid}",
        headers=auth,
        json={"permissions": ["dashboard", "tasks"]},  # no approvals/knowledge/tickets
    )
    assert (await client.get("/api/approvals", headers=hdr)).status_code == 403
    assert (await client.get("/api/knowledge", headers=hdr)).status_code == 403
    assert (await client.get("/api/tickets", headers=hdr)).status_code == 403
    assert (await client.get("/api/tasks", headers=hdr)).status_code == 200


async def test_my_work_aggregation(client, auth):
    me = (await client.get("/api/auth/me", headers=auth)).json()
    # A task assigned to me + a ticket raised by me.
    await client.post(
        "/api/tasks", headers=auth, json={"title": "Do thing", "assignee_id": me["id"]}
    )
    await client.post("/api/tickets", headers=auth, json={"subject": "Help", "category": "it"})
    work = (await client.get("/api/me/work", headers=auth)).json()
    assert work["tasks_open"] >= 1
    assert work["tickets_open"] >= 1
    assert any(t["title"] == "Do thing" for t in work["my_tasks"])


async def test_attachments_on_ticket(client, auth):
    t = (await client.post("/api/tickets", headers=auth, json={"subject": "X", "category": "it"})).json()
    up = await client.post(
        f"/api/attachments/by/ticket/{t['id']}",
        headers=auth,
        files={"file": ("shot.png", b"\x89PNG fake", "image/png")},
    )
    assert up.status_code == 201
    lst = (await client.get(f"/api/attachments/by/ticket/{t['id']}", headers=auth)).json()
    assert len(lst) == 1 and lst[0]["name"] == "shot.png"
    dl = await client.get(f"/api/attachments/{up.json()['id']}/download", headers=auth)
    assert dl.status_code == 200 and dl.content == b"\x89PNG fake"


async def test_attachment_module_gated(client, auth):
    hdr, uid = await _member(client, auth, email="amir@agholding.net")
    await client.patch(
        f"/api/users/{uid}", headers=auth, json={"permissions": ["dashboard", "tasks"]}
    )
    a = (await client.post("/api/approvals", headers=auth, json={"type": "general", "title": "X"})).json()
    # No 'approvals' permission -> can't read its attachments.
    r = await client.get(f"/api/attachments/by/approval/{a['id']}", headers=hdr)
    assert r.status_code == 403


async def test_announcements(client, auth):
    hdr, uid = await _member(client, auth, email="lina@agholding.net")
    # Member can't post.
    assert (await client.post("/api/announcements", headers=hdr, json={"title": "Hi"})).status_code == 403
    # Admin posts -> members notified + see it unread.
    a = await client.post("/api/announcements", headers=auth, json={"title": "Office closed Friday", "body": "Eid"})
    assert a.status_code == 201
    aid = a.json()["id"]
    notes = (await client.get("/api/notifications", headers=hdr)).json()
    assert any(n["category"] == "announcement" for n in notes)
    assert (await client.get("/api/announcements/unread-count", headers=hdr)).json()["count"] >= 1
    feed = (await client.get("/api/announcements", headers=hdr)).json()
    assert any(x["id"] == aid and x["is_read"] is False for x in feed)
    # Mark read -> unread drops.
    await client.post(f"/api/announcements/{aid}/read", headers=hdr)
    assert (await client.get("/api/announcements/unread-count", headers=hdr)).json()["count"] == 0
