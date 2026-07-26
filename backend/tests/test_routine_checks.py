"""Recurring checklists: schedule maths, run generation, responses, sign-off."""
import io
from datetime import date, timedelta

import pytest

from helpers import make_member

pytestmark = pytest.mark.asyncio


IT_MODULES = ["dashboard", "routine_checks", "service_desk", "asset_tracker"]


def _template_body(**over):
    body = {
        "name": "Morning IT Checks",
        "team": "it",
        "schedule": "daily",
        "due_time": "09:00",
        "grace_minutes": 60,
        "requires_verification": True,
        "items": [
            {
                "section": "HQ Building / Dr T's Office",
                "title": "TV",
                "sort": 0,
                "response_type": "ok_issue",
            },
            {
                "section": "HQ Building / Dr T's Office",
                "title": "Yealink WPP30 Wireless Presentation Pod",
                "sort": 1,
                "response_type": "ok_issue",
            },
            {
                "section": "HQ Building",
                "title": "Check All Cameras",
                "sort": 2,
                "response_type": "ok_issue",
                "photo_required": True,
            },
        ],
    }
    body.update(over)
    return body


async def _template(client, auth, **over):
    r = await client.post("/api/checklist-templates", headers=auth, json=_template_body(**over))
    assert r.status_code == 201, r.text
    return r.json()


async def _generate(client, auth, template_id, on=None):
    return await client.post(
        f"/api/checklist-templates/{template_id}/generate",
        headers=auth,
        json={"on": on.isoformat() if on else None},
    )


# --------------------------------------------------------------------------
# Templates & schedules
# --------------------------------------------------------------------------
async def test_create_template_with_items(client, auth):
    tpl = await _template(client, auth)
    assert tpl["item_count"] == 3
    assert tpl["next_run_date"] is not None
    detail = (await client.get(f"/api/checklist-templates/{tpl['id']}", headers=auth)).json()
    assert [i["title"] for i in detail["items"]][0] == "TV"
    assert detail["items"][2]["photo_required"] is True


async def test_template_validation(client, auth):
    bad = await client.post(
        "/api/checklist-templates", headers=auth, json=_template_body(schedule="hourly")
    )
    assert bad.status_code == 422
    # Weekly needs at least one weekday.
    bad = await client.post(
        "/api/checklist-templates", headers=auth, json=_template_body(schedule="weekly")
    )
    assert bad.status_code == 422
    bad = await client.post(
        "/api/checklist-templates",
        headers=auth,
        json=_template_body(schedule="weekly", days_of_week=[9]),
    )
    assert bad.status_code == 422


async def test_schedule_maths():
    from app.models.checklist import ChecklistTemplate
    from app.services.checklist_runs import is_due, next_run_date

    monday = date(2026, 7, 27)
    saturday = date(2026, 8, 1)

    assert is_due(ChecklistTemplate(schedule="daily"), saturday)
    assert is_due(ChecklistTemplate(schedule="weekdays"), monday)
    assert not is_due(ChecklistTemplate(schedule="weekdays"), saturday)

    weekly = ChecklistTemplate(schedule="weekly", days_of_week=[1, 4])
    assert is_due(weekly, monday)  # Monday == ISO 1
    assert not is_due(weekly, monday + timedelta(days=1))

    monthly = ChecklistTemplate(schedule="monthly", day_of_month=31)
    # Clamped to the last day of a short month.
    assert is_due(monthly, date(2026, 2, 28))
    assert not is_due(monthly, date(2026, 2, 27))

    assert next_run_date(ChecklistTemplate(schedule="weekdays"), saturday) == date(2026, 8, 3)


async def test_template_update_replaces_items_without_touching_live_runs(client, auth):
    tpl = await _template(client, auth)
    await _generate(client, auth, tpl["id"])

    r = await client.patch(
        f"/api/checklist-templates/{tpl['id']}",
        headers=auth,
        json={"items": [{"title": "Only check", "response_type": "done"}]},
    )
    assert r.status_code == 200
    assert r.json()["item_count"] == 1

    # The already-generated run keeps the three items it was created with.
    runs = (await client.get("/api/checklist-runs", headers=auth)).json()
    assert runs[0]["items_total"] == 3


