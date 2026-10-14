from collections import Counter
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.core.database import get_db
from app.models.activity import ActivityLog
from app.models.card import CardScan, DigitalCard
from app.models.landing import LandingPage
from app.models.product import Product
from app.models.qrcode import QRCode
from app.models.shortlink import LinkClick, ShortLink
from app.models.tracked_asset import TrackedAsset
from app.models.transfer import SecureTransfer
from app.models.user import User

router = APIRouter(prefix="/analytics", tags=["analytics"])

WINDOW_DAYS = 14
WARRANTY_SOON_DAYS = 30


async def _daily_series(db: AsyncSession, model, since: datetime, days: int) -> list[dict]:
    # Return one row per day, rather than transferring every click/scan to Python.
    day = func.date(model.created_at)
    rows = (await db.execute(
        select(day, func.count())
        .where(model.created_at >= since)
        .group_by(day)
    )).all()
    today = datetime.now(timezone.utc).date()
    counts = {str(day): int(count) for day, count in rows}
    series = []
    for i in range(days - 1, -1, -1):
        d = (today - timedelta(days=i)).isoformat()
        series.append({"date": d, "count": counts.get(d, 0)})
    return series


@router.get("/overview")
async def overview(
    db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)
):
    since = datetime.now(timezone.utc) - timedelta(days=WINDOW_DAYS)

    models = {
        "employees": User,
        "cards": DigitalCard,
        "qrcodes": QRCode,
        "products": Product,
        "landing_pages": LandingPage,
        "short_links": ShortLink,
        "assets": TrackedAsset,
        "transfers": SecureTransfer,
    }
    # Independent scalar subqueries preserve empty-table counts without joins,
    # and collect all overview totals in one database round trip.
    totals = (await db.execute(select(
        *(select(func.count()).select_from(model).scalar_subquery().label(name)
          for name, model in models.items()),
        select(func.coalesce(func.sum(ShortLink.click_count), 0))
        .scalar_subquery().label("total_clicks"),
        select(func.count()).select_from(CardScan).scalar_subquery().label("total_scans"),
    ))).one()._mapping
    counts = {name: int(totals[name]) for name in models}
    total_clicks = totals["total_clicks"]
    total_scans = totals["total_scans"]

    # ---- Time series (last 14 days) ----
    click_series = await _daily_series(db, LinkClick, since, WINDOW_DAYS)
    scan_series = await _daily_series(db, CardScan, since, WINDOW_DAYS)

    # ---- Asset health ----
    assets = (await db.execute(select(TrackedAsset))).scalars().all()
    by_status: Counter[str] = Counter(a.status for a in assets)
    total_book = Decimal("0")
    for a in assets:
        from app.api.tracker import _book_value

        bv = _book_value(a)
        if bv is not None:
            total_book += bv

    today = date.today()
    soon = today + timedelta(days=WARRANTY_SOON_DAYS)
    warranty_alerts = [
        {
            "id": str(a.id),
            "name": a.name,
            "asset_tag": a.asset_tag,
            "warranty_expiry": a.warranty_expiry.isoformat(),
            "days_left": (a.warranty_expiry - today).days,
        }
        for a in assets
        if a.warranty_expiry and today <= a.warranty_expiry <= soon
    ]
    warranty_alerts.sort(key=lambda x: x["days_left"])

    # ---- Recent activity ----
    activity = (
        await db.execute(
            select(ActivityLog).order_by(ActivityLog.created_at.desc()).limit(12)
        )
    ).scalars().all()
    recent = [
        {
            "id": str(a.id),
            "actor": a.actor_name,
            "action": a.action,
            "entity_type": a.entity_type,
            "summary": a.summary,
            "created_at": a.created_at.isoformat() if a.created_at else None,
        }
        for a in activity
    ]

    return {
        "counts": counts,
        "engagement": {"total_link_clicks": int(total_clicks), "total_card_scans": int(total_scans)},
        "series": {
            "clicks": click_series,
            "scans": scan_series,
        },
        "assets": {
            "by_status": dict(by_status),
            "total_book_value": str(total_book.quantize(Decimal("0.01"))),
            "warranty_alerts": warranty_alerts,
        },
        "recent_activity": recent,
    }
