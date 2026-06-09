import pytest

from helpers import make_member

pytestmark = pytest.mark.asyncio


async def test_manager_line_and_org_chart(client, auth):
    _, mgr = await make_member(client, auth, "hr-mgr@agholding.net", role="manager")
    _, rep = await make_member(client, auth, "hr-rep@agholding.net")

    # Assign reporting line + employment fields via the users API.
    r = await client.patch(f"/api/users/{rep}", headers=auth, json={
        "manager_id": mgr, "employment_type": "full_time", "hire_date": "2024-03-01",
    })
    assert r.status_code == 200
    assert r.json()["manager_id"] == mgr and r.json()["manager_name"]

    # Self-management is rejected.
    bad = await client.patch(f"/api/users/{rep}", headers=auth, json={"manager_id": rep})
    assert bad.status_code == 422

    # Org chart nests the report under the manager.
    chart = (await client.get("/api/people/org-chart", headers=auth)).json()

    def find(nodes, uid):
        for n in nodes:
            if n["id"] == uid:
                return n
            hit = find(n["reports"], uid)
            if hit:
                return hit
        return None

    mnode = find(chart, mgr)
    assert mnode and mnode["report_count"] >= 1
    assert any(c["id"] == rep for c in mnode["reports"])


async def test_employment_events(client, auth):
    _, uid = await make_member(client, auth, "hr-events@agholding.net")
    bad = await client.post(f"/api/people/{uid}/events", headers=auth, json={
        "event_type": "explosion", "title": "x",
    })
    assert bad.status_code == 422

    ev = await client.post(f"/api/people/{uid}/events", headers=auth, json={
        "event_type": "promotion", "title": "Promoted to Senior", "effective_date": "2025-01-01",
    })
    assert ev.status_code == 201 and ev.json()["created_by_name"]
    eid = ev.json()["id"]

    listed = (await client.get(f"/api/people/{uid}/events", headers=auth)).json()
    assert len(listed) == 1 and listed[0]["title"] == "Promoted to Senior"

    assert (await client.delete(f"/api/people/events/{eid}", headers=auth)).status_code == 204
    assert (await client.get(f"/api/people/{uid}/events", headers=auth)).json() == []


async def test_profile_surfaces_hr_record(client, auth):
    _, mgr = await make_member(client, auth, "prof-mgr@agholding.net", role="manager")
    hdr, uid = await make_member(client, auth, "prof-emp@agholding.net")
    await client.patch(f"/api/users/{uid}", headers=auth, json={
        "manager_id": mgr, "employment_type": "contractor", "hire_date": "2023-06-15",
    })
    await client.patch(f"/api/profiles/{uid}", headers=auth, json={
        "emergency_contact_name": "Pat Doe", "emergency_contact_phone": "+15550000",
        "date_of_birth": "1990-04-04",
    })
    await client.post(f"/api/people/{uid}/events", headers=auth, json={
        "event_type": "hired", "title": "Joined the company",
    })

    # Owner sees employment + sensitive HR record + events.
    me = (await client.get("/api/profiles/me", headers=hdr)).json()
    assert me["manager_name"] and me["employment_type"] == "contractor"
    assert me["emergency_contact_name"] == "Pat Doe" and me["date_of_birth"] == "1990-04-04"
    assert any(e["title"] == "Joined the company" for e in me["events"])

    # Manager has a direct report listed on their own profile.
    mgr_view = (await client.get(f"/api/profiles/{mgr}", headers=auth)).json()
    assert any(r["id"] == uid for r in mgr_view["direct_reports"])
