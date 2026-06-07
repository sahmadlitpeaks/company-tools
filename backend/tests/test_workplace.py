import pytest

from helpers import make_member

pytestmark = pytest.mark.asyncio


async def _member(client, auth, email="mo@agholding.net", status="active"):
    """Create a second (member) user with a password, then activate + log in."""
    return await make_member(client, auth, email, status=status)


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


async def test_task_subtasks_comments_and_recurrence(client, auth):
    me = (await client.get("/api/auth/me", headers=auth)).json()
    # A weekly recurring task with a due date.
    t = (await client.post(
        "/api/tasks", headers=auth,
        json={"title": "Weekly backup", "recurrence": "weekly", "due_date": "2026-06-01",
              "assignee_id": me["id"]},
    )).json()
    tid = t["id"]

    # Add two checklist items; tick one.
    i1 = (await client.post(f"/api/tasks/{tid}/items", headers=auth, json={"title": "Snapshot DB"})).json()
    await client.post(f"/api/tasks/{tid}/items", headers=auth, json={"title": "Verify restore"})
    await client.patch(f"/api/tasks/items/{i1['id']}", headers=auth, json={"done": True})

    # A comment.
    await client.post(f"/api/tasks/{tid}/comments", headers=auth, json={"body": "Started this"})

    detail = (await client.get(f"/api/tasks/{tid}", headers=auth)).json()
    assert detail["subtasks_total"] == 2 and detail["subtasks_done"] == 1
    assert detail["comment_count"] == 1 and len(detail["items"]) == 2

    # List view exposes the aggregate counts too.
    listing = (await client.get("/api/tasks", headers=auth)).json()
    row = next(x for x in listing if x["id"] == tid)
    assert row["subtasks_total"] == 2 and row["comment_count"] == 1

    # Completing a recurring task spawns the next occurrence (due +1 week).
    await client.patch(f"/api/tasks/{tid}", headers=auth, json={"status": "done"})
    after = (await client.get("/api/tasks", headers=auth)).json()
    nxt = [x for x in after if x["title"] == "Weekly backup" and x["status"] == "todo"]
    assert nxt and nxt[0]["due_date"] == "2026-06-08"


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
    # Ticket gets a human-friendly number and SLA targets from its priority.
    assert t.json()["number"] and t.json()["sla_resolution_due"]
    admin_notes = (await client.get("/api/notifications", headers=auth)).json()
    assert any(n["category"] == "ticket" for n in admin_notes)

    # Admin (agent) replies (sets first response) and resolves with a note.
    c = await client.post(
        f"/api/tickets/{tid}/comments", headers=auth, json={"body": "Rebooting it"}
    )
    assert c.status_code == 201
    # Resolving without a note is rejected.
    bad = await client.patch(f"/api/tickets/{tid}", headers=auth, json={"status": "resolved"})
    assert bad.status_code == 422
    upd = await client.patch(
        f"/api/tickets/{tid}",
        headers=auth,
        json={"status": "resolved", "resolution_note": "Reseated the RAM."},
    )
    assert upd.json()["status"] == "resolved" and upd.json()["resolved_at"]
    assert upd.json()["first_responded_at"] and upd.json()["resolution_note"]

    detail = (await client.get(f"/api/tickets/{tid}", headers=auth)).json()
    assert detail["comment_count"] == 1 and detail["comments"][0]["author_name"]
    # Requester was notified of comment + resolution.
    notes = (await client.get("/api/notifications", headers=hdr)).json()
    assert sum(1 for n in notes if n["category"] == "ticket") >= 1

    # An activity timeline was recorded (created + status change).
    acts = (await client.get(f"/api/activity?entity_type=ticket&entity_id={tid}", headers=auth)).json()
    assert any(a["action"] == "status" for a in acts)


