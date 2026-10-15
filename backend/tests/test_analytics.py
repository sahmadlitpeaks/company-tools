from datetime import datetime, timedelta, timezone
from decimal import Decimal

from sqlalchemy import event, insert, select

from app.api.analytics import overview
from app.core.database import AsyncSessionLocal, engine
from app.models.card import CardScan, DigitalCard
from app.models.shortlink import LinkClick, ShortLink
from app.models.tracked_asset import TrackedAsset
from app.models.user import User


async def test_overview_empty_tables_and_authentication(client, auth):
    client.cookies.clear()
    assert (await client.get("/api/analytics/overview")).status_code == 401
    response = await client.get("/api/analytics/overview", headers=auth)
    assert response.status_code == 200
    result = response.json()
    assert result["counts"]["employees"] == 1
    assert all(value == 0 for name, value in result["counts"].items() if name != "employees")
    assert result["engagement"] == {"total_link_clicks": 0, "total_card_scans": 0}
    assert result["assets"] == {"by_status": {}, "total_book_value": "0.00", "warranty_alerts": []}
    for series in result["series"].values():
        assert len(series) == 14
        assert all(row["count"] == 0 for row in series)


async def test_overview_daily_totals_preserve_history_and_asset_values(client, auth):
    now = datetime.now(timezone.utc)
    today = now.date()
    async with AsyncSessionLocal() as db:
        user = (await db.scalars(select(User))).first()
        link = ShortLink(code="analytics", target_url="https://example.com", click_count=99)
        card = DigitalCard(owner_id=user.id, slug="analytics", full_name="Alex")
        db.add_all([link, card])
        await db.flush()
        # Older and future events count in lifetime totals, but not today's series.
        for days, count in [(0, 3), (2, 2), (13, 1), (20, 4), (-2, 5)]:
            timestamp = now - timedelta(days=days)
            db.add_all([LinkClick(link_id=link.id, created_at=timestamp) for _ in range(count)])
            db.add_all([CardScan(card_id=card.id, created_at=timestamp) for _ in range(count)])
        db.add_all([
            TrackedAsset(asset_tag="A-1", name="Laptop", status="assigned", purchase_cost=Decimal("1200"),
                         purchase_date=today, useful_life_years=3, warranty_expiry=today + timedelta(days=5)),
            TrackedAsset(asset_tag="A-2", name="Printer", status="available", warranty_expiry=today - timedelta(days=1)),
        ])
        await db.commit()
    result = (await client.get("/api/analytics/overview", headers=auth)).json()
    assert result["counts"]["cards"] == 1
    assert result["counts"]["short_links"] == 1
    assert result["counts"]["assets"] == 2
    assert result["engagement"] == {"total_link_clicks": 99, "total_card_scans": 15}
    for series in result["series"].values():
        assert [row["date"] for row in series] == [(today - timedelta(days=d)).isoformat() for d in range(13, -1, -1)]
        expected = {(today - timedelta(days=d)).isoformat(): count for d, count in [(0, 3), (2, 2), (13, 1)]}
        assert {row["date"]: row["count"] for row in series if row["count"]} == expected
    assert result["assets"]["by_status"] == {"assigned": 1, "available": 1}
    assert result["assets"]["total_book_value"] == "1200.00"
    assert [row["asset_tag"] for row in result["assets"]["warranty_alerts"]] == ["A-1"]


async def test_overview_database_work_is_bounded_as_events_grow(client):
    async with AsyncSessionLocal() as db:
        user = (await db.scalars(select(User))).first()
        link = ShortLink(code="volume", target_url="https://example.com")
        card = DigitalCard(owner_id=user.id, slug="volume", full_name="Alex")
        db.add_all([link, card])
        await db.flush()
        now = datetime.now(timezone.utc)
        await db.execute(insert(LinkClick), [{"link_id": link.id, "created_at": now} for _ in range(2000)])
        await db.execute(insert(CardScan), [{"card_id": card.id, "created_at": now} for _ in range(2000)])
        await db.commit()
        selects = []

        def record(_conn, _cursor, statement, _parameters, _context, _many):
            if statement.lstrip().upper().startswith("SELECT"):
                selects.append(statement)

        event.listen(engine.sync_engine, "before_cursor_execute", record)
        try:
            result = await overview(db, user)
        finally:
            event.remove(engine.sync_engine, "before_cursor_execute", record)
        assert len(selects) <= 5
        assert sum(row["count"] for row in result["series"]["clicks"]) == 2000
        assert sum(row["count"] for row in result["series"]["scans"]) == 2000
        assert len(result["series"]["clicks"]) == 14
