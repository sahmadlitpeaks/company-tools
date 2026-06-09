import pytest

from helpers import make_member

pytestmark = pytest.mark.asyncio


async def test_phone_line_lifecycle(client, auth):
    hdr, uid = await make_member(client, auth, "phoneuser@agholding.net")

    # Create a line with package + billing details.
    r = await client.post(
        "/api/phone-lines",
        headers=auth,
        json={
            "number": "+971500000001",
            "carrier": "Etisalat",
            "plan_name": "Business 20GB",
            "monthly_cost": "120.00",
            "data_allowance": "20 GB",
        },
    )
    assert r.status_code == 201
    line = r.json()
    lid = line["id"]
    assert line["status"] == "available" and line["plan_name"] == "Business 20GB"

    # Duplicate number is rejected.
    dup = await client.post("/api/phone-lines", headers=auth, json={"number": "+971500000001"})
    assert dup.status_code == 409

    # Assign to the employee -> status flips, they get notified, history records it.
    a = await client.post(
        f"/api/phone-lines/{lid}/assign", headers=auth, json={"user_id": uid, "note": "Joining"}
    )
    assert a.status_code == 200
    assert a.json()["status"] == "assigned" and a.json()["assigned_to_name"]
    notes = (await client.get("/api/notifications", headers=hdr)).json()
    assert any(n["category"] == "asset" for n in notes)

    # Change the package -> recorded as a plan_changed event.
    await client.patch(
        f"/api/phone-lines/{lid}",
        headers=auth,
        json={"plan_name": "Business 50GB", "monthly_cost": "160.00"},
    )

    # Log a bill, then read the detail (history + bills).
    b = await client.post(
        f"/api/phone-lines/{lid}/bills",
        headers=auth,
        json={"period": "2026-05", "amount": "175.50", "data_used": "23 GB", "status": "paid"},
    )
    assert b.status_code == 201
    detail = (await client.get(f"/api/phone-lines/{lid}", headers=auth)).json()
    assert detail["bill_count"] == 1 and detail["bills"][0]["period"] == "2026-05"
    kinds = {e["event_type"] for e in detail["events"]}
    assert {"assigned", "plan_changed"} <= kinds

    # Suspend, then unassign.
    s = await client.post(
        f"/api/phone-lines/{lid}/status", headers=auth, json={"status": "suspended"}
    )
    assert s.json()["status"] == "suspended"
    u = await client.post(f"/api/phone-lines/{lid}/unassign", headers=auth, json={})
    assert u.json()["assigned_to_id"] is None

    # Summary reflects spend across non-cancelled lines.
    summ = (await client.get("/api/phone-lines/summary", headers=auth)).json()
    assert summ["total"] >= 1 and summ["monthly_cost"]


async def test_phone_lines_module_gated(client, auth):
    hdr, uid = await make_member(client, auth, "nophone@agholding.net")
    await client.patch(
        f"/api/users/{uid}", headers=auth, json={"permissions": ["dashboard"]}
    )
    assert (await client.get("/api/phone-lines", headers=hdr)).status_code == 403


async def test_phone_csv_migration(client, auth):
    _, uid = await make_member(client, auth, "phoneimp@agholding.net")
    csv = (
        "number,carrier,plan_name,monthly_cost,status,assigned_to_email,notes\n"
        "+971500001111,Etisalat,Biz,30.00,assigned,phoneimp@agholding.net,Ported\n"
        "+971500002222,Du,Basic,10,available,,\n"
        ",NoNumber,,,,,\n"
    )
    res = await client.post(
        "/api/phone-lines/import",
        headers=auth,
        files={"file": ("lines.csv", csv, "text/csv")},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["created"] == 2
    assert any("number is required" in e for e in body["errors"])

    lines = (await client.get("/api/phone-lines", headers=auth)).json()
    imported = next(ln for ln in lines if ln["number"] == "+971500001111")
    assert imported["status"] == "assigned" and imported["assigned_to_id"] == uid

    # Re-importing the same number updates instead of duplicating.
    csv2 = "number,carrier,monthly_cost\n+971500001111,NewCarrier,99\n"
    res2 = (await client.post(
        "/api/phone-lines/import",
        headers=auth,
        files={"file": ("l2.csv", csv2, "text/csv")},
    )).json()
    assert res2["updated"] == 1 and res2["created"] == 0
    lines2 = (await client.get("/api/phone-lines", headers=auth)).json()
    assert next(ln for ln in lines2 if ln["number"] == "+971500001111")["carrier"] == "NewCarrier"

    # Export round-trips and a template is downloadable.
    exp = await client.get("/api/phone-lines/export.csv", headers=auth)
    assert exp.status_code == 200 and "+971500001111" in exp.text
    tpl = await client.get("/api/phone-lines/template.csv", headers=auth)
    assert tpl.status_code == 200 and "assigned_to_email" in tpl.text


async def test_phone_import_unknown_assignee_is_skipped(client, auth):
    csv = (
        "number,assigned_to_email\n"
        "+971500009999,ghost@nowhere.test\n"
    )
    body = (await client.post(
        "/api/phone-lines/import",
        headers=auth,
        files={"file": ("g.csv", csv, "text/csv")},
    )).json()
    assert body["created"] == 1
    assert any("unknown assignee" in e for e in body["errors"])
    lines = (await client.get("/api/phone-lines", headers=auth)).json()
    line = next(ln for ln in lines if ln["number"] == "+971500009999")
    assert line["assigned_to_id"] is None and line["status"] == "available"