async def test_ticket_internal_notes_hidden_from_requester(client, auth):
    hdr, uid = await _member(client, auth, email="reporter@agholding.net")
    t = (await client.post(
        "/api/tickets", headers=hdr, json={"subject": "VPN down", "category": "it"}
    )).json()
    # Admin adds an internal note + a public reply.
    await client.post(f"/api/tickets/{t['id']}/comments", headers=auth, json={"body": "check logs", "is_internal": True})
    await client.post(f"/api/tickets/{t['id']}/comments", headers=auth, json={"body": "Looking into it"})
    # Requester sees only the public reply.
    seen = (await client.get(f"/api/tickets/{t['id']}", headers=hdr)).json()
    bodies = {c["body"] for c in seen["comments"]}
    assert "Looking into it" in bodies and "check logs" not in bodies
    # Agent sees both.
    agent_view = (await client.get(f"/api/tickets/{t['id']}", headers=auth)).json()
    assert len(agent_view["comments"]) == 2

    # Overdue filter + unassigned scope return lists.
    assert (await client.get("/api/tickets?overdue=true", headers=auth)).status_code == 200
    unassigned = (await client.get("/api/tickets?scope=unassigned", headers=auth)).json()
    assert any(x["id"] == t["id"] for x in unassigned)


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


async def test_leave_balance(client, auth):
    me = (await client.get("/api/auth/me", headers=auth)).json()
    from datetime import date
    y = date.today().year
    # Approved 5-working-day leave (Mon 2026-06-01 .. Fri 2026-06-05 if this year).
    req = (await client.post(
        "/api/approvals", headers=auth,
        json={"type": "leave", "title": "Holiday", "start_date": f"{y}-06-01", "end_date": f"{y}-06-05"},
    )).json()
    await client.post(f"/api/approvals/{req['id']}/decision", headers=auth, json={"status": "approved"})

    bal = (await client.get("/api/leave/balance", headers=auth)).json()
    assert bal["entitlement_days"] == 25
    assert bal["used_days"] >= 1
    assert bal["remaining_days"] == bal["entitlement_days"] - bal["used_days"]

    # Admin sets a custom entitlement.
    up = await client.put(f"/api/leave/balances/{me['id']}", headers=auth, json={"entitlement_days": 30})
    assert up.json()["entitlement_days"] == 30

    # whos-out window (depends on current date; just ensure it returns a list).
    out = await client.get("/api/leave/whos-out?days=400", headers=auth)
    assert out.status_code == 200 and isinstance(out.json(), list)


# ---- People ops: onboarding / offboarding ----
async def test_onboarding_journey(client, auth):
    hdr, uid = await _member(client, auth, email="newhire@agholding.net")
    # HR starts onboarding for the new hire, announcing it.
    j = await client.post(
        "/api/people/journeys",
        headers=auth,
        json={"kind": "onboarding", "target_user_id": uid, "announce": True},
    )
    assert j.status_code == 201
    jid = j.json()["id"]
    assert j.json()["total_tasks"] >= 1

    # Announcement was posted to the channel.
    feed = (await client.get("/api/announcements", headers=auth)).json()
    assert any("newhire" in (a["title"].lower()) or "welcome" in a["title"].lower() for a in feed)

    # Detail shows the target's access summary + checklist.
    detail = (await client.get(f"/api/people/journeys/{jid}", headers=auth)).json()
    assert detail["target"]["email"] == "newhire@agholding.net"
    assert detail["target"]["status"] == "active"
    assert len(detail["tasks"]) == detail["total_tasks"]

    # Assign a checklist item to the new hire and complete the rest as HR.
    first = detail["tasks"][0]["id"]
    await client.patch(f"/api/people/tasks/{first}", headers=auth, json={"owner_id": uid})
    # New hire sees it in My Work and can tick it off without the module.
    work = (await client.get("/api/me/work", headers=hdr)).json()
    assert work["onboarding_open"] >= 1
    done = await client.post(f"/api/me/onboarding-tasks/{first}/done", headers=hdr)
    assert done.status_code == 200


async def test_offboarding_revokes_access(client, auth):
    hdr, uid = await _member(client, auth, email="leaver@agholding.net")
    j = (await client.post(
        "/api/people/journeys",
        headers=auth,
        json={"kind": "offboarding", "target_user_id": uid},
    )).json()
    # Admin revokes the leaver's access from the journey.
    res = await client.post(
        f"/api/people/journeys/{j['id']}/access", headers=auth, json={"action": "revoke_access"}
    )
    assert res.status_code == 200 and res.json()["target"]["status"] == "disabled"
    # The disabled user can no longer use the app.
    assert (await client.get("/api/auth/me", headers=hdr)).status_code == 403


