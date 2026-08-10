import pytest
from helpers import make_member
pytestmark=pytest.mark.asyncio
async def test_lost_found_claim_and_return_workflow(client,auth):
 reporter,_=await make_member(client,auth,"reporter@agholding.net")
 claimant,_=await make_member(client,auth,"claimant@agholding.net")
 report=(await client.post("/api/lost-found",headers=reporter,json={"kind":"found","description":"Black wallet","location":"Lobby","item_date":"2026-08-01T12:00:00+04:00"})).json()
 claim=await client.post(f"/api/lost-found/{report['id']}/claim",headers=claimant)
 assert claim.status_code==200 and claim.json()["status"]=="claimed"
 assert (await client.post(f"/api/lost-found/{report['id']}/claim",headers=auth)).status_code==409
 assert (await client.post(f"/api/lost-found/{report['id']}/status",headers=claimant,json={"status":"returned"})).status_code==403
 returned=await client.post(f"/api/lost-found/{report['id']}/status",headers=reporter,json={"status":"returned"})
 assert returned.status_code==200 and returned.json()["status"]=="returned"
 notes=(await client.get("/api/notifications",headers=claimant)).json()
 assert any(n["category"]=="lost_found" for n in notes)
async def test_lost_found_validation(client,auth):
 assert (await client.post("/api/lost-found",headers=auth,json={"kind":"other","description":"x","location":"HQ","item_date":"2026-08-01T12:00:00+04:00"})).status_code==422
