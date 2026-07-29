import pytest
from helpers import make_member
pytestmark=pytest.mark.asyncio

async def test_public_visitor_token_and_arrival_notification(client,auth):
    host,uid=await make_member(client,auth,"host@agholding.net")
    v=(await client.post("/api/visitors",headers=host,json={"visitor_name":"Guest One","office_location":"HQ","visit_at":"2026-08-01T10:00:00+04:00"})).json()
    assert len(v["token"])>=32 and v["invitation_url"].endswith(v["token"])
    public=await client.get(f"/api/public/visitors/{v['token']}")
    assert public.status_code==200 and "visitor_email" not in public.json() and "token" not in public.json()
    assert (await client.get("/api/public/visitors/not-a-token")).status_code==404
    arrived=await client.post(f"/api/visitors/{v['id']}/status",headers=auth,json={"status":"arrived"})
    assert arrived.status_code==200
    notes=(await client.get("/api/notifications",headers=host)).json()
    assert any(n["category"]=="visitor" for n in notes)

async def test_member_cannot_change_visitor_queue(client,auth):
    host,_=await make_member(client,auth,"host2@agholding.net")
    v=(await client.post("/api/visitors",headers=host,json={"visitor_name":"Guest","office_location":"HQ","visit_at":"2026-08-01T10:00:00+04:00"})).json()
    assert (await client.post(f"/api/visitors/{v['id']}/status",headers=host,json={"status":"arrived"})).status_code==403
