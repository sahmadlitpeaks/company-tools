import pytest

from helpers import make_member

pytestmark = pytest.mark.asyncio


async def test_expense_lifecycle_with_approval(client, auth):
    emp_hdr, emp = await make_member(client, auth, "exp-emp@agholding.net")

    # Create a draft, edit it, then submit.
    claim = (await client.post("/api/expenses", headers=emp_hdr, json={
        "title": "Taxi to client", "category": "travel", "amount": 42.50, "currency": "USD",
        "expense_date": "2026-06-01",
    })).json()
    assert claim["status"] == "draft"
    bad = await client.post("/api/expenses", headers=emp_hdr, json={"title": "x", "category": "rocket", "amount": 1})
    assert bad.status_code == 422

    upd = await client.patch(f"/api/expenses/{claim['id']}", headers=emp_hdr, json={"amount": 45})
    assert upd.status_code == 200 and float(upd.json()["amount"]) == 45.0

    sub = await client.post(f"/api/expenses/{claim['id']}/submit", headers=emp_hdr)
    assert sub.status_code == 200 and sub.json()["status"] == "submitted"
    req_id = sub.json()["approval_request_id"]
    assert req_id

    # Can't edit once submitted.
    assert (await client.patch(f"/api/expenses/{claim['id']}", headers=emp_hdr, json={"amount": 99})).status_code == 409

    # Admin approves the underlying approval request → claim shows approved.
    await client.post(f"/api/approvals/{req_id}/decision", headers=auth, json={"status": "approved"})
    mine = (await client.get("/api/expenses/my", headers=emp_hdr)).json()
    assert mine[0]["status"] == "approved"

    # HR reimburses; employee cannot.
    assert (await client.post(f"/api/expenses/{claim['id']}/reimburse", headers=emp_hdr)).status_code == 403
    reimb = await client.post(f"/api/expenses/{claim['id']}/reimburse", headers=auth)
    assert reimb.status_code == 200 and reimb.json()["status"] == "reimbursed"


async def test_expense_receipt_and_visibility(client, auth):
    emp_hdr, emp = await make_member(client, auth, "exp-receipt@agholding.net")
    claim = (await client.post("/api/expenses", headers=emp_hdr, json={
        "title": "Lunch", "category": "meals", "amount": 20,
    })).json()

    up = await client.post(
        f"/api/expenses/{claim['id']}/receipt", headers=emp_hdr,
        files={"file": ("receipt.txt", b"receipt-bytes", "text/plain")},
    )
    assert up.status_code == 200 and up.json()["has_receipt"] is True

    # Owner can download; an unrelated plain member cannot.
    assert (await client.get(f"/api/expenses/{claim['id']}/receipt", headers=emp_hdr)).status_code == 200
    other_hdr, _ = await make_member(client, auth, "exp-other@agholding.net")
    assert (await client.get(f"/api/expenses/{claim['id']}/receipt", headers=other_hdr)).status_code == 403


async def test_expense_list_requires_manager_or_hr(client, auth):
    depts = (await client.get("/api/departments", headers=auth)).json()
    it_id = next(d["id"] for d in depts if d["name"] == "IT")
    member_hdr, mid = await make_member(client, auth, "exp-nobody@agholding.net")
    await client.patch(f"/api/users/{mid}", headers=auth, json={"department_id": it_id})
    assert (await client.get("/api/expenses", headers=member_hdr)).status_code == 403
    assert (await client.get("/api/expenses", headers=auth)).status_code == 200
