import csv
import io
import uuid
from collections import defaultdict
from datetime import date
from decimal import Decimal, InvalidOperation

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import Response, StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from app.auth.deps import get_current_user
from app.core.config import settings
from app.core.database import get_db
from app.models.tracked_asset import AssetEvent, TrackedAsset
from app.models.user import User
from app.services.activity import record
from app.services.asset_label import render_label_png, render_labels_pdf
from app.services.email import notification_email_html, send_email
from app.services.notify import notify_user
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

CSV_FIELDS = [
    "asset_tag",
    "name",
    "category",
    "status",
    "location",
    "serial_number",
    "vendor",
    "purchase_date",
    "purchase_cost",
    "warranty_expiry",
    "useful_life_years",
    "notes",
]


def _label_url(asset: TrackedAsset) -> str:
    return f"{settings.PUBLIC_BASE_URL}/asset-tracker?q={asset.asset_tag}"


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


@router.get("/reports")
async def reports(
    db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)
):
    """Breakdowns by category / status / location with cost & book value."""
    assets = (await db.execute(select(TrackedAsset))).scalars().all()

    def bucket() -> dict:
        return {"count": 0, "purchase_cost": Decimal("0"), "book_value": Decimal("0")}

    by_category: dict[str, dict] = defaultdict(bucket)
    by_status: dict[str, int] = defaultdict(int)
    by_location: dict[str, int] = defaultdict(int)
    total_cost = Decimal("0")
    total_book = Decimal("0")
    for a in assets:
        cat = a.category or "Uncategorised"
        cost = Decimal(a.purchase_cost) if a.purchase_cost is not None else Decimal("0")
        bv = _book_value(a) or Decimal("0")
        by_category[cat]["count"] += 1
        by_category[cat]["purchase_cost"] += cost
        by_category[cat]["book_value"] += bv
        by_status[a.status] += 1
        by_location[a.location or "Unspecified"] += 1
        total_cost += cost
        total_book += bv

    return {
        "by_category": [
            {
                "category": k,
                "count": v["count"],
                "purchase_cost": str(v["purchase_cost"].quantize(Decimal("0.01"))),
                "book_value": str(v["book_value"].quantize(Decimal("0.01"))),
            }
            for k, v in sorted(by_category.items())
        ],
        "by_status": dict(by_status),
        "by_location": [
            {"location": k, "count": v} for k, v in sorted(by_location.items())
        ],
        "totals": {
            "count": len(assets),
            "purchase_cost": str(total_cost.quantize(Decimal("0.01"))),
            "book_value": str(total_book.quantize(Decimal("0.01"))),
        },
    }


@router.get("/export.csv")
async def export_csv(
    db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)
):
    assets = (
        await db.execute(select(TrackedAsset).order_by(TrackedAsset.asset_tag))
    ).scalars().all()
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=CSV_FIELDS)
    writer.writeheader()
    for a in assets:
        writer.writerow(
            {
                "asset_tag": a.asset_tag,
                "name": a.name,
                "category": a.category or "",
                "status": a.status,
                "location": a.location or "",
                "serial_number": a.serial_number or "",
                "vendor": a.vendor or "",
                "purchase_date": a.purchase_date.isoformat() if a.purchase_date else "",
                "purchase_cost": a.purchase_cost if a.purchase_cost is not None else "",
                "warranty_expiry": a.warranty_expiry.isoformat() if a.warranty_expiry else "",
                "useful_life_years": a.useful_life_years if a.useful_life_years is not None else "",
                "notes": a.notes or "",
            }
        )
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="assets.csv"'},
    )


def _parse_date(v: str):
    v = (v or "").strip()
    if not v:
        return None
    try:
        return date.fromisoformat(v)
    except ValueError:
        return None


def _parse_decimal(v: str):
    v = (v or "").strip()
    if not v:
        return None
    try:
        return Decimal(v)
    except InvalidOperation:
        return None


@router.post("/import")
async def import_csv(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Bulk create/update assets from a CSV (matched by asset_tag)."""
    raw = (await file.read()).decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(raw))
    created = updated = 0
    errors: list[str] = []
    for i, row in enumerate(reader, start=2):
        tag = (row.get("asset_tag") or "").strip()
        name = (row.get("name") or "").strip()
        if not tag or not name:
            errors.append(f"Row {i}: asset_tag and name are required")
            continue
        existing = (
            await db.execute(select(TrackedAsset).where(TrackedAsset.asset_tag == tag))
        ).scalar_one_or_none()
        status = (row.get("status") or "available").strip() or "available"
        if status not in STATUSES:
            status = "available"
        values = dict(
            name=name,
            category=(row.get("category") or "").strip() or None,
            status=status,
            location=(row.get("location") or "").strip() or None,
            serial_number=(row.get("serial_number") or "").strip() or None,
            vendor=(row.get("vendor") or "").strip() or None,
            purchase_date=_parse_date(row.get("purchase_date", "")),
            purchase_cost=_parse_decimal(row.get("purchase_cost", "")),
            warranty_expiry=_parse_date(row.get("warranty_expiry", "")),
            useful_life_years=(
                int(row["useful_life_years"])
                if (row.get("useful_life_years") or "").strip().isdigit()
                else None
            ),
            notes=(row.get("notes") or "").strip() or None,
        )
        if existing:
            for k, v in values.items():
                setattr(existing, k, v)
            updated += 1
        else:
            db.add(TrackedAsset(asset_tag=tag, **values))
            created += 1
    record(
        db,
        user=user,
        action="created",
        entity_type="asset",
        summary=f"Imported assets via CSV ({created} new, {updated} updated)",
    )
    await db.commit()
    return {"created": created, "updated": updated, "errors": errors}


@router.get("/labels.pdf")
async def labels_pdf(
    ids: str | None = None,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    stmt = select(TrackedAsset).order_by(TrackedAsset.asset_tag)
    if ids:
        try:
            id_list = [uuid.UUID(x) for x in ids.split(",") if x]
        except ValueError:
            raise HTTPException(status_code=422, detail="Invalid id list")
        stmt = stmt.where(TrackedAsset.id.in_(id_list))
    assets = (await db.execute(stmt)).scalars().all()
    items = [(a, _label_url(a)) for a in assets]
    pdf = render_labels_pdf(items)
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": 'attachment; filename="asset-labels.pdf"'},
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
    await notify_user(
        db,
        user_id=target.id,
        title="An asset was assigned to you",
        body=f"{asset.name} ({asset.asset_tag}) has been checked out to you.",
        link="/asset-tracker",
        category="asset",
    )
    await db.commit()
    await db.refresh(asset)

    # Best-effort email to the assignee (no-op if SMTP isn't configured).
    if target.email:
        await run_in_threadpool(
            send_email,
            target.email,
            "An asset was assigned to you",
            notification_email_html(
                "An asset was assigned to you",
                f"{asset.name} ({asset.asset_tag}) has been checked out to you.",
                None,
            ),
        )

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


@router.get("/{asset_id}/label.png")
async def asset_label(
    asset_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    asset = await _get(db, asset_id)
    return Response(content=render_label_png(asset, _label_url(asset)), media_type="image/png")