# --------------------------------------------------------------------------
# Generation
# --------------------------------------------------------------------------
async def test_generation_is_idempotent(client, auth):
    tpl = await _template(client, auth)
    first = await _generate(client, auth, tpl["id"])
    assert first.status_code == 200 and first.json()["created"] == 1
    second = await _generate(client, auth, tpl["id"])
    assert second.json()["created"] == 0

    runs = (await client.get("/api/checklist-runs", headers=auth)).json()
    assert len(runs) == 1
    assert runs[0]["items_total"] == 3
    assert runs[0]["items_answered"] == 0
    assert runs[0]["run_date"] == date.today().isoformat()


async def test_generate_due_skips_inactive_and_off_schedule(client, auth):
    # Monthly on the 1st: not due today unless today happens to be the 1st.
    monthly = await _template(
        client, auth, name="Monthly fire panel", schedule="monthly", day_of_month=1
    )
    inactive = await _template(client, auth, name="Retired round", active=False)

    r = await client.post("/api/checklist-templates/generate-due", headers=auth, json={})
    assert r.status_code == 200
    created_ids = set(r.json()["run_ids"])

    runs = (await client.get("/api/checklist-runs", headers=auth)).json()
    by_template = {run["template_id"] for run in runs if run["id"] in created_ids}
    assert inactive["id"] not in by_template
    if date.today().day != 1:
        assert monthly["id"] not in by_template


async def test_runs_are_hidden_from_the_task_board(client, auth):
    tpl = await _template(client, auth)
    await _generate(client, auth, tpl["id"])

    plain = (await client.get("/api/tasks", headers=auth)).json()
    assert all(t.get("template_id") is None for t in plain)
    with_runs = (await client.get("/api/tasks?include_runs=true", headers=auth)).json()
    assert any(t.get("template_id") == tpl["id"] for t in with_runs)


async def test_run_cannot_be_edited_through_the_tasks_api(client, auth):
    tpl = await _template(client, auth)
    run_id = (await _generate(client, auth, tpl["id"])).json()["run_ids"][0]
    r = await client.patch(f"/api/tasks/{run_id}", headers=auth, json={"status": "done"})
    assert r.status_code == 409


# --------------------------------------------------------------------------
# Responding, photos and submission guards
# --------------------------------------------------------------------------
async def _run_with_items(client, auth, **over):
    tpl = await _template(client, auth, **over)
    run_id = (await _generate(client, auth, tpl["id"])).json()["run_ids"][0]
    detail = (await client.get(f"/api/checklist-runs/{run_id}", headers=auth)).json()
    return tpl, detail


async def test_respond_moves_run_in_progress_and_counts(client, auth):
    tpl, run = await _run_with_items(client, auth)
    item = run["items"][0]
    r = await client.patch(
        f"/api/checklist-runs/items/{item['id']}", headers=auth, json={"status": "ok"}
    )
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok" and body["done"] is True
    assert body["responded_by_name"]

    again = (await client.get(f"/api/checklist-runs/{run['id']}", headers=auth)).json()
    assert again["status"] == "in_progress"
    assert again["items_answered"] == 1
    assert again["started_at"] is not None


async def test_submit_blocked_until_every_item_answered(client, auth):
    tpl, run = await _run_with_items(client, auth)
    r = await client.post(f"/api/checklist-runs/{run['id']}/submit", headers=auth)
    assert r.status_code == 422
    assert "unanswered" in r.json()["detail"]


async def test_submit_blocked_until_required_photo_present(client, auth):
    tpl, run = await _run_with_items(client, auth)
    for item in run["items"]:
        await client.patch(
            f"/api/checklist-runs/items/{item['id']}", headers=auth, json={"status": "ok"}
        )
    r = await client.post(f"/api/checklist-runs/{run['id']}/submit", headers=auth)
    assert r.status_code == 422
    assert "photo" in r.json()["detail"]

    # Attach a photo to the camera check, then it goes through.
    camera = next(i for i in run["items"] if i["photo_required"])
    up = await client.post(
        f"/api/attachments/by/task_item/{camera['id']}",
        headers=auth,
        files={"file": ("cameras.jpg", io.BytesIO(b"jpeg-bytes"), "image/jpeg")},
    )
    assert up.status_code == 201

    detail = (await client.get(f"/api/checklist-runs/{run['id']}", headers=auth)).json()
    assert next(i for i in detail["items"] if i["photo_required"])["photo_count"] == 1

    ok = await client.post(f"/api/checklist-runs/{run['id']}/submit", headers=auth)
    assert ok.status_code == 200, ok.text
    assert ok.json()["status"] == "submitted"


