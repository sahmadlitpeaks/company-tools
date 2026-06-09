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


async def _count(db: AsyncSession, model) -> int:
    return (await db.execute(select(func.count()).select_from(model))).scalar_one()


def _bucket(rows: list[datetime], days: int) -> list[dict]:
    today = datetime.now(timezone.utc).date()
    counts: Counter[str] = Counter()
    for ts in rows:
        if ts is None:
            continue
        d = ts.date() if isinstance(ts, datetime) else ts
        counts[d.isoformat()] += 1
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

    counts = {
        "employees": await _count(db, User),
        "cards": await _count(db, DigitalCard),
        "qrcodes": await _count(db, QRCode),
        "products": await _count(db, Product),
        "landing_pages": await _count(db, LandingPage),
        "short_links": await _count(db, ShortLink),
        "assets": await _count(db, TrackedAsset),
        "transfers": await _count(db, SecureTransfer),
    }

    total_clicks = (
        await db.execute(select(func.coalesce(func.sum(ShortLink.click_count), 0)))
    ).scalar_one()
    total_scans = (await db.execute(select(func.count()).select_from(CardScan))).scalar_one()

    # ---- Time series (last 14 days) ----
    click_rows = (
        await db.execute(select(LinkClick.created_at).where(LinkClick.created_at >= since))
    ).scalars().all()
    scan_rows = (
        await db.execute(select(CardScan.created_at).where(CardScan.created_at >= since))
    ).scalars().all()

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
            "clicks": _bucket(list(click_rows), WINDOW_DAYS),
            "scans": _bucket(list(scan_rows), WINDOW_DAYS),
        },
        "assets": {
            "by_status": dict(by_status),
            "total_book_value": str(total_book.quantize(Decimal("0.01"))),
            "warranty_alerts": warranty_alerts,
        },
        "recent_activity": recent,
    }
