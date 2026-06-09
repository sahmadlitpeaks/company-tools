import pytest

pytestmark = pytest.mark.asyncio


async def _create(client, auth, tag="LAP-001", **extra):
    body = {"asset_tag": tag, "name": "MacBook Pro", **extra}
    r = await client.post("/api/asset-tracker", headers=auth, json=body)
    assert r.status_code == 201, r.text
    return r.json()


async def test_create_exposes_new_fields(client, auth):
    a = await _create(
        client,
        auth,
        category="Laptop",
        location="HQ",
        condition="good",
        maintenance_interval_days=90,
    )
    assert a["condition"] == "good"
    assert a["attachment_count"] == 0
    # Category/location auto-registered into managed lists.
    cats = (await client.get("/api/asset-tracker/categories", headers=auth)).json()
    locs = (await client.get("/api/asset-tracker/locations", headers=auth)).json()
    assert any(c["name"] == "Laptop" for c in cats)
    assert any(c["name"] == "HQ" for c in locs)


async def test_filters(client, auth):
    await _create(client, auth, tag="A1", category="Laptop", condition="good")
    await _create(client, auth, tag="A2", category="Monitor", condition="poor")
    laptops = (
        await client.get("/api/asset-tracker?category=Laptop", headers=auth)
    ).json()
    assert {a["asset_tag"] for a in laptops} == {"A1"}
    poor = (await client.get("/api/asset-tracker?condition=poor", headers=auth)).json()
    assert {a["asset_tag"] for a in poor} == {"A2"}


async def test_assignment_history(client, auth):
    a = await _create(client, auth)
    me = (await client.get("/api/auth/me", headers=auth)).json()
    await client.post(
        f"/api/asset-tracker/{a['id']}/checkout",
        headers=auth,
        json={"user_id": me["id"], "note": "for travel"},
    )
    await client.post(
        f"/api/asset-tracker/{a['id']}/checkin", headers=auth, json={"note": "back"}
    )
    spans = (
        await client.get(f"/api/asset-tracker/{a['id']}/assignments", headers=auth)
    ).json()
    assert len(spans) == 1
    assert spans[0]["user_id"] == me["id"]
    assert spans[0]["checked_out_at"] and spans[0]["checked_in_at"]


async def test_condition_and_retire(client, auth):
    a = await _create(client, auth)
    r = await client.post(
        f"/api/asset-tracker/{a['id']}/condition",
        headers=auth,
        json={"condition": "damaged", "note": "cracked screen"},
    )
    assert r.json()["condition"] == "damaged"

    r = await client.post(
        f"/api/asset-tracker/{a['id']}/retire",
        headers=auth,
        json={"salvage_value": "120.00", "disposal_notes": "sold"},
    )
    body = r.json()
    assert body["status"] == "retired" and body["disposal_date"]
    events = (
        await client.get(f"/api/asset-tracker/{a['id']}/events", headers=auth)
    ).json()
    assert any(e["event_type"] == "retired" for e in events)


async def test_maintenance_scheduling(client, auth):
    a = await _create(client, auth)
    r = await client.post(
        f"/api/asset-tracker/{a['id']}/maintenance",
        headers=auth,
        json={"note": "cleaned fans", "schedule_next_days": 30},
    )
    assert r.json()["next_maintenance_date"] is not None


async def test_attachments(client, auth):
    a = await _create(client, auth)
    up = await client.post(
        f"/api/asset-tracker/{a['id']}/attachments",
        headers=auth,
        files={"file": ("receipt.pdf", b"%PDF-1.4 receipt", "application/pdf")},
        data={"kind": "receipt"},
    )
    assert up.status_code == 201 and up.json()["kind"] == "receipt"
    att_id = up.json()["id"]

    lst = (
        await client.get(f"/api/asset-tracker/{a['id']}/attachments", headers=auth)
    ).json()
    assert len(lst) == 1
    # attachment_count reflected on the asset
    asset = (await client.get(f"/api/asset-tracker/{a['id']}", headers=auth)).json()
    assert asset["attachment_count"] == 1

    dl = await client.get(
        f"/api/asset-tracker/attachments/{att_id}/download", headers=auth
    )
    assert dl.status_code == 200 and dl.content == b"%PDF-1.4 receipt"


async def test_bulk_and_warranty_alerts(client, auth):
    a1 = await _create(client, auth, tag="B1")
    a2 = await _create(client, auth, tag="B2")
    res = await client.post(
        "/api/asset-tracker/bulk",
        headers=auth,
        json={"ids": [a1["id"], a2["id"]], "action": "set_location", "value": "Lab"},
    )
    assert res.json()["affected"] == 2
    lab = (await client.get("/api/asset-tracker?location=Lab", headers=auth)).json()
    assert {a["asset_tag"] for a in lab} == {"B1", "B2"}

    # Warranty within window -> alert for admins (runs warranty + maintenance).
    from datetime import date, timedelta

    soon = (date.today() + timedelta(days=10)).isoformat()
    await client.patch(
        f"/api/asset-tracker/{a1['id']}", headers=auth, json={"warranty_expiry": soon}
    )
    res = await client.post("/api/notifications/check-warranties", headers=auth)
    assert res.json()["created"] >= 1
    notes = (await client.get("/api/notifications", headers=auth)).json()
    assert any(n["category"] == "warranty" for n in notes)


async def test_asset_csv_migration_with_assignee(client, auth):
    from helpers import make_member

    _, uid = await make_member(client, auth, "assetimp@agholding.net")
    csv = (
        "asset_tag,name,status,assigned_to_email,purchase_cost,category\n"
        "MIG-1,Laptop,available,assetimp@agholding.net,1000,Laptop\n"
        "MIG-2,Monitor,available,,200,Display\n"
        ",NoTag,,,,\n"
    )
    res = await client.post(
        "/api/asset-tracker/import",
        headers=auth,
        files={"file": ("assets.csv", csv, "text/csv")},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["created"] == 2
    assert any("required" in e for e in body["errors"])

    assets = (await client.get("/api/asset-tracker", headers=auth)).json()
    a = next(x for x in assets if x["asset_tag"] == "MIG-1")
    # An assignee in the CSV flips an "available" row to "assigned".
    assert a["assigned_to_id"] == uid and a["status"] == "assigned"

    # The category was auto-registered so rollups stay clean.
    cats = [c["name"] for c in (await client.get("/api/asset-tracker/categories", headers=auth)).json()]
    assert "Laptop" in cats

    # Export includes the new columns; a template is downloadable.
    exp = await client.get("/api/asset-tracker/export.csv", headers=auth)
    assert exp.status_code == 200 and "assigned_to_email" in exp.text and "MIG-1" in exp.text
    tpl = await client.get("/api/asset-tracker/template.csv", headers=auth)
    assert tpl.status_code == 200 and "assigned_to_email" in tpl.text
