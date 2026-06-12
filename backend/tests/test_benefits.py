import pytest

from helpers import make_member

pytestmark = pytest.mark.asyncio


async def test_benefits_plan_and_enrollment_flow(client, auth):
    emp_auth, emp_id = await make_member(client, auth, "benefits-emp@agholding.net")

    # HR creates a plan.
    plan = (await client.post("/api/benefits/plans", headers=auth, json={
        "name": "Premium Health", "category": "health", "carrier": "Aetna",
        "employee_cost": 120, "employer_cost": 380, "currency": "USD",
    })).json()
    assert plan["enrolled_count"] == 0

    bad = await client.post("/api/benefits/plans", headers=auth, json={
        "name": "Bad", "category": "spaceship",
    })
    assert bad.status_code == 422

    # Enroll the employee; elected cost defaults to the plan's employee cost.
    enr = (await client.post("/api/benefits/enrollments", headers=auth, json={
        "plan_id": plan["id"], "user_id": emp_id, "coverage_level": "family",
    })).json()
    assert enr["status"] == "enrolled"
    assert float(enr["elected_cost"]) == 120.0
    assert enr["plan_name"] == "Premium Health" and enr["employee_name"]

    # Plan now reports one enrolled member.
    plans = (await client.get("/api/benefits/plans", headers=auth)).json()
    assert next(p for p in plans if p["id"] == plan["id"])["enrolled_count"] == 1

    # Employee sees their own enrollment.
    mine = (await client.get("/api/benefits/my/enrollments", headers=emp_auth)).json()
    assert len(mine) == 1 and mine[0]["coverage_level"] == "family"

    # Waive it.
    upd = await client.patch(f"/api/benefits/enrollments/{enr['id']}", headers=auth, json={"status": "waived"})
    assert upd.status_code == 200 and upd.json()["status"] == "waived"

    # Dependents self-service.
    dep = await client.post("/api/benefits/my/dependents", headers=emp_auth, json={
        "name": "Lina", "relationship_type": "child", "date_of_birth": "2018-04-02",
    })
    assert dep.status_code == 201
    deps = (await client.get("/api/benefits/my/dependents", headers=emp_auth)).json()
    assert len(deps) == 1 and deps[0]["name"] == "Lina"
    assert (await client.delete(f"/api/benefits/my/dependents/{dep.json()['id']}", headers=emp_auth)).status_code == 204


async def test_benefits_requires_hr(client, auth):
    depts = (await client.get("/api/departments", headers=auth)).json()
    it_id = next(d["id"] for d in depts if d["name"] == "IT")
    member_auth, member_id = await make_member(client, auth, "benefits-nobody@agholding.net")
    await client.patch(f"/api/users/{member_id}", headers=auth, json={"department_id": it_id})

    assert (await client.get("/api/benefits/plans", headers=member_auth)).status_code == 403
    assert (await client.post("/api/benefits/plans", headers=member_auth, json={"name": "X"})).status_code == 403
    # But self-service is open to everyone.
    assert (await client.get("/api/benefits/my/enrollments", headers=member_auth)).status_code == 200
