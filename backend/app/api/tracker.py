import csv
import io
import uuid
from collections import defaultdict
from datetime import date, timedelta
from decimal import Decimal, InvalidOperation

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, Response, StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from app.auth.deps import get_current_user
from app.core.database import get_db
from app.core.urls import public_base_url
from app.models.brand import Brand
from app.models.tracked_asset import (
    AssetAttachment,
    AssetCategory,
    AssetEvent,
    AssetLocation,
    TrackedAsset,
)
from app.models.user import User
from app.schemas.tracker import (
    AssetAttachmentOut,
    AssetEventOut,
    AssetSummary,
    AssignmentSpan,
    BulkAssetAction,
    CheckinRequest,
    CheckoutRequest,
    ConditionRequest,
    MaintenanceRequest,
    NamedItem,
    NamedItemCreate,
    RetireRequest,
    TrackedAssetCreate,
    TrackedAssetOut,
    TrackedAssetUpdate,
)
from app.services.activity import record
from app.services.asset_label import render_label_png, render_labels_pdf
from app.services.email import notification_email_html, send_email
from app.services.notify import notify_user
from app.services.storage import absolute_path, save_upload

router = APIRouter(prefix="/asset-tracker", tags=["asset-tracker"])

STATUSES = {"available", "assigned", "maintenance", "retired"}
CONDITIONS = {"new", "good", "fair", "poor", "damaged"}
ATTACHMENT_KINDS = {"photo", "receipt", "warranty", "document"}

CSV_FIELDS = [
    "asset_tag",
    "name",
    "category",
    "status",
    "location",
    "condition",
    "serial_number",
    "assigned_to_email",
    "brand",
    "vendor",
    "purchase_date",
    "purchase_cost",
    "warranty_expiry",
    "useful_life_years",
    "notes",
]

# One illustrative row for the downloadable migration template.
CSV_SAMPLE = {
    "asset_tag": "AT-0001",
    "name": "MacBook Pro 14\"",
    "category": "Laptop",
    "status": "assigned",
    "location": "HQ - London",
    "condition": "good",
    "serial_number": "C02XL0ABJGH5",
    "assigned_to_email": "person@agholding.net",
    "brand": "",
    "vendor": "Apple",
    "purchase_date": "2024-03-15",
    "purchase_cost": "2400.00",
    "warranty_expiry": "2027-03-15",
    "useful_life_years": "4",
    "notes": "Migrated from old system",
}


def _label_url(asset: TrackedAsset) -> str:
    return f"{public_base_url()}/asset-tracker?q={asset.asset_tag}"


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


async def _names(db: AsyncSession, ids: set[uuid.UUID]) -> dict[uuid.UUID, dict]:
    """Map user ids -> {"name", "title"} (title is the staff job title/position)."""
    ids = {i for i in ids if i}
    if not ids:
        return {}
    rows = (
        await db.execute(
            select(User.id, User.display_name, User.email, User.job_title).where(
                User.id.in_(ids)
            )
        )
    ).all()
    return {r[0]: {"name": (r[1] or r[2]), "title": r[3]} for r in rows}


async def _attachment_counts(
    db: AsyncSession, ids: set[uuid.UUID]
) -> dict[uuid.UUID, int]:
    ids = {i for i in ids if i}
    if not ids:
        return {}
    rows = (
        await db.execute(
            select(AssetAttachment.asset_id, func.count())
            .where(AssetAttachment.asset_id.in_(ids))
            .group_by(AssetAttachment.asset_id)
        )
    ).all()
    return {r[0]: int(r[1]) for r in rows}


def _serialize(
    asset: TrackedAsset,
    names: dict[uuid.UUID, str],
    counts: dict[uuid.UUID, int] | None = None,
) -> TrackedAssetOut:
    out = TrackedAssetOut.model_validate(asset)
    lab = (names.get(asset.assigned_to_id) or {}) if asset.assigned_to_id else {}
    out.assigned_to_name = lab.get("name")
    out.assigned_to_title = lab.get("title")
    out.current_book_value = _book_value(asset)
    out.attachment_count = (counts or {}).get(asset.id, 0)
    return out


async def _ensure_named(db: AsyncSession, model, name: str | None) -> None:
    """Auto-register a category/location so managed lists stay complete."""
    name = (name or "").strip()
    if not name:
        return
    exists = (
        await db.execute(select(model).where(model.name == name))
    ).scalar_one_or_none()
    if exists is None:
        db.add(model(name=name))


