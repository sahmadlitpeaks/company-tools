import pytest

from helpers import make_member

pytestmark = pytest.mark.asyncio


async def _types(client, auth):
    return (await client.get("/api/leave/types", headers=auth)).json()


async def test_seeded_types_and_management(client, auth):
    types = await _types(client, auth)
    names = {t["name"] for t in types}
    assert {"Annual", "Sick", "Unpaid"} <= names

    # Admin can add a type; members cannot.
    hdr_m, _ = await make_member(client, auth, "leave-mem@agholding.net")
    assert (await client.post("/api/leave/types", headers=hdr_m, json={"name": "Study"})).status_code == 403
    created = await client.post(
        "/api/leave/types", headers=auth,
        json={"name": "Study", "default_days": 3, "paid": True},
    )
    assert created.status_code == 201
    tid = created.json()["id"]
    # Soft delete keeps it out of the active list.
    assert (await client.delete(f"/api/leave/types/{tid}", headers=auth)).status_code == 204
    assert "Study" not in {t["name"] for t in await _types(client, auth)}


async def test_holiday_calendar_and_counting(client, auth):
    hdr, uid = await make_member(client, auth, "leave-hol@agholding.net")
    sick = next(t for t in await _types(client, auth) if t["name"] == "Sick")

    # 2026-06-15 (Mon) .. 2026-06-19 (Fri) = 5 working days.
    req = await client.post(
        "/api/approvals", headers=hdr,
        json={
            "type": "leave", "title": "Out sick", "leave_type_id": sick["id"],
            "start_date": "2026-06-15", "end_date": "2026-06-19",
        },
    )
    assert req.status_code == 201
    await client.post(f"/api/approvals/{req.json()['id']}/decision", headers=auth, json={"status": "approved"})

    bal = (await client.get("/api/leave/balance", headers=hdr)).json()
    sick_bal = next(b for b in bal["by_type"] if b["name"] == "Sick")
    assert sick_bal["used_days"] == 5

    # A public holiday inside the range drops the count to 4.
    await client.post("/api/leave/holidays", headers=auth, json={"day": "2026-06-17", "name": "Founders Day"})
    bal2 = (await client.get("/api/leave/balance", headers=hdr)).json()
    sick_bal2 = next(b for b in bal2["by_type"] if b["name"] == "Sick")
    assert sick_bal2["used_days"] == 4

    holidays = (await client.get("/api/leave/holidays?year=2026", headers=hdr)).json()
    assert any(h["name"] == "Founders Day" for h in holidays)
    hid = holidays[0]["id"]
    assert (await client.delete(f"/api/leave/holidays/{hid}", headers=hdr)).status_code == 403
    assert (await client.delete(f"/api/leave/holidays/{hid}", headers=auth)).status_code == 204


async def test_pending_and_entitlement_override(client, auth):
    hdr, uid = await make_member(client, auth, "leave-ent@agholding.net")
    annual = next(t for t in await _types(client, auth) if t["name"] == "Annual")

    # Pending leave shows under pending, not used.
    await client.post(
        "/api/approvals", headers=hdr,
        json={"type": "leave", "title": "Holiday", "leave_type_id": annual["id"],
              "start_date": "2026-07-06", "end_date": "2026-07-10"},
    )
    bal = (await client.get("/api/leave/balance", headers=hdr)).json()
    annual_bal = next(b for b in bal["by_type"] if b["name"] == "Annual")
    assert annual_bal["pending_days"] == 5 and annual_bal["used_days"] == 0
    assert annual_bal["entitlement_days"] == 25  # seeded default

    # Admin overrides the annual entitlement for this person.
    r = await client.put(
        f"/api/leave/balances/{uid}", headers=auth,
        json={"entitlement_days": 30, "leave_type_id": annual["id"]},
    )
    assert r.status_code == 200
    annual_after = next(b for b in r.json()["by_type"] if b["name"] == "Annual")
    assert annual_after["entitlement_days"] == 30

    # whos-out carries the leave type label (none approved here, so empty ok).
    out = await client.get("/api/leave/whos-out", headers=hdr)
    assert out.status_code == 200
