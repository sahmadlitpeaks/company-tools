import uuid
from datetime import date, datetime, timedelta, timezone

import pytest

from app.core.database import AsyncSessionLocal
from app.models.workplace import Ticket
from app.services.sla import SLAConfig, business_deadline

pytestmark = pytest.mark.asyncio


# ---- Business-hours SLA maths (unit) ----
async def test_business_deadline_skips_weekend():
    cfg = SLAConfig()  # Sun–Thu, 09:00–18:00, +04:00
    # Thursday 2026-06-04 17:00 local (+04) == 13:00 UTC.
    start = datetime(2026, 6, 4, 13, 0, tzinfo=timezone.utc)
    # 4 working hours: 1h left Thu, then Fri/Sat are off → 3h on Sunday from 09:00.
    out = business_deadline(start, 4, cfg)
    assert out == datetime(2026, 6, 7, 8, 0, tzinfo=timezone.utc)  # Sun 12:00 +04


async def test_business_deadline_same_day():
    cfg = SLAConfig()
    start = datetime(2026, 6, 7, 5, 0, tzinfo=timezone.utc)  # Sun 09:00 +04
    out = business_deadline(start, 4, cfg)
    assert out == datetime(2026, 6, 7, 9, 0, tzinfo=timezone.utc)  # Sun 13:00 +04


async def test_business_deadline_honours_holidays():
    cfg = SLAConfig(holidays={date(2026, 6, 7)})  # Sunday is a holiday
    start = datetime(2026, 6, 4, 13, 0, tzinfo=timezone.utc)  # Thu 17:00 +04
    out = business_deadline(start, 4, cfg)
    # Thu 1h + holiday Sunday skipped → 3h on Monday from 09:00 = Mon 12:00 +04.
    assert out == datetime(2026, 6, 8, 8, 0, tzinfo=timezone.utc)


# ---- SLA breach alerts ----
async def test_sla_alerts_notify_and_dedup(client, auth):
    t = (await client.post(
        "/api/tickets", headers=auth, json={"subject": "DB down", "category": "it", "priority": "high"}
    )).json()
    # Force the ticket past its resolution SLA.
    async with AsyncSessionLocal() as db:
        ticket = await db.get(Ticket, uuid.UUID(t["id"]))
        ticket.sla_resolution_due = datetime.now(timezone.utc) - timedelta(hours=1)
        ticket.sla_response_due = datetime.now(timezone.utc) - timedelta(hours=2)
        await db.commit()

    # Sweep via the admin endpoint → admin (an agent) gets breach notifications.
    res = (await client.post("/api/tickets/sla-sweep", headers=auth)).json()
    assert res["created"] >= 1
    notes = (await client.get("/api/notifications", headers=auth)).json()
    assert any("overdue" in n["title"].lower() for n in notes)

    # Re-running is idempotent (dedup keeps it from spamming).
    again = (await client.post("/api/tickets/sla-sweep", headers=auth)).json()
    assert again["created"] == 0


async def test_sla_sweep_requires_agent(client, auth):
    token = (await client.post("/api/auth/dev-login", params={"email": "mo@agholding.net"})).json()["access_token"]
    users = (await client.get("/api/users", headers=auth)).json()
    uid = next(u["id"] for u in users if u["email"] == "mo@agholding.net")
    await client.patch(f"/api/users/{uid}", headers=auth, json={"status": "active", "role": "member"})
    hdr = {"Authorization": f"Bearer {token}"}
    assert (await client.post("/api/tickets/sla-sweep", headers=hdr)).status_code == 403


# ---- SLA admin config ----
async def test_sla_settings_roundtrip(client, auth):
    up = await client.put(
        "/api/settings/sla",
        headers=auth,
        json={"work_start": 8, "work_end": 17, "holidays": "2026-12-02,2026-12-03"},
    )
    assert up.status_code == 200
    cfg = up.json()
    assert cfg["work_start"] == 8 and cfg["work_end"] == 17
    assert "2026-12-02" in cfg["holidays"]
    got = (await client.get("/api/settings/sla", headers=auth)).json()
    assert got["work_start"] == 8


# ---- Saved views ----
async def test_saved_views_crud(client, auth):
    a = await client.post(
        "/api/views", headers=auth,
        json={"surface": "tickets", "name": "My overdue", "params": "scope=assigned&overdue=true"},
    )
    assert a.status_code == 201
    await client.post(
        "/api/views", headers=auth,
        json={"surface": "tasks", "name": "Due this week", "params": "due=week"},
    )
    # Listing is scoped by surface.
    tix = (await client.get("/api/views?surface=tickets", headers=auth)).json()
    assert len(tix) == 1 and tix[0]["name"] == "My overdue"

    # Saving the same name overwrites (upsert), doesn't duplicate.
    up = await client.post(
        "/api/views", headers=auth,
        json={"surface": "tickets", "name": "My overdue", "params": "scope=mine"},
    )
    assert up.status_code == 201
    tix = (await client.get("/api/views?surface=tickets", headers=auth)).json()
    assert len(tix) == 1 and tix[0]["params"] == "scope=mine"

    # Bad surface rejected.
    assert (await client.post("/api/views", headers=auth, json={"surface": "nope", "name": "x"})).status_code == 422

    # Delete.
    await client.delete(f"/api/views/{tix[0]['id']}", headers=auth)
    assert (await client.get("/api/views?surface=tickets", headers=auth)).json() == []


async def test_saved_views_are_per_user(client, auth):
    await client.post("/api/views", headers=auth, json={"surface": "tickets", "name": "Mine", "params": ""})
    token = (await client.post("/api/auth/dev-login", params={"email": "vu@agholding.net"})).json()["access_token"]
    users = (await client.get("/api/users", headers=auth)).json()
    uid = next(u["id"] for u in users if u["email"] == "vu@agholding.net")
    await client.patch(f"/api/users/{uid}", headers=auth, json={"status": "active"})
    hdr = {"Authorization": f"Bearer {token}"}
    assert (await client.get("/api/views?surface=tickets", headers=hdr)).json() == []
