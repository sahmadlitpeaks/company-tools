import pytest

from helpers import make_member

pytestmark = pytest.mark.asyncio


async def test_360_feedback_flow(client, auth):
    mgr_hdr, mgr = await make_member(client, auth, "perf-mgr@agholding.net", role="manager")
    emp_hdr, emp = await make_member(client, auth, "perf-emp@agholding.net")
    peer_hdr, peer = await make_member(client, auth, "perf-peer@agholding.net")
    await client.patch(f"/api/users/{emp}", headers=auth, json={"manager_id": mgr})

    cycle = (await client.post("/api/performance/cycles", headers=auth, json={"name": "2026 H1"})).json()
    review = (await client.post("/api/performance/reviews", headers=auth, json={
        "cycle_id": cycle["id"], "user_id": emp, "reviewer_id": mgr,
    })).json()

    # The reviewer requests 360 feedback from a peer.
    fb = await client.post(f"/api/performance/reviews/{review['id']}/feedback", headers=mgr_hdr, json={
        "author_id": peer, "relation": "peer",
    })
    assert fb.status_code == 201 and fb.json()["status"] == "requested"
    fid = fb.json()["id"]

    # Peer sees it in their queue and submits.
    queue = (await client.get("/api/performance/feedback/mine", headers=peer_hdr)).json()
    assert any(x["id"] == fid for x in queue)
    sub = await client.patch(f"/api/performance/feedback/{fid}", headers=peer_hdr, json={
        "rating": 5, "strengths": "Reliable", "improvements": "Delegate more",
    })
    assert sub.status_code == 200 and sub.json()["status"] == "submitted"

    # The manager can read the collected feedback; an unrelated person cannot.
    seen = (await client.get(f"/api/performance/reviews/{review['id']}/feedback", headers=mgr_hdr)).json()
    assert len(seen) == 1 and seen[0]["rating"] == 5
    assert (await client.get(f"/api/performance/reviews/{review['id']}/feedback", headers=emp_hdr)).status_code == 403


async def test_one_on_ones(client, auth):
    mgr_hdr, mgr = await make_member(client, auth, "1on1-mgr@agholding.net", role="manager")
    emp_hdr, emp = await make_member(client, auth, "1on1-emp@agholding.net")
    await client.patch(f"/api/users/{emp}", headers=auth, json={"manager_id": mgr})

    # A non-manager can't schedule a 1:1 with the employee.
    other_hdr, _ = await make_member(client, auth, "1on1-other@agholding.net")
    assert (await client.post("/api/performance/one-on-ones", headers=other_hdr, json={
        "employee_id": emp, "scheduled_at": "2026-07-01T10:00:00Z",
    })).status_code == 403

    o = await client.post("/api/performance/one-on-ones", headers=mgr_hdr, json={
        "employee_id": emp, "scheduled_at": "2026-07-01T10:00:00Z",
        "agenda": [{"text": "Career goals"}], "shared_notes": "",
    })
    assert o.status_code == 201
    oid = o.json()["id"]

    # Both parties see it; the employee can tick agenda items.
    assert any(x["id"] == oid for x in (await client.get("/api/performance/one-on-ones", headers=emp_hdr)).json())
    upd = await client.patch(f"/api/performance/one-on-ones/{oid}", headers=emp_hdr, json={
        "status": "completed", "agenda": [{"text": "Career goals", "done": True}],
    })
    assert upd.status_code == 200 and upd.json()["status"] == "completed"
    assert upd.json()["agenda"][0]["done"] is True


async def test_continuous_feedback_visibility(client, auth):
    mgr_hdr, mgr = await make_member(client, auth, "cf-mgr@agholding.net", role="manager")
    emp_hdr, emp = await make_member(client, auth, "cf-emp@agholding.net")
    giver_hdr, giver = await make_member(client, auth, "cf-giver@agholding.net")
    await client.patch(f"/api/users/{emp}", headers=auth, json={"manager_id": mgr})

    assert (await client.post("/api/performance/continuous-feedback", headers=giver_hdr, json={
        "to_user_id": emp, "body": "Consider sharing updates earlier",
    })).status_code == 201

    # The recipient and their manager can read it; an unrelated peer cannot.
    assert len((await client.get(f"/api/performance/continuous-feedback/about/{emp}", headers=emp_hdr)).json()) == 1
    assert len((await client.get(f"/api/performance/continuous-feedback/about/{emp}", headers=mgr_hdr)).json()) == 1
    assert (await client.get(f"/api/performance/continuous-feedback/about/{emp}", headers=giver_hdr)).status_code == 403
