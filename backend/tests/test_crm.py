import csv
import io
import json
import uuid
from datetime import datetime, timedelta, timezone

import openpyxl
import pytest

from app.core.database import AsyncSessionLocal
from app.models.crm import CrmLead
from helpers import make_member

pytestmark = pytest.mark.asyncio


async def _crm_member(client, auth, email="sam@agholding.net"):
    hdr, uid = await make_member(client, auth, email)
    await client.patch(f"/api/users/{uid}", headers=auth, json={"permissions": ["dashboard", "crm"]})
    return hdr, uid


async def _me(client, auth):
    return (await client.get("/api/auth/me", headers=auth)).json()["id"]


async def _lead(client, auth, **body):
    response = await client.post("/api/crm/leads", headers=auth, json={"name": "Lead", **body})
    assert response.status_code == 201, response.text
    return response.json()


async def _timeline(client, auth, lead_id):
    return (await client.get(f"/api/crm/leads/{lead_id}/activities", headers=auth)).json()


def _csv(rows):
    buffer = io.StringIO()
    csv.writer(buffer).writerows(rows)
    return buffer.getvalue().encode()


async def test_pipeline_stages_and_lost_reason(client, auth):
    lead = await _lead(client, auth, status="proposal")
    assert lead["status"] == "proposal"
    assert (await client.post("/api/crm/leads", headers=auth, json={"status": "archived"})).status_code == 422
    assert (await client.post("/api/crm/leads", headers=auth, json={"status": "lost"})).status_code == 422

    path = f"/api/crm/leads/{lead['id']}"
    refused = await client.patch(path, headers=auth, json={"status": "lost"})
    assert refused.status_code == 422 and "reason" in refused.json()["detail"]
    lost = (await client.patch(path, headers=auth, json={"status": "lost", "lost_reason": "Budget"})).json()
    assert lost["status"] == "lost" and lost["lost_reason"] == "Budget"
    # A null stage means "leave it", not "clear it".
    assert (await client.patch(path, headers=auth, json={"status": None, "name": "Kept"})).json()["status"] == "lost"
    reopened = (await client.patch(path, headers=auth, json={"status": "negotiation"})).json()
    assert reopened["status"] == "negotiation" and reopened["lost_reason"] is None


async def test_leads_lost_before_reasons_existed_stay_editable(client, auth):
    async with AsyncSessionLocal() as db:
        legacy = CrmLead(name="Legacy", status="lost")
        db.add(legacy)
        await db.commit()
        legacy_id = legacy.id
    response = await client.patch(f"/api/crm/leads/{legacy_id}", headers=auth, json={"name": "Legacy renamed", "status": "lost"})
    assert response.status_code == 200 and response.json()["name"] == "Legacy renamed"


async def test_detail_and_timeline_record_changes(client, auth):
    me = await _me(client, auth)
    lead = await _lead(client, auth, value="100")
    assert (await client.get(f"/api/crm/leads/{uuid.uuid4()}", headers=auth)).status_code == 404
    detail = (await client.get(f"/api/crm/leads/{lead['id']}", headers=auth)).json()
    assert detail["name"] == "Lead" and detail["can_delete"] is True

    await client.patch(f"/api/crm/leads/{lead['id']}", headers=auth, json={"status": "contacted", "owner_id": me, "value": "100.00", "priority": "high"})
    timeline = await _timeline(client, auth, lead["id"])
    assert [entry["kind"] for entry in timeline] == ["change", "created"]
    change = timeline[0]["body"]
    assert "Stage: new → contacted" in change and "Priority: — → high" in change and "Owner: Unassigned →" in change
    assert "Value" not in change  # 100 and 100.00 are the same amount

    # Saving without edits adds nothing to the timeline.
    await client.patch(f"/api/crm/leads/{lead['id']}", headers=auth, json={"status": "contacted"})
    assert len(await _timeline(client, auth, lead["id"])) == 2


