import pytest
from helpers import make_member
pytestmark=pytest.mark.asyncio

async def test_purchase_approval_and_idempotent_asset_conversion(client,auth):
 member,_=await make_member(client,auth,"buyer@agholding.net")
 p=(await client.post("/api/purchases",headers=member,json={"item":"Laptop","reason":"New starter","vendor":"Vendor","estimated_cost":"5000","target_type":"asset"})).json()
 assert p["approval_status"]=="pending"
 assert (await client.post(f"/api/purchases/{p['id']}/convert",headers=auth,json={})).status_code==409
 assert (await client.post(f"/api/approvals/{p['approval_id']}/decision",headers=auth,json={"status":"approved"})).status_code==200
 first=await client.post(f"/api/purchases/{p['id']}/convert",headers=auth,json={"final_cost":"4800"})
 assert first.status_code==200 and first.json()["result_type"]=="asset" and first.json()["result_id"]
 assert (await client.post(f"/api/purchases/{p['id']}/convert",headers=auth,json={})).status_code==409

async def test_member_cannot_convert_purchase(client,auth):
 member,_=await make_member(client,auth,"buyer2@agholding.net")
 p=(await client.post("/api/purchases",headers=member,json={"item":"Tool","reason":"Work","target_type":"subscription"})).json()
 assert (await client.post(f"/api/purchases/{p['id']}/convert",headers=member,json={})).status_code==403
