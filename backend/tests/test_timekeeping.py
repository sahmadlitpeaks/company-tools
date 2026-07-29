import pytest
from datetime import date, timedelta

from helpers import make_member

pytestmark = pytest.mark.asyncio


async def test_clock_toggle_and_manual_entries(client, auth):
    hdr, uid = await make_member(client, auth, "time-emp@agholding.net")

    # Clock in then out -> one entry with minutes computed.
    a = (await client.post("/api/time/clock", headers=hdr)).json()
    assert a["clock_in"] and not a["clock_out"]
    br = await client.post("/api/time/break", headers=hdr)
    assert br.status_code == 200 and br.json()["ended_at"] is None
    br2 = await client.post("/api/time/break", headers=hdr)
    assert br2.status_code == 200 and br2.json()["ended_at"]
    b = (await client.post("/api/time/clock", headers=hdr)).json()
    assert b["id"] == a["id"] and b["clock_out"] and b["minutes"] >= 0

    # Manual entry needs minutes.
    bad = await client.post("/api/time/entries", headers=hdr, json={"work_date": "2026-06-15"})
    assert bad.status_code == 422
    ent = await client.post("/api/time/entries", headers=hdr, json={
        "work_date": "2026-06-15", "minutes": 480, "note": "Project work",
    })
    assert ent.status_code == 201 and ent.json()["minutes"] == 480

    summary = (await client.get("/api/time/summary", headers=hdr)).json()
    assert summary["week_status"] == "open"
    assert summary["active_break"] is None
    assert summary["today_completed_work_seconds"] >= 0
    assert summary["today_completed_break_seconds"] >= 0
    assert summary["open_completed_break_seconds"] == 0


async def test_clear_today_reopens_week_and_resets_timer(client, auth):
    hdr, _ = await make_member(client, auth, "time-reset@agholding.net")
    other_hdr, _ = await make_member(client, auth, "time-reset-other@agholding.net")

    started = await client.post("/api/time/clock", headers=hdr)
    assert started.status_code == 200
    await client.post("/api/time/break", headers=hdr)
    await client.post("/api/time/break", headers=hdr)
    await client.post("/api/time/clock", headers=hdr)
    await client.post("/api/time/clock", headers=other_hdr)

    today = date.today()
    week_start = today - timedelta(days=today.weekday())
    submitted = await client.post(
        f"/api/time/timesheet/submit?week={week_start.isoformat()}",
        headers=hdr,
    )
    assert submitted.status_code == 200
    assert submitted.json()["status"] == "submitted"

    reset = await client.delete("/api/time/today", headers=hdr)
    assert reset.status_code == 200
    assert reset.json()["deleted_entries"] == 1
    assert reset.json()["reopened_timesheet"] is True

    summary = (await client.get("/api/time/summary", headers=hdr)).json()
    assert summary["open_entry"] is None
    assert summary["active_break"] is None
    assert summary["today_minutes"] == 0
    assert summary["today_completed_work_seconds"] == 0
    assert summary["today_completed_break_seconds"] == 0
    assert summary["week_status"] == "open"

    restarted = await client.post("/api/time/clock", headers=hdr)
    assert restarted.status_code == 200
    assert restarted.json()["clock_out"] is None
    other_summary = (await client.get("/api/time/summary", headers=other_hdr)).json()
    assert other_summary["open_entry"] is not None

    await client.delete("/api/time/today", headers=hdr)
    await client.delete("/api/time/today", headers=other_hdr)


async def test_time_correction_request_and_decision(client, auth):
    hdr_mgr, mgr = await make_member(client, auth, "corr-mgr@agholding.net", role="manager")
    hdr, uid = await make_member(client, auth, "corr-user@agholding.net")
    await client.patch(f"/api/users/{uid}", headers=auth, json={"manager_id": mgr})
    ent = (await client.post("/api/time/entries", headers=hdr, json={
        "work_date": "2026-06-15", "minutes": 120,
    })).json()
    req = await client.post("/api/time/corrections", headers=hdr, json={
        "entry_id": ent["id"], "requested_minutes": 180, "reason": "Forgot the final hour",
    })
    assert req.status_code == 201 and req.json()["status"] == "pending"
    queue = (await client.get("/api/time/corrections?scope=review", headers=hdr_mgr)).json()
    assert len(queue) == 1
    dec = await client.post(
        f"/api/time/corrections/{req.json()['id']}/decision",
        headers=hdr_mgr,
        json={"status": "approved"},
    )
    assert dec.status_code == 200 and dec.json()["status"] == "approved"
    sheet = (await client.get("/api/time/timesheet?week=2026-06-15", headers=hdr)).json()
    assert sheet["total_minutes"] == 180