async def test_logging_contact_sets_last_contacted_and_delete_rules(client, auth):
    lead = await _lead(client, auth)
    path = f"/api/crm/leads/{lead['id']}/activities"
    note = (await client.post(path, headers=auth, json={"kind": "note", "body": "Prefers email"})).json()
    after_note = (await client.get(f"/api/crm/leads/{lead['id']}", headers=auth)).json()
    assert after_note["last_contacted_at"] is None
    call = await client.post(path, headers=auth, json={"kind": "call", "body": "  Discussed pricing  "})
    assert call.status_code == 201 and call.json()["body"] == "Discussed pricing"
    assert (await client.get(f"/api/crm/leads/{lead['id']}", headers=auth)).json()["last_contacted_at"]
    assert (await client.post(path, headers=auth, json={"kind": "note", "body": "   "})).status_code == 422
    assert (await client.post(path, headers=auth, json={"kind": "change", "body": "x"})).status_code == 422

    member, _ = await _crm_member(client, auth)
    # Members can read and add to the timeline, but not delete someone else's entry.
    assert (await client.get(path, headers=member)).status_code == 200
    assert (await client.delete(f"{path}/{note['id']}", headers=member)).status_code == 403
    created = next(e for e in await _timeline(client, auth, lead["id"]) if e["kind"] == "created")
    assert created["can_delete"] is False
    assert (await client.delete(f"{path}/{created['id']}", headers=auth)).status_code == 403
    assert (await client.delete(f"{path}/{note['id']}", headers=auth)).status_code == 204
    other = await _lead(client, auth)
    assert (await client.delete(f"/api/crm/leads/{other['id']}/activities/{call.json()['id']}", headers=auth)).status_code == 404


async def test_only_admins_and_owners_delete_leads(client, auth):
    member, member_id = await _crm_member(client, auth)
    unowned = await _lead(client, auth, name="Unowned")
    owned = await _lead(client, auth, name="Owned", owner_id=member_id)

    listed = {x["name"]: x for x in (await client.get("/api/crm/leads/page", headers=member)).json()["items"]}
    assert listed["Unowned"]["can_delete"] is False and listed["Owned"]["can_delete"] is True
    assert (await client.delete(f"/api/crm/leads/{unowned['id']}", headers=member)).status_code == 403

    bulk = await client.post("/api/crm/leads/bulk", headers=member, json={"ids": [unowned["id"], owned["id"]], "action": "delete"})
    assert bulk.status_code == 403
    assert (await client.get("/api/crm/leads/page", headers=auth)).json()["total"] == 2  # nothing deleted

    assert (await client.delete(f"/api/crm/leads/{owned['id']}", headers=member)).status_code == 204
    assert (await client.delete(f"/api/crm/leads/{unowned['id']}", headers=auth)).status_code == 204


async def test_bulk_assign_and_stage(client, auth):
    member, member_id = await _crm_member(client, auth)
    leads = [await _lead(client, auth, name=f"Bulk {i}") for i in range(3)]
    ids = [x["id"] for x in leads]

    assigned = await client.post("/api/crm/leads/bulk", headers=auth, json={"ids": ids, "action": "assign", "owner_id": member_id})
    assert assigned.json() == {"updated": 3}
    notes = (await client.get("/api/notifications", headers=member)).json()
    assert any("3 leads assigned to you" in n["title"] for n in notes)
    bad_owner = await client.post("/api/crm/leads/bulk", headers=auth, json={"ids": ids, "action": "assign", "owner_id": str(uuid.uuid4())})
    assert bad_owner.status_code == 422

    assert (await client.post("/api/crm/leads/bulk", headers=auth, json={"ids": ids, "action": "status", "status": "lost"})).status_code == 422
    lost = await client.post("/api/crm/leads/bulk", headers=auth, json={"ids": ids, "action": "status", "status": "lost", "lost_reason": "No budget"})
    assert lost.json() == {"updated": 3}
    page = (await client.get("/api/crm/leads/page?status=lost", headers=auth)).json()
    assert page["total"] == 3 and {x["lost_reason"] for x in page["items"]} == {"No budget"}
    assert "Lost reason: No budget" in (await _timeline(client, auth, ids[0]))[0]["body"]


