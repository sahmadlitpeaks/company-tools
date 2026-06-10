import csv
import io
import uuid
from collections import defaultdict
from datetime import date
from decimal import Decimal, InvalidOperation

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.core.database import get_db
from app.models.campaign import Campaign, CampaignMetric
from app.models.user import User
from app.schemas.campaign import (
    CampaignBreakdown,
    CampaignCreate,
    CampaignOut,
    CampaignOverview,
    CampaignUpdate,
    ChannelBreakdown,
    Kpis,
    MetricCreate,
    MetricOut,
    OverviewItem,
)

router = APIRouter(prefix="/campaigns", tags=["campaign-studio"])

CHANNELS = {"facebook", "instagram", "google", "tiktok", "other"}


def _q(v) -> Decimal:
    return Decimal(v).quantize(Decimal("0.01"))


def _kpis(spend, impressions, clicks, conversions, revenue) -> Kpis:
    spend = Decimal(spend or 0)
    revenue = Decimal(revenue or 0)
    impressions = int(impressions or 0)
    clicks = int(clicks or 0)
    conversions = int(conversions or 0)
    return Kpis(
        spend=_q(spend),
        impressions=impressions,
        clicks=clicks,
        conversions=conversions,
        revenue=_q(revenue),
        ctr=round((clicks / impressions * 100) if impressions else 0.0, 2),
        cpc=_q(spend / clicks) if clicks else Decimal("0.00"),
        cpm=_q(spend / impressions * 1000) if impressions else Decimal("0.00"),
        cpa=_q(spend / conversions) if conversions else Decimal("0.00"),
        conversion_rate=round((conversions / clicks * 100) if clicks else 0.0, 2),
        roas=round(float(revenue / spend) if spend else 0.0, 2),
    )


def _aggregate(rows) -> tuple:
    s = sum((Decimal(r.spend or 0) for r in rows), Decimal("0"))
    rev = sum((Decimal(r.revenue or 0) for r in rows), Decimal("0"))
    imp = sum(int(r.impressions or 0) for r in rows)
    clk = sum(int(r.clicks or 0) for r in rows)
    conv = sum(int(r.conversions or 0) for r in rows)
    return s, imp, clk, conv, rev


