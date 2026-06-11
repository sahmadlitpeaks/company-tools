import pytest

from helpers import make_member

pytestmark = pytest.mark.asyncio


async def test_pay_bands(client, auth):
    hdr_m, _ = await make_member(client, auth, "comp-mem@agholding.net")
    assert (await client.get("/api/compensation/bands", headers=hdr_m)).status_code == 403

    band = await client.post(
        "/api/compensation/bands", headers=auth,
        json={"name": "Engineer L3", "min_amount": "80000", "max_amount": "110000"},
    )
    assert band.status_code == 201
    bid = band.json()["id"]
    bands = (await client.get("/api/compensation/bands", headers=auth)).json()
    assert any(b["id"] == bid for b in bands)
    assert (await client.delete(f"/api/compensation/bands/{bid}", headers=hdr_m)).status_code == 403
    assert (await client.delete(f"/api/compensation/bands/{bid}", headers=auth)).status_code == 204


async def test_compensation_records_and_visibility(client, auth):
    hdr, uid = await make_member(client, auth, "comp-emp@agholding.net")

    # HR records a monthly salary; annualised = *12. An employment event is logged.
    r = await client.post(
        f"/api/compensation/by-user/{uid}", headers=auth,
        json={"record_type": "salary", "amount": "5000", "pay_period": "monthly",
              "effective_date": "2025-01-01"},
    )
    assert r.status_code == 201, r.text

    cur = (await client.get(f"/api/compensation/current/{uid}", headers=auth)).json()
    assert float(cur["amount"]) == 5000.0 and float(cur["annualised"]) == 60000.0

    # A later raise becomes the current salary.
    await client.post(
        f"/api/compensation/by-user/{uid}", headers=auth,
        json={"record_type": "salary", "amount": "5500", "pay_period": "monthly",
              "effective_date": "2026-01-01"},
    )
    cur2 = (await client.get(f"/api/compensation/current/{uid}", headers=auth)).json()
    assert float(cur2["amount"]) == 5500.0

    # Employee sees their own history; a colleague cannot.
    mine = (await client.get(f"/api/compensation/by-user/{uid}", headers=hdr)).json()
    assert len(mine) == 2
    hdr_other, _ = await make_member(client, auth, "comp-other@agholding.net")
    assert (await client.get(f"/api/compensation/by-user/{uid}", headers=hdr_other)).status_code == 403
    # Employee cannot add their own compensation.
    assert (
        await client.post(
            f"/api/compensation/by-user/{uid}", headers=hdr,
            json={"record_type": "salary", "amount": "9999"},
        )
    ).status_code == 403

    # Compensation events show on the employment timeline.
    events = (await client.get(f"/api/people/{uid}/events", headers=auth)).json()
    assert any(e["event_type"] == "compensation" for e in events)

    bad = await client.post(
        f"/api/compensation/by-user/{uid}", headers=auth,
        json={"record_type": "lottery", "amount": "1"},
    )
    assert bad.status_code == 422


async def test_total_rewards_statement(client, auth):
    from helpers import make_member
    emp_hdr, emp = await make_member(client, auth, "rewards-emp@agholding.net")

    # Base salary 10000/mo = 120000/yr.
    await client.post(f"/api/compensation/by-user/{emp}", headers=auth, json={
        "record_type": "salary", "amount": 10000, "currency": "USD",
        "pay_period": "monthly", "effective_date": "2026-01-01",
    })
    # A bonus this year.
    await client.post(f"/api/compensation/by-user/{emp}", headers=auth, json={
        "record_type": "bonus", "amount": 5000, "currency": "USD",
        "pay_period": "annual", "effective_date": "2026-03-01",
    })
    # An employer-paid benefit (380/mo employer share).
    plan = (await client.post("/api/benefits/plans", headers=auth, json={
        "name": "Health", "category": "health", "employee_cost": 100, "employer_cost": 380,
    })).json()
    await client.post("/api/benefits/enrollments", headers=auth, json={
        "plan_id": plan["id"], "user_id": emp,
    })

    tr = (await client.get(f"/api/compensation/total-rewards/{emp}", headers=auth)).json()
    assert float(tr["base_annual"]) == 120000.0
    assert float(tr["bonuses_annual"]) == 5000.0
    assert float(tr["benefits_annual"]) == 4560.0  # 380 * 12
    assert float(tr["total_annual"]) == 129560.0
    assert len(tr["components"]) == 3

    # The employee can see their own; a stranger cannot.
    assert (await client.get(f"/api/compensation/total-rewards/{emp}", headers=emp_hdr)).status_code == 200
    other_hdr, _ = await make_member(client, auth, "rewards-other@agholding.net")
    assert (await client.get(f"/api/compensation/total-rewards/{emp}", headers=other_hdr)).status_code == 403