async def test_na_item_does_not_require_a_photo(client, auth):
    tpl, run = await _run_with_items(client, auth)
    for item in run["items"]:
        status = "na" if item["photo_required"] else "ok"
        await client.patch(
            f"/api/checklist-runs/items/{item['id']}", headers=auth, json={"status": status}
        )
    r = await client.post(f"/api/checklist-runs/{run['id']}/submit", headers=auth)
    assert r.status_code == 200, r.text


async def test_locked_run_rejects_further_responses(client, auth):
    tpl, run = await _run_with_items(client, auth, requires_verification=False)
    for item in run["items"]:
        await client.patch(
            f"/api/checklist-runs/items/{item['id']}", headers=auth, json={"status": "na"}
        )
    submitted = await client.post(f"/api/checklist-runs/{run['id']}/submit", headers=auth)
    # No verification required -> straight to done.
    assert submitted.json()["status"] == "done"

    r = await client.patch(
        f"/api/checklist-runs/items/{run['items'][0]['id']}",
        headers=auth,
        json={"status": "ok"},
    )
    assert r.status_code == 409


async def test_text_and_number_readings(client, auth):
    tpl, run = await _run_with_items(
        client,
        auth,
        name="Facilities walk",
        team="facilities",
        items=[
            {"title": "Server room temperature (°C)", "response_type": "number", "sort": 0},
            {"title": "Meter reading", "response_type": "text", "sort": 1},
        ],
    )
    r = await client.patch(
        f"/api/checklist-runs/items/{run['items'][0]['id']}",
        headers=auth,
        json={"value": "21.5"},
    )
    assert r.status_code == 200
    body = r.json()
    # A captured reading counts as answered without an explicit status.
    assert body["value"] == "21.5" and body["status"] == "done"