@router.get("", response_model=list[TrackedAssetOut])
async def list_assets(
    status: str | None = None,
    category: str | None = None,
    location: str | None = None,
    condition: str | None = None,
    brand_id: uuid.UUID | None = None,
    assigned_to_id: uuid.UUID | None = None,
    q: str | None = None,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    stmt = select(TrackedAsset).order_by(TrackedAsset.created_at.desc())
    if status:
        stmt = stmt.where(TrackedAsset.status == status)
    if category:
        stmt = stmt.where(TrackedAsset.category == category)
    if location:
        stmt = stmt.where(TrackedAsset.location == location)
    if condition:
        stmt = stmt.where(TrackedAsset.condition == condition)
    if brand_id:
        stmt = stmt.where(TrackedAsset.brand_id == brand_id)
    if assigned_to_id:
        stmt = stmt.where(TrackedAsset.assigned_to_id == assigned_to_id)
    if q:
        like = f"%{q}%"
        stmt = stmt.where(
            TrackedAsset.name.ilike(like)
            | TrackedAsset.asset_tag.ilike(like)
            | TrackedAsset.serial_number.ilike(like)
        )
    assets = (await db.execute(stmt)).scalars().all()
    names = await _names(db, {a.assigned_to_id for a in assets})
    counts = await _attachment_counts(db, {a.id for a in assets})
    return [_serialize(a, names, counts) for a in assets]


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
    by_condition: dict[str, int] = defaultdict(int)
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
        by_condition[a.condition or "Unknown"] += 1
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
        "by_condition": dict(by_condition),
        "totals": {
            "count": len(assets),
            "purchase_cost": str(total_cost.quantize(Decimal("0.01"))),
            "book_value": str(total_book.quantize(Decimal("0.01"))),
        },
    }


# ---- Managed categories & locations ----
@router.get("/categories", response_model=list[NamedItem])
async def list_categories(
    db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)
):
    return (
        await db.execute(select(AssetCategory).order_by(AssetCategory.name))
    ).scalars().all()


@router.post("/categories", response_model=NamedItem, status_code=201)
async def create_category(
    payload: NamedItemCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="Name is required")
    existing = (
        await db.execute(select(AssetCategory).where(AssetCategory.name == name))
    ).scalar_one_or_none()
    if existing:
        return existing
    cat = AssetCategory(name=name)
    db.add(cat)
    await db.commit()
    await db.refresh(cat)
    return cat


@router.delete("/categories/{cat_id}", status_code=204)
async def delete_category(
    cat_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    cat = await db.get(AssetCategory, cat_id)
    if cat:
        await db.delete(cat)
        await db.commit()


@router.get("/locations", response_model=list[NamedItem])
async def list_locations(
    db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)
):
    return (
        await db.execute(select(AssetLocation).order_by(AssetLocation.name))
    ).scalars().all()


@router.post("/locations", response_model=NamedItem, status_code=201)
async def create_location(
    payload: NamedItemCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="Name is required")
    existing = (
        await db.execute(select(AssetLocation).where(AssetLocation.name == name))
    ).scalar_one_or_none()
    if existing:
        return existing
    loc = AssetLocation(name=name)
    db.add(loc)
    await db.commit()
    await db.refresh(loc)
    return loc


@router.delete("/locations/{loc_id}", status_code=204)
async def delete_location(
    loc_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    loc = await db.get(AssetLocation, loc_id)
    if loc:
        await db.delete(loc)
        await db.commit()


async def _emails_by_id(db: AsyncSession, ids: set) -> dict:
    ids = {i for i in ids if i}
    if not ids:
        return {}
    rows = (await db.execute(select(User.id, User.email).where(User.id.in_(ids)))).all()
    return {r[0]: r[1] for r in rows}


async def _brand_names_by_id(db: AsyncSession, ids: set) -> dict:
    ids = {i for i in ids if i}
    if not ids:
        return {}
    rows = (await db.execute(select(Brand.id, Brand.name).where(Brand.id.in_(ids)))).all()
    return {r[0]: r[1] for r in rows}


@router.get("/template.csv")
async def template_csv(_: User = Depends(get_current_user)):
    """A header row plus one example row to fill in when migrating."""
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=CSV_FIELDS)
    writer.writeheader()
    writer.writerow(CSV_SAMPLE)
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="assets-template.csv"'},
    )


