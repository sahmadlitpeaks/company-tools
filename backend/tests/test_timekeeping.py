import pytest

from helpers import make_member

pytestmark = pytest.mark.asyncio


async def test_clock_toggle_and_manual_entries(client, auth):
    hdr, uid = await make_member(client, auth, "time-emp@agholding.net")

    # Clock in then out -> one entry with minutes computed.
    a = (await client.post("/api/time/clock", headers=hdr)).json()
    assert a["clock_in"] and not a["clock_out"]
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
