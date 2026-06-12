import pytest

from helpers import make_member

pytestmark = pytest.mark.asyncio


async def test_goals_visibility(client, auth):
    hdr_mgr, mgr = await make_member(client, auth, "perf-mgr@agholding.net", role="manager")
    hdr_emp, emp = await make_member(client, auth, "perf-emp@agholding.net")
    await client.patch(f"/api/users/{emp}", headers=auth, json={"manager_id": mgr})

    # Employee sets their own goal.
    g = await client.post(
        f"/api/performance/goals/by-user/{emp}", headers=hdr_emp,
        json={"title": "Ship HR module", "due_date": "2026-12-31"},
    )
    assert g.status_code == 201
    gid = g.json()["id"]

    # Their manager can see and update progress.
    seen = (await client.get(f"/api/performance/goals/by-user/{emp}", headers=hdr_mgr)).json()
    assert any(x["id"] == gid for x in seen)
    upd = await client.patch(
        f"/api/performance/goals/{gid}", headers=hdr_mgr,
        json={"progress": 60, "status": "in_progress"},
    )
    assert upd.status_code == 200 and upd.json()["progress"] == 60

    # An unrelated member cannot see them.
    hdr_other, _ = await make_member(client, auth, "perf-other@agholding.net")
    assert (await client.get(f"/api/performance/goals/by-user/{emp}", headers=hdr_other)).status_code == 403

    # Invalid status rejected; clamping progress.
    bad = await client.post(
        f"/api/performance/goals/by-user/{emp}", headers=hdr_emp,
        json={"title": "x", "status": "bogus"},
    )
    assert bad.status_code == 422


async def test_review_cycle_flow(client, auth):
    hdr_mgr, mgr = await make_member(client, auth, "rev-mgr@agholding.net", role="manager")
    hdr_emp, emp = await make_member(client, auth, "rev-emp@agholding.net")
    await client.patch(f"/api/users/{emp}", headers=auth, json={"manager_id": mgr})

    # Cycles are HR-managed.
    assert (await client.get("/api/performance/cycles", headers=hdr_emp)).status_code == 403
    cycle = await client.post(
        "/api/performance/cycles", headers=auth, json={"name": "2026 H1", "period": "H1 2026"},
    )
    assert cycle.status_code == 201
    cid = cycle.json()["id"]

    # HR opens a review for the employee; it defaults to the manager as reviewer.
    rev = await client.post(
        "/api/performance/reviews", headers=auth,
        json={"cycle_id": cid, "user_id": emp},
    )
    assert rev.status_code == 201
    rid = rev.json()["id"]
    assert rev.json()["reviewer_id"] == mgr

    # Duplicate review for same cycle/user is rejected.
    dup = await client.post("/api/performance/reviews", headers=auth, json={"cycle_id": cid, "user_id": emp})
    assert dup.status_code == 409

    # The manager fills it in and submits.
    filled = await client.patch(
        f"/api/performance/reviews/{rid}", headers=hdr_mgr,
        json={"rating": 4, "summary": "Strong year", "status": "submitted"},
    )
    assert filled.status_code == 200
    assert filled.json()["rating"] == 4 and filled.json()["submitted_at"]

    # The employee sees their submitted review; the cycle reflects counts.
    mine = (await client.get("/api/performance/reviews?scope=mine", headers=hdr_emp)).json()
    assert any(r["id"] == rid for r in mine)
    cycles = (await client.get("/api/performance/cycles", headers=auth)).json()
    this = next(c for c in cycles if c["id"] == cid)
    assert this["review_count"] == 1 and this["submitted_count"] == 1

    # Rating bounds enforced.
    bad = await client.patch(f"/api/performance/reviews/{rid}", headers=hdr_mgr, json={"rating": 9})
    assert bad.status_code == 422