async def test_people_ops_is_gated(client, auth):
    hdr, uid = await _member(client, auth, email="rep@agholding.net")
    # Member (no people_ops) can't browse journeys.
    assert (await client.get("/api/people/journeys", headers=hdr)).status_code == 403


async def test_journey_autocompletes(client, auth):
    me = (await client.get("/api/auth/me", headers=auth)).json()
    j = (await client.post(
        "/api/people/journeys", headers=auth,
        json={"kind": "onboarding", "target_user_id": me["id"]},
    )).json()
    detail = (await client.get(f"/api/people/journeys/{j['id']}", headers=auth)).json()
    for t in detail["tasks"]:
        await client.patch(f"/api/people/tasks/{t['id']}", headers=auth, json={"status": "done"})
    after = (await client.get(f"/api/people/journeys/{j['id']}", headers=auth)).json()
    assert after["status"] == "completed"


async def test_onboarding_assets_access_and_pdf(client, auth):
    me = (await client.get("/api/auth/me", headers=auth)).json()
    # A branch + an available asset.
    brand = (await client.post("/api/brands", headers=auth, json={"name": "Agiomix"})).json()
    asset = (await client.post(
        "/api/asset-tracker", headers=auth,
        json={"asset_tag": "OB-LAP-1", "name": "MacBook Air"},
    )).json()

    j = (await client.post(
        "/api/people/journeys", headers=auth,
        json={"kind": "onboarding", "target_user_id": me["id"], "brand_id": brand["id"]},
    )).json()
    assert j["brand_name"] == brand["name"]

    # Assignable assets surfaced to HR.
    avail = (await client.get("/api/people/assignable-assets", headers=auth)).json()
    assert any(a["asset_tag"] == "OB-LAP-1" for a in avail)

    # Assign the laptop (checks out in the tracker) + record an access grant.
    d = (await client.post(
        f"/api/people/journeys/{j['id']}/assets", headers=auth,
        json={"asset_id": asset["id"]},
    )).json()
    assert any(a["asset_tag"] == "OB-LAP-1" for a in d["assigned_assets"])
    # Tracker reflects the checkout.
    tracked = (await client.get(f"/api/asset-tracker/{asset['id']}", headers=auth)).json()
    assert tracked["status"] == "assigned" and tracked["assigned_to_id"] == me["id"]

    g = await client.post(
        f"/api/people/journeys/{j['id']}/grants", headers=auth,
        json={"name": "Google Workspace", "system": "google", "username": "me@agholding.net"},
    )
    assert g.status_code == 201

    detail = (await client.get(f"/api/people/journeys/{j['id']}", headers=auth)).json()
    assert any(x["name"] == "Google Workspace" and x["status"] == "active" for x in detail["access_grants"])

    # PDF hard copy.
    pdf = await client.get(f"/api/people/journeys/{j['id']}/report.pdf", headers=auth)
    assert pdf.status_code == 200 and pdf.headers["content-type"] == "application/pdf"
    assert pdf.content[:4] == b"%PDF"


async def test_offboarding_revoke_grant_and_return_asset(client, auth):
    hdr, uid = await _member(client, auth, email="exiting@agholding.net")
    # Give them an asset + access via an onboarding first.
    asset = (await client.post(
        "/api/asset-tracker", headers=auth, json={"asset_tag": "OB-LAP-2", "name": "Dell"}
    )).json()
    onj = (await client.post(
        "/api/people/journeys", headers=auth,
        json={"kind": "onboarding", "target_user_id": uid},
    )).json()
    await client.post(f"/api/people/journeys/{onj['id']}/assets", headers=auth, json={"asset_id": asset["id"]})
    grant = (await client.post(
        f"/api/people/journeys/{onj['id']}/grants", headers=auth, json={"name": "Facebook Business"}
    )).json()

    # Offboarding surfaces both for removal.
    off = (await client.post(
        "/api/people/journeys", headers=auth,
        json={"kind": "offboarding", "target_user_id": uid},
    )).json()
    detail = (await client.get(f"/api/people/journeys/{off['id']}", headers=auth)).json()
    assert any(a["asset_tag"] == "OB-LAP-2" for a in detail["assigned_assets"])
    assert any(g["name"] == "Facebook Business" for g in detail["access_grants"])

    # IT revokes access + collects the asset.
    rv = await client.post(f"/api/people/grants/{grant['id']}/revoke", headers=auth)
    assert rv.json()["status"] == "revoked"
    ret = await client.post(
        f"/api/people/journeys/{off['id']}/assets/{asset['id']}/return", headers=auth
    )
    assert not any(a["asset_tag"] == "OB-LAP-2" for a in ret.json()["assigned_assets"])
    tracked = (await client.get(f"/api/asset-tracker/{asset['id']}", headers=auth)).json()
    assert tracked["status"] == "available"