@router.get("", response_model=list[CampaignOut])
async def list_campaigns(
    company_id: uuid.UUID | None = None,
    status: str | None = None,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    stmt = select(Campaign).order_by(Campaign.created_at.desc())
    if company_id:
        stmt = stmt.where(Campaign.company_id == company_id)
    if status:
        stmt = stmt.where(Campaign.status == status)
    campaigns = (await db.execute(stmt)).scalars().all()

    metrics = (await db.execute(select(CampaignMetric))).scalars().all()
    by_campaign: dict[uuid.UUID, list] = defaultdict(list)
    for m in metrics:
        by_campaign[m.campaign_id].append(m)

    result = []
    for c in campaigns:
        out = CampaignOut.model_validate(c)
        out.kpis = _kpis(*_aggregate(by_campaign.get(c.id, [])))
        result.append(out)
    return result


@router.post("", response_model=CampaignOut, status_code=201)
async def create_campaign(
    payload: CampaignCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    c = Campaign(created_by_id=user.id, **payload.model_dump())
    db.add(c)
    await db.commit()
    await db.refresh(c)
    out = CampaignOut.model_validate(c)
    out.kpis = _kpis(0, 0, 0, 0, 0)
    return out


async def _get(db: AsyncSession, cid: uuid.UUID) -> Campaign:
    c = await db.get(Campaign, cid)
    if not c:
        raise HTTPException(status_code=404, detail="Campaign not found")
    return c


@router.patch("/{campaign_id}", response_model=CampaignOut)
async def update_campaign(
    campaign_id: uuid.UUID,
    payload: CampaignUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    c = await _get(db, campaign_id)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(c, field, value)
    await db.commit()
    await db.refresh(c)
    return CampaignOut.model_validate(c)


@router.delete("/{campaign_id}", status_code=204)
async def delete_campaign(
    campaign_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    c = await _get(db, campaign_id)
    await db.delete(c)
    await db.commit()


@router.get("/overview", response_model=CampaignOverview)
async def overview(
    company_id: uuid.UUID | None = None,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    cstmt = select(Campaign)
    if company_id:
        cstmt = cstmt.where(Campaign.company_id == company_id)
    campaigns = (await db.execute(cstmt)).scalars().all()
    ids = {c.id for c in campaigns}
    metrics = [
        m
        for m in (await db.execute(select(CampaignMetric))).scalars().all()
        if m.campaign_id in ids
    ]

    totals = _kpis(*_aggregate(metrics))

    by_channel_rows: dict[str, list] = defaultdict(list)
    for m in metrics:
        by_channel_rows[m.channel].append(m)
    by_channel = [
        ChannelBreakdown(channel=ch, **_kpis(*_aggregate(rows)).model_dump())
        for ch, rows in sorted(by_channel_rows.items())
    ]

    per_campaign: dict[uuid.UUID, list] = defaultdict(list)
    for m in metrics:
        per_campaign[m.campaign_id].append(m)
    items = [
        OverviewItem(
            id=str(c.id), name=c.name, **_kpis(*_aggregate(per_campaign.get(c.id, []))).model_dump()
        )
        for c in campaigns
    ]
    items.sort(key=lambda x: x.spend, reverse=True)

    return CampaignOverview(totals=totals, by_channel=by_channel, campaigns=items)


@router.get("/{campaign_id}/breakdown", response_model=CampaignBreakdown)
async def breakdown(
    campaign_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    await _get(db, campaign_id)
    rows = (
        await db.execute(
            select(CampaignMetric).where(CampaignMetric.campaign_id == campaign_id)
        )
    ).scalars().all()

    totals = _kpis(*_aggregate(rows))

    by_ch: dict[str, list] = defaultdict(list)
    for m in rows:
        by_ch[m.channel].append(m)
    by_channel = [
        ChannelBreakdown(channel=ch, **_kpis(*_aggregate(r)).model_dump())
        for ch, r in sorted(by_ch.items())
    ]

    by_date: dict[str, list] = defaultdict(list)
    for m in rows:
        key = m.date.isoformat() if m.date else "—"
        by_date[key].append(m)
    series = []
    for d in sorted(k for k in by_date if k != "—"):
        s, imp, clk, conv, rev = _aggregate(by_date[d])
        series.append(
            {"date": d, "spend": str(_q(s)), "conversions": conv, "clicks": clk}
        )

    return CampaignBreakdown(totals=totals, by_channel=by_channel, series=series)


@router.get("/{campaign_id}/metrics", response_model=list[MetricOut])
async def list_metrics(
    campaign_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    await _get(db, campaign_id)
    return (
        await db.execute(
            select(CampaignMetric)
            .where(CampaignMetric.campaign_id == campaign_id)
            .order_by(CampaignMetric.date.desc())
        )
    ).scalars().all()


@router.post("/{campaign_id}/metrics", response_model=MetricOut, status_code=201)
async def add_metric(
    campaign_id: uuid.UUID,
    payload: MetricCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    await _get(db, campaign_id)
    channel = payload.channel.lower().strip()
    if channel not in CHANNELS:
        channel = "other"
    m = CampaignMetric(campaign_id=campaign_id, **{**payload.model_dump(), "channel": channel})
    db.add(m)
    await db.commit()
    await db.refresh(m)
    return m


def _int(v: str) -> int:
    try:
        return int(float((v or "0").strip() or 0))
    except (ValueError, TypeError):
        return 0


def _dec(v: str) -> Decimal:
    try:
        return Decimal((v or "0").strip() or 0)
    except InvalidOperation:
        return Decimal("0")


def _pdate(v: str):
    v = (v or "").strip()
    if not v:
        return None
    try:
        return date.fromisoformat(v)
    except ValueError:
        return None


@router.post("/{campaign_id}/metrics/import")
async def import_metrics(
    campaign_id: uuid.UUID,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """CSV columns: channel,date,spend,impressions,clicks,conversions,revenue."""
    await _get(db, campaign_id)
    raw = (await file.read()).decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(raw))
    created = 0
    for row in reader:
        channel = (row.get("channel") or "other").lower().strip()
        if channel not in CHANNELS:
            channel = "other"
        db.add(
            CampaignMetric(
                campaign_id=campaign_id,
                channel=channel,
                date=_pdate(row.get("date", "")),
                spend=_dec(row.get("spend", "")),
                impressions=_int(row.get("impressions", "")),
                clicks=_int(row.get("clicks", "")),
                conversions=_int(row.get("conversions", "")),
                revenue=_dec(row.get("revenue", "")),
            )
        )
        created += 1
    await db.commit()
    return {"created": created}


@router.delete("/{campaign_id}/metrics/{metric_id}", status_code=204)
async def delete_metric(
    campaign_id: uuid.UUID,
    metric_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    m = await db.get(CampaignMetric, metric_id)
    if not m or m.campaign_id != campaign_id:
        raise HTTPException(status_code=404, detail="Metric not found")
    await db.delete(m)
    await db.commit()
