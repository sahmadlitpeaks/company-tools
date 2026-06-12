import pytest

from helpers import make_member

pytestmark = pytest.mark.asyncio


async def test_two_step_workflow_manager_then_hr(client, auth):
    # Build a manager -> HR two-step workflow for expenses.
    mgr_hdr, mgr = await make_member(client, auth, "wf-mgr@agholding.net", role="manager")
    emp_hdr, emp = await make_member(client, auth, "wf-emp@agholding.net")
    await client.patch(f"/api/users/{emp}", headers=auth, json={"manager_id": mgr})

    wf = await client.post("/api/approval-workflows", headers=auth, json={
        "type": "expense", "name": "Expense approval",
        "steps": [{"approver": "manager"}, {"approver": "hr"}],
    })
    assert wf.status_code == 201

    # Employee files an expense → routed to their manager first.
    req = (await client.post("/api/approvals", headers=emp_hdr, json={
        "type": "expense", "title": "Client dinner", "amount": 200,
    })).json()
    assert req["status"] == "pending" and req["approver_id"] == mgr

    # A random member cannot decide.
    other_hdr, _ = await make_member(client, auth, "wf-other@agholding.net")
    assert (await client.post(f"/api/approvals/{req['id']}/decision", headers=other_hdr, json={"status": "approved"})).status_code == 403

    # Manager approves step 1 → still pending, now awaiting HR (admin is HR here).
    d1 = await client.post(f"/api/approvals/{req['id']}/decision", headers=mgr_hdr, json={"status": "approved"})
    assert d1.status_code == 200 and d1.json()["status"] == "pending"

    # Step timeline reflects one approved, one pending.
    steps = (await client.get(f"/api/approvals/{req['id']}/steps", headers=auth)).json()
    assert [s["status"] for s in steps] == ["approved", "pending"]
    assert steps[0]["approver_kind"] == "manager" and steps[1]["approver_kind"] == "hr"

    # The admin (HR) approves the final step → fully approved.
    d2 = await client.post(f"/api/approvals/{req['id']}/decision", headers=auth, json={"status": "approved"})
    assert d2.status_code == 200 and d2.json()["status"] == "approved"
    steps2 = (await client.get(f"/api/approvals/{req['id']}/steps", headers=auth)).json()
    assert [s["status"] for s in steps2] == ["approved", "approved"]


async def test_min_amount_skips_step(client, auth):
    mgr_hdr, mgr = await make_member(client, auth, "wf2-mgr@agholding.net", role="manager")
    emp_hdr, emp = await make_member(client, auth, "wf2-emp@agholding.net")
    await client.patch(f"/api/users/{emp}", headers=auth, json={"manager_id": mgr})

    # HR step only applies to purchases >= 1000.
    await client.post("/api/approval-workflows", headers=auth, json={
        "type": "purchase", "name": "Purchase",
        "steps": [{"approver": "manager"}, {"approver": "hr", "min_amount": 1000}],
    })

    # A small purchase: HR step is skipped, so manager approval finalises it.
    small = (await client.post("/api/approvals", headers=emp_hdr, json={
        "type": "purchase", "title": "Stapler", "amount": 20,
    })).json()
    d = await client.post(f"/api/approvals/{small['id']}/decision", headers=mgr_hdr, json={"status": "approved"})
    assert d.json()["status"] == "approved"
    steps = (await client.get(f"/api/approvals/{small['id']}/steps", headers=auth)).json()
    assert steps[1]["status"] == "skipped"


async def test_rejection_short_circuits(client, auth):
    mgr_hdr, mgr = await make_member(client, auth, "wf3-mgr@agholding.net", role="manager")
    emp_hdr, emp = await make_member(client, auth, "wf3-emp@agholding.net")
    await client.patch(f"/api/users/{emp}", headers=auth, json={"manager_id": mgr})
    await client.post("/api/approval-workflows", headers=auth, json={
        "type": "expense", "name": "Expense", "steps": [{"approver": "manager"}, {"approver": "hr"}],
    })
    req = (await client.post("/api/approvals", headers=emp_hdr, json={
        "type": "expense", "title": "Nope", "amount": 50,
    })).json()
    d = await client.post(f"/api/approvals/{req['id']}/decision", headers=mgr_hdr, json={"status": "rejected", "note": "no"})
    assert d.json()["status"] == "rejected"


async def test_classic_flow_unaffected_without_workflow(client, auth):
    # No workflow for "general" → classic single-approver behaviour preserved.
    emp_hdr, emp = await make_member(client, auth, "wf4-emp@agholding.net")
    req = (await client.post("/api/approvals", headers=emp_hdr, json={
        "type": "general", "title": "Misc",
    })).json()
    # Admin can decide directly.
    d = await client.post(f"/api/approvals/{req['id']}/decision", headers=auth, json={"status": "approved"})
    assert d.status_code == 200 and d.json()["status"] == "approved"
    # No steps were created.
    assert (await client.get(f"/api/approvals/{req['id']}/steps", headers=auth)).json() == []