async def test_follow_up_priority_and_tag_filters_and_summary(client, auth):
    today = datetime.now(timezone.utc).date()
    await _lead(client, auth, name="Overdue", follow_up_date=str(today - timedelta(days=2)), priority="high", tags=["VIP", " vip ", "Trade show"], value="500")
    await _lead(client, auth, name="Today", follow_up_date=str(today))
    await _lead(client, auth, name="Later", follow_up_date=str(today + timedelta(days=5)), tags=["vipish"])
    await _lead(client, auth, name="Never")
    await _lead(client, auth, name="Closed overdue", status="won", value="900", follow_up_date=str(today - timedelta(days=9)))

    async def names(query):
        return [x["name"] for x in (await client.get(f"/api/crm/leads/page?{query}", headers=auth)).json()["items"]]

    assert await names("follow_up=overdue") == ["Overdue"]
    assert await names("follow_up=today") == ["Today"]
    assert await names("follow_up=upcoming") == ["Later"]
    assert await names("follow_up=none") == ["Never"]
    assert await names("priority=high") == ["Overdue"]
    assert await names("tag=VIP") == ["Overdue"]  # whole tag, not "vipish"
    assert await names("tag=trade%20show") == ["Overdue"]
    assert (await names("sort=follow_up"))[:3] == ["Closed overdue", "Overdue", "Today"]

    lead = (await client.get("/api/crm/leads/page?priority=high", headers=auth)).json()["items"][0]
    assert lead["tags"] == ["vip", "trade show"]
    summary = (await client.get("/api/crm/summary", headers=auth)).json()
    assert summary["total"] == 5 and summary["by_status"] == {"new": 4, "won": 1}
    assert summary["overdue"] == 1 and summary["due_today"] == 1
    assert summary["open_value"] == "500.00" and summary["won_value"] == "900.00"


async def test_owner_must_be_an_active_user(client, auth):
    assert (await client.post("/api/crm/leads", headers=auth, json={"owner_id": str(uuid.uuid4())})).status_code == 422
    lead = await _lead(client, auth)
    assert (await client.patch(f"/api/crm/leads/{lead['id']}", headers=auth, json={"owner_id": str(uuid.uuid4())})).status_code == 422


async def test_import_preview_maps_columns_and_finds_duplicates(client, auth):
    await _lead(client, auth, name="Existing", email="Known@Example.com")
    data = _csv([
        ["Full Name", "E-mail", "Mobile", "Organisation", "Status", "Priority", "Message", "Inquiry", "Unrelated"],
        ["Ana", "ana@example.com", "971500000001", "Acme", "Not contacted", "High", "Need a quote", "Microscopes", "x"],
        ["Ana again", "ANA@example.com", "", "", "", "", "Second form", "", ""],
        ["Known", "known@example.com", "", "", "", "Review", "", "", ""],
        ["", "", "", "No contact", "", "", "", "", ""],
    ])
    files = {"file": ("leads.csv", data, "text/csv")}
    preview = (await client.post("/api/crm/import/preview", headers=auth, files=files)).json()
    assert preview["mapping"] == {
        "Full Name": "name", "E-mail": "email", "Mobile": "phone", "Organisation": "company",
        "Status": "status", "Priority": "priority", "Message": "notes", "Inquiry": "notes", "Unrelated": None,
    }
    assert preview["total_rows"] == 4 and preview["valid_rows"] == 3
    assert preview["duplicates_in_file"] == 1 and preview["existing_matches"] == 1
    assert [x["match"] for x in preview["sample"]] == ["new", "duplicate_in_file", "exists"]
    assert preview["sample"][0]["status"] == "new"  # "Not contacted" is understood
    assert preview["errors"] == [{"row": 5, "message": "No name, email or phone"}]
    assert any("Review" in w["message"] for w in preview["warnings"])
    # Preview saves nothing.
    assert (await client.get("/api/crm/summary", headers=auth)).json()["total"] == 1

    bad = {"Full Name": "name", "E-mail": "name"}
    refused = await client.post("/api/crm/import/preview", headers=auth, files=files, data={"mapping": json.dumps(bad)})
    assert refused.status_code == 422 and "Only one column" in refused.json()["detail"]
    nothing = await client.post("/api/crm/import/preview", headers=auth, files=files, data={"mapping": json.dumps({"Organisation": "company"})})
    assert nothing.status_code == 422


async def test_import_skips_or_merges_duplicates(client, auth):
    existing = await _lead(client, auth, name="Existing", email="known@example.com", tags=["old"])
    data = _csv([
        ["name", "email", "phone", "company", "value", "notes", "tags"],
        ["Ana", "ana@example.com", "1", "Acme", "AED 1,200.50", "First", "trade"],
        ["Ana dup", "ana@example.com", "2", "", "", "Second", "repeat"],
        ["Known", "known@example.com", "555", "Known Co", "", "Merged note", "new"],
    ])
    skipped = (await client.post("/api/crm/import", headers=auth, files={"file": ("a.csv", data, "text/csv")})).json()
    assert skipped == {"created": 1, "merged": 0, "skipped": 2, "errors": []}
    ana = (await client.get("/api/crm/leads/page?q=ana@example.com", headers=auth)).json()["items"][0]
    assert ana["value"] == "1200.50" and ana["source"] == "import" and ana["source_detail"] == "a.csv"

    merged = (await client.post("/api/crm/import", headers=auth, files={"file": ("b.csv", data, "text/csv")}, data={"on_duplicate": "merge"})).json()
    assert merged == {"created": 0, "merged": 3, "skipped": 0, "errors": []}
    known = (await client.get(f"/api/crm/leads/{existing['id']}", headers=auth)).json()
    assert known["name"] == "Existing"  # existing values are never overwritten
    assert known["phone"] == "555" and known["company"] == "Known Co" and known["tags"] == ["old", "new"]
    assert "Merged note" in (await _timeline(client, auth, existing["id"]))[0]["body"]
    assert (await client.get("/api/crm/summary", headers=auth)).json()["total"] == 2


