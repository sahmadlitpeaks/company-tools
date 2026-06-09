import pytest

from helpers import make_member

pytestmark = pytest.mark.asyncio


async def _dept_id(client, auth, name="IT"):
    depts = (await client.get("/api/departments", headers=auth)).json()
    return next(d["id"] for d in depts if d["name"] == name)


async def test_subscription_cost_and_seats(client, auth):
    _, u1 = await make_member(client, auth, "sub1@agholding.net")
    _, u2 = await make_member(client, auth, "sub2@agholding.net")

    # Per-seat, monthly: total = cost * active seats.
    r = await client.post(
        "/api/subscriptions",
        headers=auth,
        json={
            "name": "ChatGPT Team",
            "vendor": "OpenAI",
            "scope": "person",
            "cost_type": "per_seat",
            "cost": "25.00",
            "billing_cycle": "monthly",
            "user_ids": [u1, u2],
        },
    )
    assert r.status_code == 201, r.text
    sub = r.json()
    assert sub["active_seats"] == 2
    assert float(sub["monthly_cost"]) == 50.0
    sid = sub["id"]

    # Flat annual normalises to a monthly figure.
    flat = (await client.post(
        "/api/subscriptions",
        headers=auth,
        json={"name": "Adobe CC", "cost_type": "flat", "cost": "1200.00", "billing_cycle": "annual"},
    )).json()
    assert float(flat["monthly_cost"]) == 100.0

    # Summary aggregates monthly spend.
    summ = (await client.get("/api/subscriptions/summary", headers=auth)).json()
    assert summ["total"] == 2
    assert float(summ["monthly_spend"]) == 150.0

    # Revoking a seat lowers the active count and the per-seat total.
    seat = next(s for s in sub["seats"] if s["user_id"] == u1)
    rev = await client.post(f"/api/subscriptions/seats/{seat['id']}/revoke", headers=auth)
    assert rev.status_code == 200 and rev.json()["status"] == "revoked"
    after = (await client.get(f"/api/subscriptions/{sid}", headers=auth)).json()
    assert after["active_seats"] == 1 and float(after["monthly_cost"]) == 25.0


async def test_subscription_validation(client, auth):
    bad = await client.post(
        "/api/subscriptions", headers=auth, json={"name": "X", "scope": "planet"}
    )
    assert bad.status_code == 422
    bad2 = await client.post(
        "/api/subscriptions", headers=auth, json={"name": "X", "billing_cycle": "fortnightly"}
    )
    assert bad2.status_code == 422


async def test_subscriptions_surface_in_offboarding(client, auth):
    _, uid = await make_member(client, auth, "leaver-sub@agholding.net")
    it = await _dept_id(client, auth, "IT")
    await client.patch(f"/api/users/{uid}", headers=auth, json={"department_id": it})

    # A personal seat + a department-wide subscription covering their dept.
    personal = (await client.post(
        "/api/subscriptions",
        headers=auth,
        json={"name": "Figma", "scope": "person", "cost_type": "flat", "cost": "15", "user_ids": [uid]},
    )).json()
    await client.post(
        "/api/subscriptions",
        headers=auth,
        json={"name": "Slack", "scope": "department", "department_id": it, "cost_type": "flat", "cost": "100"},
    )

    j = (await client.post(
        "/api/people/journeys", headers=auth, json={"kind": "offboarding", "target_user_id": uid},
    )).json()
    detail = (await client.get(f"/api/people/journeys/{j['id']}", headers=auth)).json()
    subs = {s["name"]: s for s in detail["subscriptions"]}
    assert subs["Figma"]["source"] == "seat" and subs["Figma"]["seat_id"]
    assert subs["Slack"]["source"] == "department" and subs["Slack"]["seat_id"] is None

    # The personal seat can be revoked straight from the offboarding data.
    seat_id = subs["Figma"]["seat_id"]
    assert (await client.post(f"/api/subscriptions/seats/{seat_id}/revoke", headers=auth)).status_code == 200
    # (sanity: the personal subscription still lists the now-revoked seat)
    again = (await client.get(f"/api/subscriptions/{personal['id']}", headers=auth)).json()
    assert again["active_seats"] == 0
