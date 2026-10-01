import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest

from app.core.database import AsyncSessionLocal
from app.models.crm import CrmLead
from app.models.intake import Submission

pytestmark = pytest.mark.asyncio


async def test_inbox_pages_go_beyond_old_cap_and_keep_scopes_separate(client, auth):
    start = datetime(2026, 9, 1, tzinfo=timezone.utc)
    async with AsyncSessionLocal() as db:
        db.add_all([Submission(name=f"Sender {i}", type="lead", status="new", created_at=start + timedelta(minutes=i)) for i in range(505)])
        db.add_all([Submission(name="Held", type="inquiry", status="quarantined"), Submission(name="Spam", type="lead", status="spam"), Submission(name="Old", type="lead", status="archived")])
        await db.commit()
    seen = set()
    for offset in range(0, 505, 100):
        response = await client.get(f"/api/intake/submissions/page?limit=100&offset={offset}", headers=auth)
        assert response.status_code == 200
        page = response.json()
        assert page["total"] == 505 and page["offset"] == offset
        assert all(item["status"] == "new" for item in page["items"])
        ids = {item["id"] for item in page["items"]}
        assert not seen.intersection(ids)
        seen.update(ids)
    assert len(seen) == 505
    held = (await client.get("/api/intake/submissions/page?scope=quarantine", headers=auth)).json()
    assert held["total"] == 2
    archived = (await client.get("/api/intake/submissions/page?scope=archived", headers=auth)).json()
    assert archived["total"] == 1 and archived["items"][0]["name"] == "Old"
    # The old array contract still works for existing consumers.
    assert isinstance((await client.get("/api/intake/submissions", headers=auth)).json(), list)


async def test_inbox_combines_filters_and_inclusive_dates(client, auth):
    source = (await client.post("/api/intake/sources", headers=auth, json={"name": "Test website"})).json()
    source_id = uuid.UUID(source["id"])
    async with AsyncSessionLocal() as db:
        db.add_all([
            Submission(source_id=source_id, name="Exact", company="100% Company", phone="1234", type="inquiry", status="in_progress", created_at=datetime(2026, 9, 10, 23, 59, 59, 999999, tzinfo=timezone.utc)),
            Submission(source_id=source_id, name="Wrong day", company="100% Company", type="inquiry", status="in_progress", created_at=datetime(2026, 9, 11, tzinfo=timezone.utc)),
            Submission(name="Wrong site", type="inquiry", status="in_progress", company="100% Company", created_at=datetime(2026, 9, 10, tzinfo=timezone.utc)),
        ])
        await db.commit()
    response = await client.get("/api/intake/submissions/page", headers=auth, params={"source_id": str(source_id), "type": "inquiry", "status": "in_progress", "q": "100%", "after": "2026-09-10", "before": "2026-09-10"})
    assert response.status_code == 200
    assert response.json()["total"] == 1
    assert response.json()["items"][0]["name"] == "Exact"
    assert (await client.get("/api/intake/submissions/page?q=1234", headers=auth)).json()["total"] == 1


async def test_crm_pages_go_beyond_old_cap_and_sort_values(client, auth):
    same_time = datetime(2026, 9, 1, tzinfo=timezone.utc)
    async with AsyncSessionLocal() as db:
        db.add_all([CrmLead(name=f"Lead {i}", source="manual", status="new", value=Decimal(i), created_at=same_time) for i in range(1005)])
        db.add(CrmLead(name="No value", source="web", status="new", created_at=same_time))
        await db.commit()
    seen = set()
    for offset in range(0, 1006, 100):
        response = await client.get(f"/api/crm/leads/page?limit=100&offset={offset}", headers=auth)
        assert response.status_code == 200
        page = response.json()
        assert page["total"] == 1006
        ids = {item["id"] for item in page["items"]}
        assert not seen.intersection(ids)
        seen.update(ids)
    assert len(seen) == 1006
    high = (await client.get("/api/crm/leads/page?sort=value_high&limit=10", headers=auth)).json()
    assert high["items"][0]["name"] == "Lead 1004"
    low = (await client.get("/api/crm/leads/page?sort=value_low&limit=10", headers=auth)).json()
    assert low["items"][0]["name"] == "Lead 0"


