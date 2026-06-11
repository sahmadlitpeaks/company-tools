import pytest

from helpers import make_member

pytestmark = pytest.mark.asyncio


async def test_course_assign_and_complete(client, auth):
    emp_hdr, emp = await make_member(client, auth, "train-emp@agholding.net")

    # HR creates a course; a plain member can't.
    assert (await client.post("/api/training/courses", headers=emp_hdr, json={"title": "X"})).status_code == 403
    course = (await client.post("/api/training/courses", headers=auth, json={
        "title": "Security Awareness", "category": "compliance", "url": "https://lms/sec",
    })).json()

    # Assign to the employee.
    assigned = await client.post(f"/api/training/courses/{course['id']}/assign", headers=auth, json={
        "user_ids": [emp], "due_date": "2026-12-31",
    })
    assert assigned.status_code == 200 and len(assigned.json()) == 1

    # Employee sees and completes it.
    mine = (await client.get("/api/training/my/assignments", headers=emp_hdr)).json()
    assert len(mine) == 1 and mine[0]["status"] == "assigned"
    aid = mine[0]["id"]
    done = await client.patch(f"/api/training/assignments/{aid}?status=completed", headers=emp_hdr)
    assert done.status_code == 200 and done.json()["status"] == "completed" and done.json()["completed_at"]

    # HR sees the roster.
    roster = (await client.get(f"/api/training/courses/{course['id']}/assignments", headers=auth)).json()
    assert roster[0]["status"] == "completed"


async def test_certifications_and_expiry(client, auth):
    emp_hdr, emp = await make_member(client, auth, "train-cert@agholding.net")
    # Already-expired cert.
    await client.post("/api/training/my/certifications", headers=emp_hdr, json={
        "name": "First Aid", "issuer": "Red Cross", "issued_date": "2022-01-01", "expiry_date": "2024-01-01",
    })
    # Future cert.
    await client.post("/api/training/my/certifications", headers=emp_hdr, json={
        "name": "PMP", "expiry_date": "2030-01-01",
    })

    mine = (await client.get("/api/training/my/certifications", headers=emp_hdr)).json()
    fa = next(c for c in mine if c["name"] == "First Aid")
    assert fa["expired"] is True and fa["days_to_expiry"] < 0

    # HR expiring report (large window) includes the expired one.
    expiring = (await client.get("/api/training/certifications/expiring?days=3650", headers=auth)).json()
    assert any(c["name"] == "First Aid" for c in expiring)
    # A plain member can't run the company report.
    assert (await client.get("/api/training/certifications/expiring", headers=emp_hdr)).status_code == 403
