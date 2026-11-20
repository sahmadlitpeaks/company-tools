"""Leads hub (BRD 9B): one lead per person, every source recorded (LHB-01..05)."""
from sqlalchemy import select

PDF = b"%PDF-1.4\n%fake brochure\n"


async def _brochure(client, auth, title):
    pid = (await client.post("/api/products", headers=auth, json={"name": f"{title} product"})).json()["id"]
    r = await client.post(f"/api/products/{pid}/brochures", headers=auth,
                          files={"file": ("b.pdf", PDF, "application/pdf")}, data={"title": title})
    assert r.status_code == 201, r.text
    bid = r.json()["id"]
    await client.post(f"/api/products/brochures/{bid}/share", headers=auth, json={"require_lead": True})
    return bid


async def _capture(client, bid, **body):
    r = await client.post(f"/api/public/brochures/{bid}/lead", json=body)
    assert r.status_code == 200, r.text
    return r.json()["id"]


async def test_the_same_person_from_two_downloads_is_one_lead_with_two_sources(client, auth):
    first, second = await _brochure(client, auth, "Price list"), await _brochure(client, auth, "Catalogue")
    a = await _capture(client, first, name="Jane", email="Jane@Acme.com")
    b = await _capture(client, second, email="jane@acme.com", phone="+971 50 123 4567", company="Acme")
    assert a == b
    leads = (await client.get("/api/crm/leads", headers=auth)).json()
    assert len([lead for lead in leads if (lead["email"] or "").lower() == "jane@acme.com"]) == 1
    detail = (await client.get(f"/api/crm/leads/{a}", headers=auth)).json()
    assert [s["source_detail"] for s in detail["sources"]] == ["Price list", "Catalogue"]
    assert all(s["source"] == "brochure" and s["link"] == "/products" for s in detail["sources"])
    # Missing details are filled in from the later submission.
    assert detail["phone"] == "+971 50 123 4567" and detail["company"] == "Acme"
    # The merged lead still unlocks the second download (gate checks sources).
    assert (await client.get(f"/api/public/brochures/{second}/download?lead={b}")).status_code == 200
    activities = (await client.get(f"/api/crm/leads/{a}/activities", headers=auth)).json()
    assert any("Came in again via Brochure download (Catalogue)" in x["body"] for x in activities)


async def test_phone_numbers_match_in_any_format_and_closed_leads_start_fresh(client, auth):
    bid = await _brochure(client, auth, "Price list")
    a = await _capture(client, bid, name="Omar", phone="+971 50 123 4567")
    assert await _capture(client, bid, name="Omar", phone="050-123-4567") == a
    await client.patch(f"/api/crm/leads/{a}", headers=auth, json={"status": "won"})
    # A won customer coming back is a new opportunity.
    assert await _capture(client, bid, name="Omar", phone="0501234567") != a


async def test_sources_summary_counts_leads_and_submissions(client, auth):
    bid = await _brochure(client, auth, "Price list")
    await _capture(client, bid, email="a@x.test")
    await _capture(client, bid, email="a@x.test")
    await _capture(client, bid, email="b@x.test")
    r = await client.post("/api/crm/leads", headers=auth, json={"name": "Walk-in", "source": "manual"})
    assert r.status_code == 201
    rows = {(s["source"], s["source_detail"]): s for s in (await client.get("/api/crm/sources", headers=auth)).json()}
    assert rows[("brochure", "Price list")]["submissions"] == 3 and rows[("brochure", "Price list")]["leads"] == 2
    assert rows[("manual", None)]["leads"] == 1 and rows[("brochure", "Price list")]["last_at"]


async def test_catch_up_import_records_card_leads_once_and_merges_people(client, auth):
    from app.core.database import AsyncSessionLocal
    from app.models.card import DigitalCard, Lead
    from app.models.user import User
    from app.models.crm import CrmLeadSource

    async with AsyncSessionLocal() as db:
        owner = await db.scalar(select(User).limit(1))
        card = DigitalCard(full_name="Sales", slug="sales-card", owner_id=owner.id)
        db.add(card)
        await db.flush()
        db.add_all([Lead(card_id=card.id, name="Lee", email="lee@x.test"),
                    Lead(card_id=card.id, name="Lee again", email="LEE@x.test")])
        await db.commit()
    r = await client.post("/api/crm/sync-existing", headers=auth)
    assert r.json() == {"created": 1, "merged": 1}
    assert (await client.post("/api/crm/sync-existing", headers=auth)).json() == {"created": 0, "merged": 0}
    async with AsyncSessionLocal() as db:
        assert len((await db.scalars(select(CrmLeadSource).where(CrmLeadSource.origin_type == "card_lead"))).all()) == 2
