import pytest
from helpers import make_member
pytestmark=pytest.mark.asyncio

async def test_booking_conflict_and_cancellation(client,auth):
    member,_=await make_member(client,auth,"booker@agholding.net")
    space=(await client.post("/api/bookings/spaces",headers=auth,json={"name":"Boardroom","location":"HQ","capacity":8,"equipment":["Screen"],"type":"room","active":True})).json()
    body={"space_id":space["id"],"purpose":"Planning","starts_at":"2026-08-01T09:00:00+04:00","ends_at":"2026-08-01T10:00:00+04:00"}
    first=await client.post("/api/bookings",headers=member,json=body)
    assert first.status_code==201
    overlap=await client.post("/api/bookings",headers=auth,json={**body,"purpose":"Conflict","starts_at":"2026-08-01T09:30:00+04:00"})
    assert overlap.status_code==409
    assert (await client.post(f"/api/bookings/{first.json()['id']}/cancel",headers=member)).status_code==200
    assert (await client.post("/api/bookings",headers=auth,json=body)).status_code==201

async def test_member_cannot_create_space(client,auth):
    member,_=await make_member(client,auth,"booker2@agholding.net")
    r=await client.post("/api/bookings/spaces",headers=member,json={"name":"D1","location":"HQ","type":"desk"})
    assert r.status_code==403
