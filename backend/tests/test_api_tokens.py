import pytest

from helpers import make_member

pytestmark = pytest.mark.asyncio


async def test_api_token_crud_and_scoped_access(client, auth):
    # Unknown scope rejected.
    bad = await client.post("/api/api-tokens", headers=auth, json={"name": "x", "scopes": ["read:everything"]})
    assert bad.status_code == 422

    created = await client.post("/api/api-tokens", headers=auth, json={
        "name": "Partner integration", "scopes": ["read:directory"],
    })
    assert created.status_code == 201
    body = created.json()
    raw = body["token"]
    assert raw.startswith("ct_") and body["prefix"].startswith("ct_")

    # Listing never exposes the raw token.
    lst = (await client.get("/api/api-tokens", headers=auth)).json()
    assert lst and "token" not in lst[0]

    h = {"Authorization": f"Bearer {raw}"}
    # In-scope read works without a user session.
    emps = await client.get("/api/public-api/employees", headers=h)
    assert emps.status_code == 200 and isinstance(emps.json(), list)

    # Out-of-scope endpoint is forbidden for this token.
    assert (await client.get("/api/public-api/leads", headers=h)).status_code == 403

    # Missing/invalid token rejected.
    assert (await client.get("/api/public-api/employees")).status_code == 401
    assert (await client.get("/api/public-api/employees", headers={"Authorization": "Bearer ct_nope"})).status_code == 401

    # Revoke → token stops working.
    assert (await client.delete(f"/api/api-tokens/{body['id']}", headers=auth)).status_code == 204
    assert (await client.get("/api/public-api/employees", headers=h)).status_code == 401


async def test_api_tokens_admin_only(client, auth):
    member_hdr, _ = await make_member(client, auth, "token-member@agholding.net")
    assert (await client.get("/api/api-tokens", headers=member_hdr)).status_code == 403
    assert (await client.post("/api/api-tokens", headers=member_hdr, json={"name": "x"})).status_code == 403
