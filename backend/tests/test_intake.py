import pytest

pytestmark = pytest.mark.asyncio


async def test_public_submit_triage_and_convert(client, auth):
    # Create a source -> get its public key.
    src = (await client.post("/api/intake/sources", headers=auth, json={
        "name": "Main Website", "default_type": "lead",
    })).json()
    assert src["key"]
    token = src["key"]

    # Token-authenticated ingest maps known fields + keeps extras.
    r = await client.post("/api/intake/ingest", headers={"Authorization": f"Bearer {token}"}, json={
        "name": "Jane Visitor", "email": "jane@acme.com", "phone": "+15551212",
        "company": "Acme", "subject": "Quote please", "message": "I want a demo",
        "page_url": "https://site.com/contact", "budget": "10k",
    })
    assert r.status_code == 200 and r.json()["ok"]

    # X-API-Key header also works, with an explicit type.
    await client.post("/api/intake/ingest", headers={"X-API-Key": token}, json={
        "type": "complaint", "name": "Angry Cat", "email": "cat@acme.com",
        "message": "It broke",
    })

    # Missing/invalid token = 401.
    assert (await client.post("/api/intake/ingest", json={"name": "x"})).status_code == 401
    assert (await client.post("/api/intake/ingest", headers={"Authorization": "Bearer nope"}, json={"name": "x"})).status_code == 401

    subs = (await client.get("/api/intake/submissions", headers=auth)).json()
    assert len(subs) == 2
    lead_sub = next(s for s in subs if s["email"] == "jane@acme.com")
    assert lead_sub["type"] == "lead" and lead_sub["source_name"] == "Main Website"
    assert lead_sub["payload"]["budget"] == "10k"

    summ = (await client.get("/api/intake/summary", headers=auth)).json()
    assert summ["new"] == 2 and summ["by_type"]["complaint"] == 1

    # Filter by type.
    complaints = (await client.get("/api/intake/submissions?type=complaint", headers=auth)).json()
    assert len(complaints) == 1

    # Convert the lead submission -> CRM lead.
    conv = await client.post(f"/api/intake/submissions/{lead_sub['id']}/convert-lead", headers=auth)
    assert conv.status_code == 200 and conv.json()["converted_lead_id"]
    assert conv.json()["status"] == "in_progress"
    # Double convert blocked.
    assert (await client.post(f"/api/intake/submissions/{lead_sub['id']}/convert-lead", headers=auth)).status_code == 409
    leads = (await client.get("/api/crm/leads", headers=auth)).json()
    assert any(le.get("email") == "jane@acme.com" and le.get("source") == "web" for le in leads)

    # Convert the complaint -> ticket.
    comp = complaints[0]
    ct = await client.post(f"/api/intake/submissions/{comp['id']}/convert-ticket", headers=auth)
    assert ct.status_code == 200 and ct.json()["converted_ticket_id"]


async def test_intake_management_requires_module(client, auth):
    from helpers import make_member

    # Members lack the crm module -> management endpoints are 403.
    hdr, _ = await make_member(client, auth, "intake-nocrm@agholding.net")
    assert (await client.get("/api/intake/submissions", headers=hdr)).status_code == 403
    assert (await client.get("/api/intake/sources", headers=hdr)).status_code == 403


async def test_spam_quarantine_release_and_autoconvert(client, auth):
    src = (await client.post("/api/intake/sources", headers=auth, json={
        "name": "Site B", "default_type": "lead",
    })).json()
    tok = {"Authorization": f"Bearer {src['key']}"}

    # Honeypot field filled -> definite spam.
    r = await client.post("/api/intake/ingest", headers=tok, json={
        "name": "Bot", "email": "bot@x.com", "message": "hi", "_gotcha": "filled",
    })
    assert r.json()["status"] == "spam" and r.json()["spam_score"] == 100

    # Spammy content (links + keywords + disposable email) -> spam, not in inbox.
    await client.post("/api/intake/ingest", headers=tok, json={
        "name": "SEO", "email": "x@mailinator.com",
        "message": "cheap viagra http://a.com http://b.com http://c.com seo backlinks",
    })

    # Clean lead -> released as new.
    clean = await client.post("/api/intake/ingest", headers=tok, json={
        "name": "Real Person", "email": "real@acme.com", "phone": "+15550000",
        "message": "Hello, I'd like a quote for your service.",
    })
    assert clean.json()["status"] == "new"

    new_ones = (await client.get("/api/intake/submissions?status=new", headers=auth)).json()
    assert all(s["source_id"] != src["id"] or s["email"] == "real@acme.com" for s in new_ones)
    quarantined_or_spam = (await client.get("/api/intake/submissions?status=spam", headers=auth)).json()
    assert len(quarantined_or_spam) >= 2

    # A spam item can be released (false positive) -> becomes new.
    spam_item = quarantined_or_spam[0]
    rel = await client.post(f"/api/intake/submissions/{spam_item['id']}/release", headers=auth)
    assert rel.status_code == 200 and rel.json()["status"] == "new"

    # Auto-convert: a source with auto_convert turns clean leads into CRM leads.
    asrc = (await client.post("/api/intake/sources", headers=auth, json={
        "name": "Auto Site", "default_type": "lead", "auto_convert": True,
    })).json()
    a = await client.post("/api/intake/ingest", headers={"Authorization": f"Bearer {asrc['key']}"}, json={
        "name": "Auto Lead", "email": "auto@acme.com", "message": "Interested in pricing please.",
    })
    assert a.json()["status"] == "new"
    leads = (await client.get("/api/crm/leads", headers=auth)).json()
    assert any(le.get("email") == "auto@acme.com" for le in leads)
