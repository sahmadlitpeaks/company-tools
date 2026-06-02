import uuid
from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.core.database import get_db
from app.models.tracked_asset import AssetEvent, TrackedAsset
from app.models.user import User
from app.services.activity import record
from app.schemas.tracker import (
    AssetEventOut,
    AssetSummary,
    CheckinRequest,
    CheckoutRequest,
    MaintenanceRequest,
    TrackedAssetCreate,
    TrackedAssetOut,
    TrackedAssetUpdate,
)

router = APIRouter(prefix="/asset-tracker", tags=["asset-tracker"])

STATUSES = {"available", "assigned", "maintenance", "retired"}


def _book_value(asset: TrackedAsset) -> Decimal | None:
    """Straight-line depreciated value as of today, floored at zero."""
    if asset.purchase_cost is None or not asset.useful_life_years:
        return None
    cost = Decimal(asset.purchase_cost)
    start = asset.purchase_date or date.today()
    years_elapsed = Decimal((date.today() - start).days) / Decimal("365.25")
    annual = cost / Decimal(asset.useful_life_years)
    value = cost - annual * years_elapsed
    if value < 0:
        value = Decimal("0")
    return value.quantize(Decimal("0.01"))


async def _names(db: AsyncSession, ids: set[uuid.UUID]) -> dict[uuid.UUID, str]:
    ids = {i for i in ids if i}
    if not ids:
        return {}
    rows = (
        await db.execute(select(User.id, User.display_name, User.email).where(User.id.in_(ids)))
    ).all()
    return {r[0]: (r[1] or r[2]) for r in rows}


def _serialize(asset: TrackedAsset, names: dict[uuid.UUID, str]) -> TrackedAssetOut:
    out = TrackedAssetOut.model_validate(asset)
    out.assigned_to_name = names.get(asset.assigned_to_id) if asset.assigned_to_id else None
    out.current_book_value = _book_value(asset)
    return out


@router.get("", response_model=list[TrackedAssetOut])
async def list_assets(
    status: str | None = None,
    category: str | None = None,
    q: str | None = None,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    stmt = select(TrackedAsset).order_by(TrackedAsset.created_at.desc())
    if status:
        stmt = stmt.where(TrackedAsset.status == status)
    if category:
        stmt = stmt.where(TrackedAsset.category == category)
    if q:
        like = f"%{q}%"
        stmt = stmt.where(
            TrackedAsset.name.ilike(like) | TrackedAsset.asset_tag.ilike(like)
        )
    assets = (await db.execute(stmt)).scalars().all()
    names = await _names(db, {a.assigned_to_id for a in assets})
    return [_serialize(a, names) for a in assets]


@router.get("/summary", response_model=AssetSummary)
async def summary(
    db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)
):
    assets = (await db.execute(select(TrackedAsset))).scalars().all()
    by_status: dict[str, int] = {}
    total_cost = Decimal("0")
    total_value = Decimal("0")
    for a in assets:
        by_status[a.status] = by_status.get(a.status, 0) + 1
        if a.purchase_cost is not None:
            total_cost += Decimal(a.purchase_cost)
        bv = _book_value(a)
        if bv is not None:
            total_value += bv
    return AssetSummary(
        total=len(assets),
        by_status=by_status,
        total_purchase_cost=total_cost.quantize(Decimal("0.01")),
        total_book_value=total_value.quantize(Decimal("0.01")),
    )


@router.post("", response_model=TrackedAssetOut, status_code=201)
async def create_asset(
    payload: TrackedAssetCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if payload.status not in STATUSES:
        raise HTTPException(status_code=422, detail="Invalid status")
    existing = (
        await db.execute(
            select(TrackedAsset).where(TrackedAsset.asset_tag == payload.asset_tag)
        )
    ).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=409, detail="Asset tag already exists")
    asset = TrackedAsset(**payload.model_dump())
    if asset.assigned_to_id and asset.status == "available":
        asset.status = "assigned"
    db.add(asset)
    record(
        db,
        user=user,
        action="created",
        entity_type="asset",
        entity_id=asset.id,
        summary=f"Added asset {asset.asset_tag} — {asset.name}",
    )
    await db.commit()
    await db.refresh(asset)
    names = await _names(db, {asset.assigned_to_id})
    return _serialize(asset, names)


async def _get(db: AsyncSession, asset_id: uuid.UUID) -> TrackedAsset:
    asset = await db.get(TrackedAsset, asset_id)
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")
    return asset