async def test_crm_owner_brand_search_and_date_filters(client, auth):
    from app.models.company import Company
    from app.models.user import User
    from sqlalchemy import select

    async with AsyncSessionLocal() as db:
        owner = (await db.execute(select(User).where(User.email == "admin@agholding.net"))).scalar_one()
        brand = Company(name="Filter brand", slug="filter-brand")
        db.add(brand)
        await db.flush()
        owner_id, brand_id = owner.id, brand.id
        db.add_all([
            CrmLead(name="Match", source="web", status="qualified", owner_id=owner_id, company_id=brand_id, notes="Need follow_up", phone="971555", created_at=datetime(2026, 9, 10, tzinfo=timezone.utc)),
            CrmLead(name="Unassigned", source="web", status="qualified", company_id=brand_id, notes="Need followXup", created_at=datetime(2026, 9, 10, tzinfo=timezone.utc)),
        ])
        await db.commit()
    page = (await client.get("/api/crm/leads/page", headers=auth, params={"status": "qualified", "source": "web", "owner_id": str(owner_id), "company_id": str(brand_id), "q": "follow_up", "after": "2026-09-10", "before": "2026-09-10"})).json()
    assert page["total"] == 1 and page["items"][0]["name"] == "Match"
    assert page["items"][0]["owner_name"]
    assert (await client.get("/api/crm/leads/page?unassigned=true", headers=auth)).json()["items"][0]["name"] == "Unassigned"
    assert (await client.get("/api/crm/leads/page?q=971555", headers=auth)).json()["total"] == 1
    assert (await client.get(f"/api/crm/leads/page?owner_id={owner_id}&unassigned=true", headers=auth)).status_code == 422


@pytest.mark.parametrize("path", ["/api/intake/submissions/page", "/api/crm/leads/page"])
async def test_page_after_deletion_clamps_and_empty_resets(client, auth, path):
    async with AsyncSessionLocal() as db:
        model = CrmLead if "/crm/" in path else Submission
        db.add_all([model(name=f"Record {i}", **({"source": "manual"} if model is CrmLead else {"type": "lead"}), status="new") for i in range(11)])
        await db.commit()
    page = (await client.get(f"{path}?limit=10&offset=10", headers=auth)).json()
    record_id = page["items"][0]["id"]
    await client.delete(f"{path.removesuffix('/page')}/{record_id}", headers=auth)
    clamped = (await client.get(f"{path}?limit=10&offset=10", headers=auth)).json()
    assert clamped["offset"] == 0 and clamped["total"] == 10 and len(clamped["items"]) == 10
    empty = (await client.get(f"{path}?q=nonexistent&offset=100", headers=auth)).json()
    assert empty["offset"] == 0 and empty["total"] == 0 and empty["items"] == []


@pytest.mark.parametrize("path", ["/api/intake/submissions/page", "/api/crm/leads/page"])
async def test_page_validation_and_module_permissions(client, auth, path):
    from helpers import make_member

    for query in ["limit=0", "limit=101", "offset=-1", "sort=bad", "status=bad", "after=2026-10-02&before=2026-10-01", "after=not-a-date"]:
        assert (await client.get(f"{path}?{query}", headers=auth)).status_code == 422
    client.cookies.clear()
    assert (await client.get(path)).status_code == 401
    member_auth, _ = await make_member(client, auth, "no-crm-pagination@agholding.net")
    assert (await client.get(path, headers=member_auth)).status_code == 403


async def test_source_filter_labels_do_not_expose_credentials(client, auth):
    from helpers import make_member

    source = (await client.post("/api/intake/sources", headers=auth, json={"name": "Private website"})).json()
    member_auth, user_id = await make_member(client, auth, "crm-filter-user@agholding.net")
    await client.patch(f"/api/users/{user_id}", headers=auth, json={"extra_permissions": ["crm"]})
    response = await client.get("/api/intake/submission-sources", headers=member_auth)
    assert response.status_code == 200
    assert response.json() == [{"id": source["id"], "name": "Private website"}]
    assert (await client.get("/api/intake/sources", headers=member_auth)).status_code == 403