# ---- Work log + effort on tickets ----
async def test_worklog_and_ticket_effort(client, auth):
    t = (await client.post("/api/tickets", headers=auth, json={"subject": "Build report", "category": "it"})).json()
    # Log 90 minutes against the ticket + a standalone R&D entry.
    await client.post("/api/worklogs", headers=auth, json={"minutes": 90, "description": "Wrote the query", "kind": "ticket", "entity_type": "ticket", "entity_id": t["id"]})
    await client.post("/api/worklogs", headers=auth, json={"minutes": 60, "description": "R&D on charts", "kind": "rnd"})

    # Ticket now shows effort.
    detail = (await client.get(f"/api/tickets/{t['id']}", headers=auth)).json()
    assert detail["effort_minutes"] == 90
    listing = (await client.get("/api/tickets", headers=auth)).json()
    assert next(x for x in listing if x["id"] == t["id"])["effort_minutes"] == 90

    # My worklog + summary.
    mine = (await client.get("/api/worklogs?scope=mine", headers=auth)).json()
    assert len(mine) == 2
    rnd = next(lg for lg in mine if lg["kind"] == "rnd")
    assert rnd["description"] == "R&D on charts"
    s = (await client.get("/api/worklogs/summary", headers=auth)).json()
    assert s["total_minutes"] == 150 and s["by_kind"]["rnd"] == 60

    # The ticket-linked entry resolves a label.
    linked = next(lg for lg in mine if lg["entity_type"] == "ticket")
    assert linked["entity_label"] == "Build report"


async def test_worklog_gated(client, auth):
    hdr, uid = await _member(client, auth, email="logger@agholding.net")
    await client.patch(f"/api/users/{uid}", headers=auth, json={"permissions": ["dashboard"]})
    assert (await client.get("/api/worklogs", headers=hdr)).status_code == 403


# ---- My Docs (workspace) ----
async def test_workspace_quick_docs(client, auth):
    # A link (e.g. OneDrive) + a note, one pinned.
    link = await client.post("/api/workspace", headers=auth, json={"kind": "link", "title": "Q2 Plan", "url": "https://onedrive/x", "pinned": True, "tags": "plan"})
    assert link.status_code == 201
    await client.post("/api/workspace", headers=auth, json={"kind": "note", "title": "Server creds note", "body": "see vault"})
    # A file upload.
    up = await client.post("/api/workspace/upload", headers=auth, files={"file": ("spec.txt", b"hello", "text/plain")}, data={"title": "Spec", "shared": "true"})
    assert up.status_code == 201 and up.json()["kind"] == "file"

    items = (await client.get("/api/workspace", headers=auth)).json()
    assert len(items) == 3 and items[0]["pinned"] is True  # pinned first

    found = (await client.get("/api/workspace?q=onedrive", headers=auth)).json()
    # search matches title/body/tags, not url -> 'plan' tag matches 'plan' not onedrive; check tag search
    tagged = (await client.get("/api/workspace?q=plan", headers=auth)).json()
    assert any(i["title"] == "Q2 Plan" for i in tagged)

    dl = await client.get(f"/api/workspace/{up.json()['id']}/download", headers=auth)
    assert dl.status_code == 200 and dl.content == b"hello"


async def test_workspace_shared_visible_to_others(client, auth):
    hdr, uid = await _member(client, auth, email="viewer@agholding.net")
    # Admin shares a doc; member sees it; private one stays hidden.
    await client.post("/api/workspace", headers=auth, json={"kind": "link", "title": "Shared SOP", "url": "http://x", "shared": True})
    await client.post("/api/workspace", headers=auth, json={"kind": "note", "title": "Private admin note"})
    seen = (await client.get("/api/workspace", headers=hdr)).json()
    titles = {i["title"] for i in seen}
    assert "Shared SOP" in titles and "Private admin note" not in titles
