import pytest

from helpers import make_member

pytestmark = pytest.mark.asyncio


async def _dept_id(client, auth, name="IT"):
    depts = (await client.get("/api/departments", headers=auth)).json()
    return next(d["id"] for d in depts if d["name"] == name)


async def test_job_and_pipeline_flow(client, auth):
    it = await _dept_id(client, auth)
    job = (await client.post("/api/recruiting/jobs", headers=auth, json={
        "title": "Backend Engineer", "department_id": it, "location": "Dubai",
        "employment_type": "full_time", "openings": 1,
    })).json()
    assert job["status"] == "open" and job["department_name"] == "IT"

    cand = (await client.post(f"/api/recruiting/jobs/{job['id']}/candidates", headers=auth, json={
        "name": "Nadia Karim", "email": "nadia@example.com", "source": "linkedin",
    })).json()
    assert cand["stage"] == "applied"

    # Move through the pipeline; stage changes are logged on the timeline.
    await client.patch(f"/api/recruiting/candidates/{cand['id']}", headers=auth, json={"stage": "screen"})
    await client.patch(f"/api/recruiting/candidates/{cand['id']}", headers=auth, json={"stage": "interview"})
    bad = await client.patch(f"/api/recruiting/candidates/{cand['id']}", headers=auth, json={"stage": "limbo"})
    assert bad.status_code == 422

    pipe = (await client.get(f"/api/recruiting/jobs/{job['id']}/pipeline", headers=auth)).json()
    assert len(pipe["interview"]) == 1 and pipe["applied"] == []

    detail = (await client.get(f"/api/recruiting/candidates/{cand['id']}", headers=auth)).json()
    stage_notes = [a["body"] for a in detail["activities"] if a["kind"] == "stage"]
    assert "Moved screen → interview" in stage_notes

    # Notes.
    note = await client.post(f"/api/recruiting/candidates/{cand['id']}/notes", headers=auth, json={"body": "Great phone screen"})
    assert note.status_code == 201 and note.json()["author_name"]


async def test_interview_scorecard_offer_and_hire(client, auth):
    it = await _dept_id(client, auth)
    _, interviewer = await make_member(client, auth, "ats-interviewer@agholding.net", role="manager")
    job = (await client.post("/api/recruiting/jobs", headers=auth, json={
        "title": "Designer", "department_id": it, "employment_type": "full_time",
    })).json()
    cand = (await client.post(f"/api/recruiting/jobs/{job['id']}/candidates", headers=auth, json={
        "name": "Omar Halabi", "email": "omar@example.com",
    })).json()

    # Interview + scorecard.
    iv = (await client.post(f"/api/recruiting/candidates/{cand['id']}/interviews", headers=auth, json={
        "scheduled_at": "2026-07-01T10:00:00Z", "interviewer_id": interviewer, "mode": "video",
    })).json()
    score = await client.patch(f"/api/recruiting/interviews/{iv['id']}", headers=auth, json={
        "rating": 5, "recommendation": "yes", "feedback": "Strong portfolio",
    })
    assert score.status_code == 200 and score.json()["recommendation"] == "yes"
    assert (await client.patch(f"/api/recruiting/interviews/{iv['id']}", headers=auth, json={"rating": 9})).status_code == 422

    # Offer moves the candidate to the offer stage; accept it.
    offer = (await client.post(f"/api/recruiting/candidates/{cand['id']}/offers", headers=auth, json={
        "amount": "15000", "currency": "AED", "pay_period": "monthly", "start_date": "2026-08-01",
    })).json()
    upd = await client.patch(f"/api/recruiting/offers/{offer['id']}", headers=auth, json={"status": "accepted"})
    assert upd.status_code == 200

    # Hire -> creates the employee + onboarding journey; job becomes filled.
    hired = await client.post(f"/api/recruiting/candidates/{cand['id']}/hire", headers=auth, json={
        "email": "omar.halabi@agholding.net", "start_onboarding": True,
    })
    assert hired.status_code == 200
    body = hired.json()
    assert body["status"] == "hired" and body["user_id"]

    users = (await client.get("/api/users?q=omar.halabi@agholding.net", headers=auth)).json()
    emp = next(u for u in users if u["email"] == "omar.halabi@agholding.net")
    assert emp["job_title"] == "Designer" and emp["hire_date"] == "2026-08-01"
    assert emp["department_id"] == it

    journeys = (await client.get("/api/people/journeys?kind=onboarding", headers=auth)).json()
    assert any(j["target_user_id"] == emp["id"] for j in journeys)

    jb = (await client.get(f"/api/recruiting/jobs/{job['id']}", headers=auth)).json()
    assert jb["status"] == "filled" and jb["hired_count"] == 1

    # Double hire blocked.
    assert (await client.post(f"/api/recruiting/candidates/{cand['id']}/hire", headers=auth, json={})).status_code == 409


async def test_recruiting_requires_module(client, auth):
    hdr, _ = await make_member(client, auth, "ats-member@agholding.net")
    assert (await client.get("/api/recruiting/jobs", headers=hdr)).status_code == 403
