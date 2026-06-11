import pytest

from helpers import make_member

pytestmark = pytest.mark.asyncio


async def _set_salary(client, auth, uid, amount, pay_period):
    return await client.post(
        f"/api/compensation/by-user/{uid}",
        headers=auth,
        json={
            "record_type": "salary",
            "amount": amount,
            "currency": "USD",
            "pay_period": pay_period,
            "effective_date": "2026-01-01",
        },
    )


async def test_payroll_run_lifecycle(client, auth):
    # Two active employees: one on a monthly salary, one on annual.
    monthly_auth, monthly_id = await make_member(
        client, auth, "pay-monthly@agholding.net"
    )
    annual_auth, annual_id = await make_member(
        client, auth, "pay-annual@agholding.net"
    )
    assert (await _set_salary(client, auth, monthly_id, 10000, "monthly")).status_code == 201
    assert (await _set_salary(client, auth, annual_id, 120000, "annual")).status_code == 201

    # Create the run → one payslip per active employee, base seeded to monthly.
    run = (await client.post("/api/payroll/runs", headers=auth, json={"period": "2026-06"})).json()
    assert run["status"] == "draft"
    assert run["payslip_count"] >= 2

    detail = (await client.get(f"/api/payroll/runs/{run['id']}", headers=auth)).json()
    slips = {s["user_id"]: s for s in detail["payslips"]}
    assert float(slips[monthly_id]["base_salary"]) == 10000.0
    assert float(slips[annual_id]["base_salary"]) == 10000.0  # 120000 / 12

    # Adjust one payslip: add a bonus earning and a deduction; totals recalc.
    slip = slips[monthly_id]
    adj = await client.patch(
        f"/api/payroll/payslips/{slip['id']}",
        headers=auth,
        json={"items": [
            {"label": "Bonus", "amount": 500, "kind": "earning"},
            {"label": "Insurance", "amount": 300, "kind": "deduction"},
        ]},
    )
    assert adj.status_code == 200
    body = adj.json()
    assert float(body["gross"]) == 10500.0
    assert float(body["deductions"]) == 300.0
    assert float(body["net"]) == 10200.0

    # Duplicate period rejected.
    dup = await client.post("/api/payroll/runs", headers=auth, json={"period": "2026-06"})
    assert dup.status_code == 409

    # Employees cannot see payslips until the run is finalized.
    assert (await client.get("/api/payroll/my", headers=monthly_auth)).json() == []

    fin = await client.post(f"/api/payroll/runs/{run['id']}/finalize", headers=auth)
    assert fin.status_code == 200 and fin.json()["status"] == "finalized"

    # Finalized runs lock edits and deletion.
    locked = await client.patch(
        f"/api/payroll/payslips/{slip['id']}", headers=auth, json={"items": []}
    )
    assert locked.status_code == 409
    assert (await client.delete(f"/api/payroll/runs/{run['id']}", headers=auth)).status_code == 409

    # Now visible to the employee.
    mine = (await client.get("/api/payroll/my", headers=monthly_auth)).json()
    assert len(mine) == 1 and float(mine[0]["net"]) == 10200.0

    # CSV register export.
    csv_resp = await client.get(f"/api/payroll/runs/{run['id']}/register.csv", headers=auth)
    assert csv_resp.status_code == 200
    assert "Net" in csv_resp.text


async def test_payroll_requires_hr(client, auth):
    # A plain member assigned to a non-HR department has no payroll access.
    depts = (await client.get("/api/departments", headers=auth)).json()
    it_id = next(d["id"] for d in depts if d["name"] == "IT")
    member_auth, member_id = await make_member(client, auth, "pay-nobody@agholding.net")
    await client.patch(
        f"/api/users/{member_id}", headers=auth, json={"department_id": it_id}
    )

    assert (await client.get("/api/payroll/runs", headers=member_auth)).status_code == 403
    assert (
        await client.post("/api/payroll/runs", headers=member_auth, json={"period": "2026-07"})
    ).status_code == 403