async def test_import_xlsx_finds_the_lead_sheet(client, auth):
    workbook = openpyxl.Workbook()
    workbook.active.title = "Overview"
    workbook.active.append(["Lead review"])
    sheet = workbook.create_sheet("Potential Leads")
    sheet.append(["Name", "Email", "Phone", "Follow up date"])
    sheet.append(["Ana", "ana@example.com", 971500000001, datetime(2026, 11, 2)])
    buffer = io.BytesIO()
    workbook.save(buffer)
    files = {"file": ("leads.xlsx", buffer.getvalue(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}

    preview = (await client.post("/api/crm/import/preview", headers=auth, files=files)).json()
    assert preview["sheets"] == ["Overview", "Potential Leads"] and preview["sheet"] == "Potential Leads"
    assert (await client.post("/api/crm/import", headers=auth, files=files)).json()["created"] == 1
    lead = (await client.get("/api/crm/leads/page", headers=auth)).json()["items"][0]
    assert lead["phone"] == "971500000001" and lead["follow_up_date"] == "2026-11-02"

    other = await client.post("/api/crm/import/preview", headers=auth, files=files, data={"sheet": "Overview"})
    assert other.status_code == 422  # no name/email/phone column on that sheet
    missing = await client.post("/api/crm/import/preview", headers=auth, files=files, data={"sheet": "Nope"})
    assert missing.status_code == 422


async def test_import_rejects_unreadable_files(client, auth):
    for name, body in [("leads.xls", b"\xd0\xcf\x11\xe0"), ("empty.csv", b""), ("broken.xlsx", b"PK not a zip")]:
        response = await client.post("/api/crm/import", headers=auth, files={"file": (name, body, "application/octet-stream")})
        assert response.status_code == 422, name


async def test_export_escapes_formulas_and_round_trips(client, auth):
    await _lead(client, auth, name="=HYPERLINK(\"http://evil\")", email="evil@example.com", phone="+971 50 123 4567", tags=["a", "b"], priority="low")
    response = await client.get("/api/crm/leads/export?priority=low", headers=auth)
    assert response.status_code == 200 and response.headers["content-type"].startswith("text/csv")
    assert "attachment" in response.headers["content-disposition"]
    rows = list(csv.DictReader(io.StringIO(response.content.decode("utf-8-sig"))))
    assert len(rows) == 1
    assert rows[0]["name"].startswith("'=") and rows[0]["phone"] == "+971 50 123 4567"
    assert rows[0]["tags"] == "a, b" and rows[0]["status"] == "new"

    # Re-importing the export restores the original text, skipping the duplicate.
    await client.delete(f"/api/crm/leads/{(await client.get('/api/crm/leads/page', headers=auth)).json()['items'][0]['id']}", headers=auth)
    result = (await client.post("/api/crm/import", headers=auth, files={"file": ("export.csv", response.content, "text/csv")})).json()
    assert result["created"] == 1
    lead = (await client.get("/api/crm/leads/page", headers=auth)).json()["items"][0]
    assert lead["name"] == "=HYPERLINK(\"http://evil\")" and lead["priority"] == "low" and lead["tags"] == ["a", "b"]


async def test_members_without_crm_are_blocked_from_new_routes(client, auth):
    member, _ = await make_member(client, auth, "nocrm@agholding.net")
    lead = await _lead(client, auth)
    for method, path in [
        ("get", f"/api/crm/leads/{lead['id']}"),
        ("get", f"/api/crm/leads/{lead['id']}/activities"),
        ("get", "/api/crm/leads/export"),
        ("post", "/api/crm/leads/bulk"),
        ("post", "/api/crm/import/preview"),
    ]:
        assert (await getattr(client, method)(path, headers=member)).status_code == 403, path