# --------------------------------------------------------------------------
# Issues become tickets
# --------------------------------------------------------------------------
async def test_issue_raises_a_ticket_carrying_the_asset(client, auth):
    asset = (
        await client.post(
            "/api/asset-tracker",
            headers=auth,
            json={"asset_tag": "PRN-001", "name": "HP-DXB-HQ-CS", "category": "Printer"},
        )
    ).json()
    tpl, run = await _run_with_items(
        client,
        auth,
        name="Printer check",
        items=[
            {
                "section": "HQ Building",
                "title": "Printer",
                "response_type": "ok_issue",
                "asset_id": asset["id"],
                "auto_ticket_on_issue": True,
                "ticket_priority": "high",
                "sort": 0,
            }
        ],
    )
    item = run["items"][0]
    r = await client.patch(
        f"/api/checklist-runs/items/{item['id']}",
        headers=auth,
        json={"status": "issue", "note": "needs black ink"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["ticket_number"] is not None
    assert body["asset_name"] == "HP-DXB-HQ-CS"

    tickets = (await client.get("/api/tickets", headers=auth)).json()
    raised = next(t for t in tickets if t["number"] == body["ticket_number"])
    assert raised["category"] == "it"
    assert raised["priority"] == "high"
    assert raised["asset_id"] == asset["id"]
    assert "needs black ink" in raised["description"]
    # SLA targets come from the existing engine.
    assert raised["sla_resolution_due"] is not None

    # Re-marking the same item doesn't open a second ticket.
    again = await client.patch(
        f"/api/checklist-runs/items/{item['id']}", headers=auth, json={"status": "issue"}
    )
    assert again.json()["ticket_number"] == body["ticket_number"]
    assert len((await client.get("/api/tickets", headers=auth)).json()) == 1


async def test_auto_ticket_can_be_switched_off(client, auth):
    tpl, run = await _run_with_items(
        client,
        auth,
        items=[
            {"title": "Cosmetic scuff", "response_type": "ok_issue", "auto_ticket_on_issue": False}
        ],
    )
    r = await client.patch(
        f"/api/checklist-runs/items/{run['items'][0]['id']}",
        headers=auth,
        json={"status": "issue"},
    )
    assert r.json()["ticket_number"] is None
    assert (await client.get("/api/tickets", headers=auth)).json() == []


# --------------------------------------------------------------------------
# Verification
# --------------------------------------------------------------------------
async def _submitted_run_for_member(client, auth):
    """An engineer submits a run whose reviewer is the admin."""
    hdr, uid = await make_member(client, auth, "engineer@agholding.net")
    await client.patch(
        f"/api/users/{uid}", headers=auth, json={"permissions": IT_MODULES}
    )
    me = (await client.get("/api/auth/me", headers=auth)).json()
    tpl = await _template(
        client, auth, assignee_id=uid, reviewer_id=me["id"], items=[{"title": "TV"}]
    )
    run_id = (await _generate(client, auth, tpl["id"])).json()["run_ids"][0]
    detail = (await client.get(f"/api/checklist-runs/{run_id}", headers=hdr)).json()
    await client.patch(
        f"/api/checklist-runs/items/{detail['items'][0]['id']}",
        headers=hdr,
        json={"status": "ok"},
    )
    submitted = await client.post(f"/api/checklist-runs/{run_id}/submit", headers=hdr)
    assert submitted.status_code == 200, submitted.text
    assert submitted.json()["status"] == "submitted"
    return hdr, uid, run_id


async def test_reviewer_verifies_run(client, auth):
    hdr, uid, run_id = await _submitted_run_for_member(client, auth)

    queue = (
        await client.get("/api/checklist-runs?awaiting_verification=true", headers=auth)
    ).json()
    assert [r["id"] for r in queue] == [run_id]

    r = await client.post(
        f"/api/checklist-runs/{run_id}/verify",
        headers=auth,
        json={"decision": "verify", "note": "Signed off"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "done"
    assert body["verified_at"] and body["verified_by_name"]
    assert body["review_note"] == "Signed off"


async def test_reviewer_sends_run_back(client, auth):
    hdr, uid, run_id = await _submitted_run_for_member(client, auth)
    r = await client.post(
        f"/api/checklist-runs/{run_id}/verify",
        headers=auth,
        json={"decision": "reject", "note": "Photo of the rack is missing"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "in_progress"
    assert body["submitted_at"] is None

    # The engineer can edit again after a send-back.
    detail = (await client.get(f"/api/checklist-runs/{run_id}", headers=hdr)).json()
    edit = await client.patch(
        f"/api/checklist-runs/items/{detail['items'][0]['id']}",
        headers=hdr,
        json={"status": "issue", "note": "actually broken"},
    )
    assert edit.status_code == 200


async def test_checker_cannot_verify_their_own_run(client, auth):
    hdr, uid, run_id = await _submitted_run_for_member(client, auth)
    r = await client.post(
        f"/api/checklist-runs/{run_id}/verify", headers=hdr, json={"decision": "verify"}
    )
    assert r.status_code == 403


async def test_verify_requires_submitted_state(client, auth):
    tpl, run = await _run_with_items(client, auth, items=[{"title": "TV"}])
    r = await client.post(
        f"/api/checklist-runs/{run['id']}/verify", headers=auth, json={"decision": "verify"}
    )
    assert r.status_code == 409


# --------------------------------------------------------------------------
# Rota claiming
# --------------------------------------------------------------------------
async def test_department_rota_run_can_be_claimed(client, auth):
    depts = (await client.get("/api/departments", headers=auth)).json()
    dept = depts[0]
    hdr, uid = await make_member(client, auth, "rota@agholding.net")
    await client.patch(
        f"/api/users/{uid}",
        headers=auth,
        json={"department_id": dept["id"], "permissions": IT_MODULES},
    )
    tpl = await _template(
        client,
        auth,
        assignee_id=None,
        assignee_department_id=dept["id"],
        requires_verification=False,
        items=[{"title": "TV"}],
    )
    run_id = (await _generate(client, auth, tpl["id"])).json()["run_ids"][0]

    # Visible to the department even though nobody owns it yet.
    mine = (await client.get("/api/checklist-runs?mine=true", headers=hdr)).json()
    assert [r["id"] for r in mine] == [run_id]

    claimed = await client.post(f"/api/checklist-runs/{run_id}/claim", headers=hdr)
    assert claimed.status_code == 200
    assert claimed.json()["assignee_id"] == uid

    # A second person can no longer take it.
    other, other_id = await make_member(client, auth, "other@agholding.net")
    await client.patch(
        f"/api/users/{other_id}",
        headers=auth,
        json={"department_id": dept["id"], "permissions": IT_MODULES},
    )
    assert (
        await client.post(f"/api/checklist-runs/{run_id}/claim", headers=other)
    ).status_code == 409


# --------------------------------------------------------------------------
# Reporting
# --------------------------------------------------------------------------
async def test_compliance_summary_and_hotspots(client, auth):
    tpl, run = await _run_with_items(
        client,
        auth,
        requires_verification=False,
        items=[
            {"section": "HQ Building", "title": "Printer", "response_type": "ok_issue", "sort": 0},
            {"section": "HQ Building", "title": "TV", "response_type": "ok_issue", "sort": 1},
        ],
    )
    await client.patch(
        f"/api/checklist-runs/items/{run['items'][0]['id']}",
        headers=auth,
        json={"status": "issue", "note": "black ink"},
    )
    await client.patch(
        f"/api/checklist-runs/items/{run['items'][1]['id']}", headers=auth, json={"status": "ok"}
    )
    await client.post(f"/api/checklist-runs/{run['id']}/submit", headers=auth)

    summary = (await client.get("/api/checklist-runs/summary", headers=auth)).json()
    assert summary["runs"] == 1
    assert summary["verified"] == 1
    assert summary["issues"] == 1
    assert summary["completion_rate"] == 100.0
    assert summary["by_template"][0]["template_name"] == tpl["name"]
    hot = summary["hotspots"][0]
    assert hot["title"] == "Printer" and hot["issue_count"] == 1
    assert hot["section"] == "HQ Building"


async def test_summary_is_manager_only(client, auth):
    hdr, uid = await make_member(client, auth, "grunt@agholding.net")
    await client.patch(f"/api/users/{uid}", headers=auth, json={"permissions": IT_MODULES})
    assert (await client.get("/api/checklist-runs/summary", headers=hdr)).status_code == 403


async def test_members_cannot_author_templates(client, auth):
    hdr, uid = await make_member(client, auth, "author@agholding.net")
    await client.patch(f"/api/users/{uid}", headers=auth, json={"permissions": IT_MODULES})
    r = await client.post("/api/checklist-templates", headers=hdr, json=_template_body())
    assert r.status_code == 403


async def test_module_gating(client, auth):
    """A member without the module can't reach the feature at all."""
    hdr, uid = await make_member(client, auth, "nomodule@agholding.net")
    assert (await client.get("/api/checklist-templates", headers=hdr)).status_code == 403
    assert (await client.get("/api/checklist-runs", headers=hdr)).status_code == 403


async def test_run_is_not_visible_to_unrelated_member(client, auth):
    tpl, run = await _run_with_items(client, auth, items=[{"title": "TV"}])
    hdr, uid = await make_member(client, auth, "stranger@agholding.net")
    await client.patch(f"/api/users/{uid}", headers=auth, json={"permissions": IT_MODULES})
    assert (
        await client.get(f"/api/checklist-runs/{run['id']}", headers=hdr)
    ).status_code == 403
    assert (await client.get("/api/checklist-runs", headers=hdr)).json() == []


# --------------------------------------------------------------------------
# Lateness
# --------------------------------------------------------------------------
async def test_yesterdays_unsubmitted_run_is_late(client, auth):
    tpl = await _template(client, auth, items=[{"title": "TV"}])
    yesterday = date.today() - timedelta(days=1)
    r = await _generate(client, auth, tpl["id"], on=yesterday)
    assert r.json()["created"] == 1

    runs = (await client.get("/api/checklist-runs", headers=auth)).json()
    stale = next(x for x in runs if x["run_date"] == yesterday.isoformat())
    assert stale["is_late"] is True
    assert stale["status"] == "todo"


async def test_missed_alerts_notify_the_reviewer(client, auth):
    from app.core.database import AsyncSessionLocal
    from app.services.checklist_runs import run_missed_alerts

    hdr, uid, run_id = await _submitted_run_for_member(client, auth)
    # A submitted run is not late, so nothing fires.
    async with AsyncSessionLocal() as db:
        assert (await run_missed_alerts(db))["created"] == 0

    # An unsubmitted run from yesterday does.
    me = (await client.get("/api/auth/me", headers=auth)).json()
    tpl = await _template(
        client, auth, name="Stale round", reviewer_id=me["id"], items=[{"title": "TV"}]
    )
    await _generate(client, auth, tpl["id"], on=date.today() - timedelta(days=1))
    async with AsyncSessionLocal() as db:
        assert (await run_missed_alerts(db))["created"] >= 1
        # Dedup key stops a second nag for the same run.
        assert (await run_missed_alerts(db))["created"] == 0


# --------------------------------------------------------------------------
# The plain-task recurrence gap this feature also fixes
# --------------------------------------------------------------------------
async def test_recurring_plain_task_carries_its_checklist_forward(client, auth):
    task = (
        await client.post(
            "/api/tasks",
            headers=auth,
            json={"title": "Weekly backup verify", "recurrence": "weekly"},
        )
    ).json()
    for title in ("Check tape", "Check offsite copy"):
        await client.post(
            f"/api/tasks/{task['id']}/items", headers=auth, json={"title": title}
        )
    await client.patch(f"/api/tasks/{task['id']}", headers=auth, json={"status": "done"})

    tasks = (await client.get("/api/tasks", headers=auth)).json()
    nxt = next(t for t in tasks if t["id"] != task["id"])
    assert nxt["subtasks_total"] == 2
    assert nxt["subtasks_done"] == 0
    detail = (await client.get(f"/api/tasks/{nxt['id']}", headers=auth)).json()
    assert sorted(i["title"] for i in detail["items"]) == [
        "Check offsite copy",
        "Check tape",
    ]


# --------------------------------------------------------------------------
# Starter templates (multi-department)
# --------------------------------------------------------------------------
async def test_starter_templates_cover_several_departments(client, auth):
    r = await client.post("/api/checklist-templates/samples", headers=auth)
    assert r.status_code == 201, r.text
    seeded = r.json()
    by_name = {t["name"]: t for t in seeded}
    assert set(by_name) == {
        "Morning IT Checks",
        "Facilities Daily Walk-through",
        "Weekly Lab Safety Round",
    }
    assert {t["team"] for t in seeded} == {"it", "facilities", "other"}
    assert {t["schedule"] for t in seeded} == {"daily", "weekdays", "weekly"}

    # The IT round is the full paper form.
    it = (
        await client.get(
            f"/api/checklist-templates/{by_name['Morning IT Checks']['id']}", headers=auth
        )
    ).json()
    assert it["item_count"] > 90
    sections = {i["section"] for i in it["items"]}
    assert "HQ Building / Dr T's Office (Inside)" in sections
    assert "Printer Check — All Locations" in sections
    assert any(i["title"].startswith("HP-DXB-HQ-CS") for i in it["items"])
    assert any(i["photo_required"] and i["title"] == "Check All Cameras" for i in it["items"])

    # Facilities mixes response types.
    fac = (
        await client.get(
            f"/api/checklist-templates/{by_name['Facilities Daily Walk-through']['id']}",
            headers=auth,
        )
    ).json()
    assert {i["response_type"] for i in fac["items"]} >= {"ok_issue", "number", "text"}

    # Re-seeding is a no-op.
    again = await client.post("/api/checklist-templates/samples", headers=auth)
    assert again.json() == []


async def test_seeded_it_round_generates_a_usable_run(client, auth):
    await client.post("/api/checklist-templates/samples", headers=auth)
    templates = (await client.get("/api/checklist-templates?team=it", headers=auth)).json()
    tpl_id = templates[0]["id"]
    gen = await _generate(client, auth, tpl_id)
    assert gen.json()["created"] == 1
    run = (
        await client.get(f"/api/checklist-runs/{gen.json()['run_ids'][0]}", headers=auth)
    ).json()
    assert run["items_total"] > 90
    # Items arrive grouped and in form order.
    assert run["items"][0]["section"] == "HQ Building / Dr T's Office (Inside)"
    assert run["items"][0]["title"] == "TV"