async def test_timesheet_submit_and_manager_approval(client, auth):
    hdr_mgr, mgr = await make_member(client, auth, "time-mgr@agholding.net", role="manager")
    hdr, uid = await make_member(client, auth, "time-rep@agholding.net")
    await client.patch(f"/api/users/{uid}", headers=auth, json={"manager_id": mgr})

    # Log time in the week of 2026-06-15 (Mon) and submit it.
    await client.post("/api/time/entries", headers=hdr, json={"work_date": "2026-06-16", "minutes": 420})
    ts = (await client.get("/api/time/timesheet?week=2026-06-15", headers=hdr)).json()
    assert ts["total_minutes"] == 420 and ts["status"] == "open"

    sub = (await client.post("/api/time/timesheet/submit?week=2026-06-15", headers=hdr)).json()
    assert sub["status"] == "submitted" and sub["id"]

    # Once submitted the week is locked for edits.
    locked = await client.post("/api/time/entries", headers=hdr, json={"work_date": "2026-06-17", "minutes": 60})
    assert locked.status_code == 409

    # Manager sees it in approvals and approves.
    queue = (await client.get("/api/time/approvals", headers=hdr_mgr)).json()
    assert any(t["user_id"] == uid for t in queue)
    tsid = next(t for t in queue if t["user_id"] == uid)["id"]
    dec = await client.post(f"/api/time/timesheet/{tsid}/decision", headers=hdr_mgr, json={"status": "approved"})
    assert dec.status_code == 200 and dec.json()["status"] == "approved"

    # An unrelated member can't view the report's timesheet.
    hdr_other, _ = await make_member(client, auth, "time-other@agholding.net")
    assert (await client.get(f"/api/time/timesheet?week=2026-06-15&user_id={uid}", headers=hdr_other)).status_code == 403


async def test_schedule_crud_and_overtime(client, auth):
    # HR creates a default schedule of 8h Mon–Fri.
    sched = await client.post("/api/time/schedules", headers=auth, json={
        "name": "Standard 40h", "daily_minutes": 480, "workdays": [0, 1, 2, 3, 4], "is_default": True,
    })
    assert sched.status_code == 201
    sid = sched.json()["id"]

    hdr, uid = await make_member(client, auth, "time-ot@agholding.net")
    # A non-HR member cannot manage schedules.
    assert (await client.post("/api/time/schedules", headers=hdr, json={"name": "X"})).status_code == 403

    # Log a 50h week (3000 min) → expected 2400, overtime 600.
    for day in ("2026-06-15", "2026-06-16", "2026-06-17", "2026-06-18", "2026-06-19"):
        await client.post("/api/time/entries", headers=hdr, json={"work_date": day, "minutes": 600})
    ts = (await client.get("/api/time/timesheet?week=2026-06-15", headers=hdr)).json()
    assert ts["total_minutes"] == 3000
    assert ts["expected_minutes"] == 2400
    assert ts["overtime_minutes"] == 600

    # Assigning a schedule to the user is reflected in the count.
    assign = await client.put(f"/api/time/users/{uid}/schedule", headers=auth, json={"schedule_id": sid})
    assert assign.status_code == 200
    schedules = (await client.get("/api/time/schedules", headers=auth)).json()
    assert next(s for s in schedules if s["id"] == sid)["assigned_count"] == 1


async def test_leave_reconciliation_on_timesheet(client, auth):
    hdr, uid = await make_member(client, auth, "time-leave@agholding.net")
    annual = next(
        t for t in (await client.get("/api/leave/types", headers=auth)).json() if t["name"] == "Annual"
    )
    # Approved 2-day leave inside the week of 2026-06-15.
    req = await client.post("/api/approvals", headers=hdr, json={
        "type": "leave", "title": "Off", "leave_type_id": annual["id"],
        "start_date": "2026-06-15", "end_date": "2026-06-16",
    })
    await client.post(f"/api/approvals/{req.json()['id']}/decision", headers=auth, json={"status": "approved"})

    ts = (await client.get(f"/api/time/timesheet?week=2026-06-15&user_id={uid}", headers=auth)).json()
    assert ts["leave_days"] == 2
