import pytest
from helpers import make_member
pytestmark=pytest.mark.asyncio
async def test_company_event_feed_and_permissions(client,auth):
 created=await client.post("/api/calendar/events",headers=auth,json={"title":"Town hall","starts_at":"2026-08-10T09:00:00+04:00","ends_at":"2026-08-10T10:00:00+04:00","location":"HQ"})
 assert created.status_code==201
 member,_=await make_member(client,auth,"calendar-member@agholding.net")
 feed=(await client.get("/api/calendar?start=2026-08-01&end=2026-08-31",headers=member)).json()
 assert any(e["kind"]=="company" and e["title"]=="Town hall" for e in feed)
 denied=await client.post("/api/calendar/events",headers=member,json={"title":"No","starts_at":"2026-08-10T09:00:00+04:00"})
 assert denied.status_code==403
async def test_calendar_rejects_unbounded_range(client,auth):
 assert (await client.get("/api/calendar?start=2025-01-01&end=2026-12-31",headers=auth)).status_code==422
