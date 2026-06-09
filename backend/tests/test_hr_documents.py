import datetime

import pytest

from helpers import make_member

pytestmark = pytest.mark.asyncio


def _upload(title="Contract", category="contract", expiry=None):
    data = {"title": title, "category": category}
    if expiry:
        data["expiry_date"] = expiry
    return {"data": data, "files": {"file": ("doc.pdf", b"%PDF-1.4 test", "application/pdf")}}


async def test_hr_document_lifecycle_and_visibility(client, auth):
    hdr_emp, emp = await make_member(client, auth, "doc-emp@agholding.net")

    # HR (admin) uploads; employee can list & download their own.
    up = _upload()
    r = await client.post(f"/api/hr-documents/by-user/{emp}", headers=auth, **up)
    assert r.status_code == 201, r.text
    doc_id = r.json()["id"]

    mine = (await client.get(f"/api/hr-documents/by-user/{emp}", headers=hdr_emp)).json()
    assert len(mine) == 1 and mine[0]["title"] == "Contract"
    dl = await client.get(f"/api/hr-documents/{doc_id}/download", headers=hdr_emp)
    assert dl.status_code == 200 and b"PDF" in dl.content

    # A different member cannot see or upload to this record.
    hdr_other, _ = await make_member(client, auth, "doc-other@agholding.net")
    assert (await client.get(f"/api/hr-documents/by-user/{emp}", headers=hdr_other)).status_code == 403
    assert (await client.post(f"/api/hr-documents/by-user/{emp}", headers=hdr_other, **_upload())).status_code == 403
    # The employee themselves cannot upload (HR-only).
    assert (await client.post(f"/api/hr-documents/by-user/{emp}", headers=hdr_emp, **_upload())).status_code == 403

    # Bad category rejected.
    bad = await client.post(f"/api/hr-documents/by-user/{emp}", headers=auth, **_upload(category="nope"))
    assert bad.status_code == 422

    # Delete is HR-only.
    assert (await client.delete(f"/api/hr-documents/{doc_id}", headers=hdr_emp)).status_code == 403
    assert (await client.delete(f"/api/hr-documents/{doc_id}", headers=auth)).status_code == 204


async def test_hr_document_expiry_and_alerts(client, auth):
    _, emp = await make_member(client, auth, "doc-exp@agholding.net")
    soon = (datetime.date.today() + datetime.timedelta(days=15)).isoformat()
    far = (datetime.date.today() + datetime.timedelta(days=400)).isoformat()
    await client.post(f"/api/hr-documents/by-user/{emp}", headers=auth, **_upload("Visa", "visa", soon))
    await client.post(f"/api/hr-documents/by-user/{emp}", headers=auth, **_upload("Passport", "passport", far))

    expiring = (await client.get("/api/hr-documents/expiring?days=60", headers=auth)).json()
    titles = {d["title"] for d in expiring}
    assert "Visa" in titles and "Passport" not in titles
    visa = next(d for d in expiring if d["title"] == "Visa")
    assert visa["days_to_expiry"] is not None and visa["user_name"]

    first = (await client.post("/api/hr-documents/expiring/notify?days=60", headers=auth)).json()
    assert first["reminders_sent"] >= 1
    second = (await client.post("/api/hr-documents/expiring/notify?days=60", headers=auth)).json()
    assert second["reminders_sent"] == 0

    # Non-HR can't see the expiring overview.
    hdr_other, _ = await make_member(client, auth, "doc-exp-other@agholding.net")
    assert (await client.get("/api/hr-documents/expiring", headers=hdr_other)).status_code == 403