@router.get("/export.csv")
async def export_csv(
    db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)
):
    assets = (
        await db.execute(select(TrackedAsset).order_by(TrackedAsset.asset_tag))
    ).scalars().all()
    emails = await _emails_by_id(db, {a.assigned_to_id for a in assets})
    brands = await _brand_names_by_id(db, {a.brand_id for a in assets})
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
                "condition": a.condition or "",
                "serial_number": a.serial_number or "",
                "assigned_to_email": emails.get(a.assigned_to_id, ""),
                "brand": brands.get(a.brand_id, ""),
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
    # Resolve assignees / brands by name once for the whole file.
    users = {
        e.lower(): i
        for i, e in (await db.execute(select(User.id, User.email))).all()
    }
    brands = {
        n.lower(): i
        for i, n in (await db.execute(select(Brand.id, Brand.name))).all()
    }
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
        condition = (row.get("condition") or "").strip() or None
        if condition and condition not in CONDITIONS:
            condition = None
        email = (row.get("assigned_to_email") or "").strip().lower()
        assigned_to_id = users.get(email) if email else None
        if email and not assigned_to_id:
            errors.append(f"Row {i}: unknown assignee '{email}' (left unassigned)")
        brand_name = (row.get("brand") or "").strip().lower()
        brand_id = brands.get(brand_name) if brand_name else None
        if assigned_to_id and status == "available":
            status = "assigned"
        values = dict(
            name=name,
            category=(row.get("category") or "").strip() or None,
            status=status,
            location=(row.get("location") or "").strip() or None,
            condition=condition,
            serial_number=(row.get("serial_number") or "").strip() or None,
            assigned_to_id=assigned_to_id,
            brand_id=brand_id,
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
        await _ensure_named(db, AssetCategory, values["category"])
        await _ensure_named(db, AssetLocation, values["location"])
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


@router.post("/bulk")
async def bulk_action(
    payload: BulkAssetAction,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Apply an action to many assets at once."""
    assets = (
        await db.execute(select(TrackedAsset).where(TrackedAsset.id.in_(payload.ids)))
    ).scalars().all()
    affected = 0
    for asset in assets:
        if payload.action == "delete":
            await db.delete(asset)
        elif payload.action == "checkin":
            if asset.assigned_to_id:
                db.add(
                    AssetEvent(
                        asset_id=asset.id,
                        event_type="checkin",
                        user_id=asset.assigned_to_id,
                        performed_by_id=user.id,
                    )
                )
            asset.assigned_to_id = None
            asset.status = "available"
        elif payload.action == "retire":
            asset.status = "retired"
            asset.assigned_to_id = None
            asset.disposal_date = asset.disposal_date or date.today()
            db.add(
                AssetEvent(
                    asset_id=asset.id, event_type="retired", performed_by_id=user.id
                )
            )
        elif payload.action == "set_location":
            asset.location = (payload.value or "").strip() or None
            await _ensure_named(db, AssetLocation, asset.location)
        elif payload.action == "set_category":
            asset.category = (payload.value or "").strip() or None
            await _ensure_named(db, AssetCategory, asset.category)
        else:
            raise HTTPException(status_code=400, detail="Unknown action")
        affected += 1
    record(
        db,
        user=user,
        action="updated",
        entity_type="asset",
        summary=f"Bulk {payload.action} on {affected} asset(s)",
    )
    await db.commit()
    return {"affected": affected}


@router.post("", response_model=TrackedAssetOut, status_code=201)
async def create_asset(
    payload: TrackedAssetCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if payload.status not in STATUSES:
        raise HTTPException(status_code=422, detail="Invalid status")
    if payload.condition and payload.condition not in CONDITIONS:
        raise HTTPException(status_code=422, detail="Invalid condition")
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
    await _ensure_named(db, AssetCategory, asset.category)
    await _ensure_named(db, AssetLocation, asset.location)
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
    counts = await _attachment_counts(db, {asset.id})
    return _serialize(asset, names, counts)


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
    if data.get("condition") and data["condition"] not in CONDITIONS:
        raise HTTPException(status_code=422, detail="Invalid condition")
    for field, value in data.items():
        setattr(asset, field, value)
    await _ensure_named(db, AssetCategory, asset.category)
    await _ensure_named(db, AssetLocation, asset.location)
    await db.commit()
    await db.refresh(asset)
    names = await _names(db, {asset.assigned_to_id})
    counts = await _attachment_counts(db, {asset.id})
    return _serialize(asset, names, counts)


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
        out.user_name = (names.get(e.user_id) or {}).get("name") if e.user_id else None
        out.performed_by_name = (
            (names.get(e.performed_by_id) or {}).get("name") if e.performed_by_id else None
        )
        result.append(out)
    return result


@router.get("/{asset_id}/assignments", response_model=list[AssignmentSpan])
async def assignment_history(
    asset_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Who held the asset and when, derived from checkout/checkin events."""
    await _get(db, asset_id)
    events = (
        await db.execute(
            select(AssetEvent)
            .where(
                AssetEvent.asset_id == asset_id,
                AssetEvent.event_type.in_(["checkout", "checkin"]),
            )
            .order_by(AssetEvent.created_at.asc())
        )
    ).scalars().all()
    names = await _names(db, {e.user_id for e in events})

    spans: list[AssignmentSpan] = []
    open_span: AssignmentSpan | None = None
    for e in events:
        if e.event_type == "checkout":
            open_span = AssignmentSpan(
                user_id=e.user_id,
                user_name=(names.get(e.user_id) or {}).get("name") if e.user_id else None,
                checked_out_at=e.created_at,
                note=e.note,
            )
            spans.append(open_span)
        elif e.event_type == "checkin" and open_span is not None:
            open_span.checked_in_at = e.created_at
            open_span = None
    spans.reverse()
    return spans


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
    if payload.schedule_next_days:
        asset.next_maintenance_date = date.today() + timedelta(
            days=payload.schedule_next_days
        )
        asset.maintenance_interval_days = payload.schedule_next_days
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


@router.post("/{asset_id}/condition", response_model=TrackedAssetOut)
async def set_condition(
    asset_id: uuid.UUID,
    payload: ConditionRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    asset = await _get(db, asset_id)
    if payload.condition not in CONDITIONS:
        raise HTTPException(status_code=422, detail="Invalid condition")
    asset.condition = payload.condition
    db.add(
        AssetEvent(
            asset_id=asset.id,
            event_type="condition",
            note=payload.note or f"Condition set to {payload.condition}",
            performed_by_id=user.id,
        )
    )
    await db.commit()
    await db.refresh(asset)
    names = await _names(db, {asset.assigned_to_id})
    return _serialize(asset, names)


@router.post("/{asset_id}/retire", response_model=TrackedAssetOut)
async def retire_asset(
    asset_id: uuid.UUID,
    payload: RetireRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    asset = await _get(db, asset_id)
    asset.status = "retired"
    asset.assigned_to_id = None
    asset.disposal_date = payload.disposal_date or date.today()
    asset.salvage_value = payload.salvage_value
    asset.disposal_notes = payload.disposal_notes
    db.add(
        AssetEvent(
            asset_id=asset.id,
            event_type="retired",
            note=payload.disposal_notes,
            cost=payload.salvage_value,
            performed_by_id=user.id,
        )
    )
    record(
        db,
        user=user,
        action="updated",
        entity_type="asset",
        entity_id=asset.id,
        summary=f"Retired {asset.asset_tag} — {asset.name}",
    )
    await db.commit()
    await db.refresh(asset)
    return _serialize(asset, {})


# ---- Attachments (photos / receipts / warranty docs) ----
@router.get("/{asset_id}/attachments", response_model=list[AssetAttachmentOut])
async def list_attachments(
    asset_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    await _get(db, asset_id)
    return (
        await db.execute(
            select(AssetAttachment)
            .where(AssetAttachment.asset_id == asset_id)
            .order_by(AssetAttachment.created_at.desc())
        )
    ).scalars().all()


@router.post(
    "/{asset_id}/attachments", response_model=AssetAttachmentOut, status_code=201
)
async def add_attachment(
    asset_id: uuid.UUID,
    file: UploadFile = File(...),
    kind: str = Form("document"),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await _get(db, asset_id)
    rel_path, size = await save_upload(file, subdir="asset-attachments")
    att = AssetAttachment(
        asset_id=asset_id,
        kind=kind if kind in ATTACHMENT_KINDS else "document",
        name=file.filename or rel_path,
        file_path=rel_path,
        content_type=file.content_type,
        size_bytes=size,
        uploaded_by_id=user.id,
    )
    db.add(att)
    await db.commit()
    await db.refresh(att)
    return att


@router.get("/attachments/{att_id}/download")
async def download_attachment(
    att_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    att = await db.get(AssetAttachment, att_id)
    if not att:
        raise HTTPException(status_code=404, detail="Attachment not found")
    return FileResponse(
        absolute_path(att.file_path),
        media_type=att.content_type or "application/octet-stream",
        filename=att.name,
    )


@router.delete("/attachments/{att_id}", status_code=204)
async def delete_attachment(
    att_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    att = await db.get(AssetAttachment, att_id)
    if att:
        await db.delete(att)
        await db.commit()


@router.get("/{asset_id}/label.png")
async def asset_label(
    asset_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    asset = await _get(db, asset_id)
    return Response(content=render_label_png(asset, _label_url(asset)), media_type="image/png")
