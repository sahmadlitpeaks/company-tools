import pytest

from helpers import make_member

pytestmark = pytest.mark.asyncio


async def test_cafe_order_status_and_ready_notification(client, auth):
    member, _ = await make_member(client, auth, "cafe-member@agholding.net")
    item = await client.post(
        "/api/cafe/menu",
        headers=auth,
        json={"name": "Flat white", "price": "14.00", "available": True},
    )
    assert item.status_code == 201
    order = await client.post(
        "/api/cafe/orders",
        headers=member,
        json={"menu_item_id": item.json()["id"], "quantity": 2, "notes": "Oat milk"},
    )
    assert order.status_code == 201 and order.json()["status"] == "placed"
    ready = await client.post(
        f"/api/cafe/orders/{order.json()['id']}/status",
        headers=auth,
        json={"status": "ready"},
    )
    assert ready.status_code == 200
    notes = (await client.get("/api/notifications", headers=member)).json()
    assert any(note["category"] == "cafe" and "ready" in note["title"].lower() for note in notes)


async def test_cafe_member_cannot_manage_menu(client, auth):
    member, _ = await make_member(client, auth, "cafe-limited@agholding.net")
    response = await client.post(
        "/api/cafe/menu", headers=member, json={"name": "Hidden"}
    )
    assert response.status_code == 403