@router.get("/{asset_id}", response_model=TrackedAssetOut)
async def get_asset(
    asset_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    asset = await _get(db, asset_id)
    names = await _names(db, {asset.assigned_to_id})
    return _serialize(asset, names)


@router.patch("/{asset_id}", response_model=TrackedAssetOut)
async def update_asset(
    asset_id: uuid.UUID,
    payload: TrackedAssetUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    asset = await _get(db, asset_id)
    data = payload.model_dump(exclude_unset=True)
    if "status" in data and data["status"] not in STATUSES:
        raise HTTPException(status_code=422, detail="Invalid status")
    for field, value in data.items():
        setattr(asset, field, value)
    await db.commit()
    await db.refresh(asset)
    names = await _names(db, {asset.assigned_to_id})
    return _serialize(asset, names)


@router.delete("/{asset_id}", status_code=204)
async def delete_asset(
    asset_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    asset = await _get(db, asset_id)
    await db.delete(asset)
    await db.commit()


# ---- History & actions ----
@router.get("/{asset_id}/events", response_model=list[AssetEventOut])
async def list_events(
    asset_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    await _get(db, asset_id)
    events = (
        await db.execute(
            select(AssetEvent)
            .where(AssetEvent.asset_id == asset_id)
            .order_by(AssetEvent.created_at.desc())
        )
    ).scalars().all()
    names = await _names(
        db, {e.user_id for e in events} | {e.performed_by_id for e in events}
    )
    result = []
    for e in events:
        out = AssetEventOut.model_validate(e)
        out.user_name = names.get(e.user_id) if e.user_id else None
        out.performed_by_name = names.get(e.performed_by_id) if e.performed_by_id else None
        result.append(out)
    return result


@router.post("/{asset_id}/checkout", response_model=TrackedAssetOut)
async def checkout(
    asset_id: uuid.UUID,
    payload: CheckoutRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    asset = await _get(db, asset_id)
    if asset.status == "retired":
        raise HTTPException(status_code=409, detail="Asset is retired")
    target = await db.get(User, payload.user_id)
    if not target:
        raise HTTPException(status_code=404, detail="Assignee not found")
    asset.assigned_to_id = payload.user_id
    asset.status = "assigned"
    db.add(
        AssetEvent(
            asset_id=asset.id,
            event_type="checkout",
            user_id=payload.user_id,
            note=payload.note,
            performed_by_id=user.id,
        )
    )
    record(
        db,
        user=user,
        action="checked_out",
        entity_type="asset",
        entity_id=asset.id,
        summary=f"Checked out {asset.asset_tag} to {target.display_name or target.email}",
    )
    await db.commit()
    await db.refresh(asset)
    names = await _names(db, {asset.assigned_to_id})
    return _serialize(asset, names)


@router.post("/{asset_id}/checkin", response_model=TrackedAssetOut)
async def checkin(
    asset_id: uuid.UUID,
    payload: CheckinRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    asset = await _get(db, asset_id)
    previous = asset.assigned_to_id
    asset.assigned_to_id = None
    asset.status = "available"
    db.add(
        AssetEvent(
            asset_id=asset.id,
            event_type="checkin",
            user_id=previous,
            note=payload.note,
            performed_by_id=user.id,
        )
    )
    record(
        db,
        user=user,
        action="checked_in",
        entity_type="asset",
        entity_id=asset.id,
        summary=f"Checked in {asset.asset_tag} — {asset.name}",
    )
    await db.commit()
    await db.refresh(asset)
    return _serialize(asset, {})


@router.post("/{asset_id}/maintenance", response_model=TrackedAssetOut)
async def log_maintenance(
    asset_id: uuid.UUID,
    payload: MaintenanceRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    asset = await _get(db, asset_id)
    if payload.set_in_maintenance:
        asset.status = "maintenance"
    db.add(
        AssetEvent(
            asset_id=asset.id,
            event_type="maintenance",
            note=payload.note,
            cost=payload.cost,
            performed_by_id=user.id,
        )
    )
    record(
        db,
        user=user,
        action="maintenance",
        entity_type="asset",
        entity_id=asset.id,
        summary=f"Logged maintenance on {asset.asset_tag}: {payload.note}",
    )
    await db.commit()
    await db.refresh(asset)
    names = await _names(db, {asset.assigned_to_id})
    return _serialize(asset, names)
