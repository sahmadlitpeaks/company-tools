"""Company SaaS / tool subscriptions with billing details and seat assignment."""
import csv
import io
import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth.deps import get_current_user
from app.core.database import get_db
from app.models.company import Company
from app.models.department import Department
from app.models.subscription import (
    BILLING_CYCLES,
    COST_TYPES,
    SCOPES,
    STATUSES,
    Subscription,
    SubscriptionSeat,
)
from app.models.user import User
from app.schemas.subscription import (
    SeatAssign,
    SeatOut,
    SpendBucket,
    SubscriptionCreate,
    SubscriptionOut,
    SubscriptionReport,
    SubscriptionSummary,
    SubscriptionUpdate,
)
from app.services.activity import record
from app.services.notify import notify_user
from app.services.people import user_labels
from app.services.subscriptions import monthly_cost

router = APIRouter(prefix="/subscriptions", tags=["subscriptions"])

# CSV migration columns. Subscriptions are matched on `name` (case-insensitive),
# so re-importing updates an existing record. `assigned_emails` is a
# semicolon-separated list used to seat people on person-scoped subscriptions.
CSV_FIELDS = [
    "name",
    "vendor",
    "plan",
    "status",
    "scope",
    "department",
    "cost_type",
    "cost",
    "currency",
    "billing_cycle",
    "start_date",
    "end_date",
    "auto_renew",
    "owner_email",
    "assigned_emails",
    "url",
    "notes",
]

CSV_SAMPLE = {
    "name": "ChatGPT Team",
    "vendor": "OpenAI",
    "plan": "Team",
    "status": "active",
    "scope": "person",
    "department": "",
    "cost_type": "per_seat",
    "cost": "25.00",
    "currency": "USD",
    "billing_cycle": "monthly",
    "start_date": "2025-01-01",
    "end_date": "2026-01-01",
    "auto_renew": "true",
    "owner_email": "owner@agholding.net",
    "assigned_emails": "alice@agholding.net;bob@agholding.net",
    "url": "https://chatgpt.com",
    "notes": "Migrated from spreadsheet",
}


def _validate(data: dict) -> None:
    if "scope" in data and data["scope"] not in SCOPES:
        raise HTTPException(status_code=422, detail="Invalid scope")
    if "status" in data and data["status"] not in STATUSES:
        raise HTTPException(status_code=422, detail="Invalid status")
    if "billing_cycle" in data and data["billing_cycle"] not in BILLING_CYCLES:
        raise HTTPException(status_code=422, detail="Invalid billing cycle")
    if "cost_type" in data and data["cost_type"] not in COST_TYPES:
        raise HTTPException(status_code=422, detail="Invalid cost type")


async def _serialize(
    db: AsyncSession, sub: Subscription, labels: dict | None = None
) -> SubscriptionOut:
    out = SubscriptionOut.model_validate(sub)
    active = [s for s in sub.seats if s.status == "active"]
    out.active_seats = len(active)
    out.monthly_cost = monthly_cost(sub, len(active))
    if labels is None:
        ids = {s.user_id for s in sub.seats} | {sub.owner_id}
        labels = await user_labels(db, ids)
    out.owner_name = (labels.get(sub.owner_id) or {}).get("name") if sub.owner_id else None
    if sub.department_id:
        dept = await db.get(Department, sub.department_id)
        out.department_name = dept.name if dept else None
    out.seats = []
    for s in sub.seats:
        so = SeatOut.model_validate(s)
        lab = labels.get(s.user_id) or {}
        so.user_name = lab.get("name")
        so.user_title = lab.get("title")
        out.seats.append(so)
    return out


async def _get(db: AsyncSession, sub_id: uuid.UUID) -> Subscription:
    # Use a fresh SELECT (not db.get) so columns + seats are eagerly loaded and
    # never lazy-load synchronously during serialization (post-commit expiry).
    sub = (
        await db.execute(
            select(Subscription)
            .options(selectinload(Subscription.seats))
            .where(Subscription.id == sub_id)
            .execution_options(populate_existing=True)
        )
    ).scalar_one_or_none()
    if not sub:
        raise HTTPException(status_code=404, detail="Subscription not found")
    return sub


@router.get("", response_model=list[SubscriptionOut])
async def list_subscriptions(
    status: str | None = None,
    scope: str | None = None,
    department_id: uuid.UUID | None = None,
    user_id: uuid.UUID | None = None,
    q: str | None = None,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    stmt = (
        select(Subscription)
        .options(selectinload(Subscription.seats))
        .order_by(Subscription.name)
    )
    if status:
        stmt = stmt.where(Subscription.status == status)
    if scope:
        stmt = stmt.where(Subscription.scope == scope)
    if department_id:
        stmt = stmt.where(Subscription.department_id == department_id)
    if q:
        like = f"%{q}%"
        stmt = stmt.where(
            Subscription.name.ilike(like) | Subscription.vendor.ilike(like)
        )
    subs = (await db.execute(stmt)).scalars().unique().all()
    if user_id:
        subs = [s for s in subs if any(seat.user_id == user_id for seat in s.seats)]
    ids: set = set()
    for s in subs:
        ids |= {seat.user_id for seat in s.seats} | {s.owner_id}
    labels = await user_labels(db, ids)
    return [await _serialize(db, s, labels) for s in subs]


@router.get("/summary", response_model=SubscriptionSummary)
async def summary(
    db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)
):
    subs = (
        await db.execute(
            select(Subscription).options(selectinload(Subscription.seats))
        )
    ).scalars().unique().all()
    by_status: dict[str, int] = {}
    spend = Decimal("0")
    soon = 0
    horizon = date.today() + timedelta(days=30)
    for s in subs:
        by_status[s.status] = by_status.get(s.status, 0) + 1
        if s.status in ("active", "trial"):
            mc = monthly_cost(s, len([x for x in s.seats if x.status == "active"]))
            if mc:
                spend += mc
        if s.end_date and date.today() <= s.end_date <= horizon and s.status == "active":
            soon += 1
    return SubscriptionSummary(
        total=len(subs), by_status=by_status, monthly_spend=spend, renewing_soon=soon
    )


@router.get("/report", response_model=SubscriptionReport)
async def spend_report(
    db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)
):
    """Spend rollups by department, vendor and billing cycle for budgeting.

    Person/company subscriptions with no department are attributed to the
    owner's department where known, otherwise to "Company-wide"."""
    subs = (
        await db.execute(
            select(Subscription).options(selectinload(Subscription.seats))
        )
    ).scalars().unique().all()

    dept_ids = {s.department_id for s in subs if s.department_id}
    owner_ids = {s.owner_id for s in subs if s.owner_id}
    dept_names = await _dept_names_by_id(db, dept_ids)
    owner_depts: dict = {}
    if owner_ids:
        rows = (
            await db.execute(
                select(User.id, User.department_id).where(User.id.in_(owner_ids))
            )
        ).all()
        owner_depts = {r[0]: r[1] for r in rows}
        dept_names |= await _dept_names_by_id(db, {d for d in owner_depts.values() if d})

    by_dept: dict[str, list] = {}
    by_vendor: dict[str, list] = {}
    by_cycle: dict[str, list] = {}
    tops: list[SpendBucket] = []
    total = Decimal("0")
    seats_total = 0

    for s in subs:
        if s.status not in ("active", "trial"):
            continue
        active = len([x for x in s.seats if x.status == "active"])
        seats_total += active
        mc = monthly_cost(s, active) or Decimal("0")
        total += mc

        if s.department_id:
            dlabel = dept_names.get(s.department_id, "Unknown")
        elif s.owner_id and owner_depts.get(s.owner_id):
            dlabel = dept_names.get(owner_depts[s.owner_id], "Unknown")
        else:
            dlabel = "Company-wide"
        for bucket, key in ((by_dept, dlabel), (by_vendor, s.vendor or "—"), (by_cycle, s.billing_cycle)):
            agg = bucket.setdefault(key, [Decimal("0"), 0])
            agg[0] += mc
            agg[1] += 1
        tops.append(SpendBucket(label=s.name, monthly=mc, count=active))

    def _sorted(d: dict) -> list[SpendBucket]:
        return [
            SpendBucket(label=k, monthly=v[0], count=v[1])
            for k, v in sorted(d.items(), key=lambda kv: kv[1][0], reverse=True)
        ]

    tops.sort(key=lambda b: b.monthly, reverse=True)
    return SubscriptionReport(
        monthly_total=total,
        annual_total=(total * 12).quantize(Decimal("0.01")),
        active_seats=seats_total,
        by_department=_sorted(by_dept),
        by_vendor=_sorted(by_vendor),
        by_billing_cycle=_sorted(by_cycle),
        top=tops[:10],
    )


@router.get("/renewals", response_model=list[SubscriptionOut])
async def renewals(
    days: int = 30,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Active subscriptions with an end/renewal date inside the window."""
    horizon = date.today() + timedelta(days=max(days, 0))
    subs = (
        await db.execute(
            select(Subscription)
            .options(selectinload(Subscription.seats))
            .where(
                Subscription.status == "active",
                Subscription.end_date.is_not(None),
                Subscription.end_date <= horizon,
            )
            .order_by(Subscription.end_date)
        )
    ).scalars().unique().all()
    ids: set = set()
    for s in subs:
        ids |= {seat.user_id for seat in s.seats} | {s.owner_id}
    labels = await user_labels(db, ids)
    return [await _serialize(db, s, labels) for s in subs]


@router.post("/renewals/notify")
async def notify_renewals(
    days: int = 30,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Send each subscription owner an in-app reminder about an upcoming
    renewal. Deduplicated per subscription + renewal date so repeat clicks
    don't spam. Falls back to the actor when a sub has no owner."""
    horizon = date.today() + timedelta(days=max(days, 0))
    subs = (
        await db.execute(
            select(Subscription).where(
                Subscription.status == "active",
                Subscription.end_date.is_not(None),
                Subscription.end_date <= horizon,
            )
        )
    ).scalars().all()
    sent = 0
    for s in subs:
        recipient = s.owner_id or user.id
        n = await notify_user(
            db,
            user_id=recipient,
            title=f"Subscription renewing: {s.name}",
            body=f"{s.name} renews/ends on {s.end_date.isoformat()}.",
            link="/subscriptions",
            category="warning",
            dedup_key=f"sub-renewal:{s.id}:{s.end_date.isoformat()}",
        )
        if n:
            sent += 1
    await db.commit()
    return {"reminders_sent": sent, "candidates": len(subs)}


def _parse_date(v: str | None):
    v = (v or "").strip()
    if not v:
        return None
    try:
        return date.fromisoformat(v)
    except ValueError:
        return None


def _parse_decimal(v: str | None):
    v = (v or "").strip()
    if not v:
        return None
    try:
        return Decimal(v)
    except InvalidOperation:
        return None


def _csv_response(rows: list[dict], filename: str) -> StreamingResponse:
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=CSV_FIELDS)
    writer.writeheader()
    writer.writerows(rows)
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/template.csv")
async def template_csv(_: User = Depends(get_current_user)):
    return _csv_response([CSV_SAMPLE], "subscriptions-template.csv")


@router.get("/export.csv")
async def export_csv(
    db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)
):
    subs = (
        await db.execute(
            select(Subscription).options(selectinload(Subscription.seats)).order_by(Subscription.name)
        )
    ).scalars().unique().all()
    user_ids: set = set()
    dept_ids: set = set()
    for s in subs:
        user_ids |= {seat.user_id for seat in s.seats} | {s.owner_id}
        dept_ids.add(s.department_id)
    emails = await _emails_by_id(db, user_ids)
    depts = await _dept_names_by_id(db, dept_ids)
    rows = []
    for s in subs:
        seat_emails = [
            emails.get(seat.user_id, "")
            for seat in s.seats
            if seat.status == "active" and emails.get(seat.user_id)
        ]
        rows.append({
            "name": s.name,
            "vendor": s.vendor or "",
            "plan": s.plan or "",
            "status": s.status,
            "scope": s.scope,
            "department": depts.get(s.department_id, ""),
            "cost_type": s.cost_type,
            "cost": s.cost if s.cost is not None else "",
            "currency": s.currency,
            "billing_cycle": s.billing_cycle,
            "start_date": s.start_date.isoformat() if s.start_date else "",
            "end_date": s.end_date.isoformat() if s.end_date else "",
            "auto_renew": "true" if s.auto_renew else "false",
            "owner_email": emails.get(s.owner_id, ""),
            "assigned_emails": ";".join(seat_emails),
            "url": s.url or "",
            "notes": s.notes or "",
        })
    return _csv_response(rows, "subscriptions.csv")


async def _emails_by_id(db: AsyncSession, ids: set) -> dict:
    ids = {i for i in ids if i}
    if not ids:
        return {}
    rows = (await db.execute(select(User.id, User.email).where(User.id.in_(ids)))).all()
    return {r[0]: r[1] for r in rows}


async def _dept_names_by_id(db: AsyncSession, ids: set) -> dict:
    ids = {i for i in ids if i}
    if not ids:
        return {}
    rows = (
        await db.execute(select(Department.id, Department.name).where(Department.id.in_(ids)))
    ).all()
    return {r[0]: r[1] for r in rows}


@router.post("/import")
async def import_csv(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Bulk create/update subscriptions from a CSV (matched by name).

    Lets admins migrate an existing SaaS spreadsheet in one go. Unknown
    owners/departments are skipped (the row still imports); listed
    `assigned_emails` are seated on person-scoped subscriptions.
    """
    raw = (await file.read()).decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(raw))
    users = {
        e.lower(): i for i, e in (await db.execute(select(User.id, User.email))).all() if e
    }
    depts = {
        n.lower(): i for i, n in (await db.execute(select(Department.id, Department.name))).all()
    }
    created = updated = 0
    errors: list[str] = []
    for i, row in enumerate(reader, start=2):
        name = (row.get("name") or "").strip()
        if not name:
            errors.append(f"Row {i}: name is required")
            continue
        scope = (row.get("scope") or "person").strip().lower()
        if scope not in SCOPES:
            scope = "person"
        status = (row.get("status") or "active").strip().lower()
        if status not in STATUSES:
            status = "active"
        cost_type = (row.get("cost_type") or "flat").strip().lower()
        if cost_type not in COST_TYPES:
            cost_type = "flat"
        cycle = (row.get("billing_cycle") or "monthly").strip().lower()
        if cycle not in BILLING_CYCLES:
            cycle = "monthly"
        dept_name = (row.get("department") or "").strip().lower()
        dept_id = depts.get(dept_name) if dept_name else None
        owner_email = (row.get("owner_email") or "").strip().lower()
        owner_id = users.get(owner_email) if owner_email else None
        if owner_email and not owner_id:
            errors.append(f"Row {i}: unknown owner '{owner_email}'")
        auto = (row.get("auto_renew") or "true").strip().lower()
        values = dict(
            vendor=(row.get("vendor") or "").strip() or None,
            plan=(row.get("plan") or "").strip() or None,
            url=(row.get("url") or "").strip() or None,
            status=status,
            scope=scope,
            department_id=dept_id if scope == "department" else None,
            cost_type=cost_type,
            cost=_parse_decimal(row.get("cost")),
            currency=(row.get("currency") or "USD").strip() or "USD",
            billing_cycle=cycle,
            start_date=_parse_date(row.get("start_date")),
            end_date=_parse_date(row.get("end_date")),
            auto_renew=auto not in ("false", "0", "no", "n"),
            owner_id=owner_id,
            notes=(row.get("notes") or "").strip() or None,
        )
        existing = (
            await db.execute(select(Subscription).where(func.lower(Subscription.name) == name.lower()))
        ).scalars().first()
        if existing:
            for k, v in values.items():
                setattr(existing, k, v)
            sub = existing
            updated += 1
        else:
            sub = Subscription(name=name, **values)
            db.add(sub)
            await db.flush()
            created += 1
        # Seat the listed people (person scope only).
        if scope == "person":
            seat_emails = [
                e.strip().lower()
                for e in (row.get("assigned_emails") or "").replace(",", ";").split(";")
                if e.strip()
            ]
            existing_seats = {
                s.user_id: s
                for s in (
                    await db.execute(
                        select(SubscriptionSeat).where(SubscriptionSeat.subscription_id == sub.id)
                    )
                ).scalars().all()
            }
            for e in seat_emails:
                uid = users.get(e)
                if not uid:
                    errors.append(f"Row {i}: unknown seat '{e}'")
                    continue
                seat = existing_seats.get(uid)
                if seat:
                    seat.status = "active"
                    seat.revoked_at = None
                else:
                    db.add(SubscriptionSeat(subscription_id=sub.id, user_id=uid))
    record(
        db, user=user, action="created", entity_type="subscription",
        summary=f"Imported subscriptions via CSV ({created} new, {updated} updated)",
    )
    await db.commit()
    return {"created": created, "updated": updated, "errors": errors}


@router.post("", response_model=SubscriptionOut, status_code=201)
async def create_subscription(
    payload: SubscriptionCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    data = payload.model_dump(exclude={"user_ids"})
    _validate(data)
    if not (payload.name or "").strip():
        raise HTTPException(status_code=422, detail="Name is required")
    if payload.company_id and not await db.get(Company, payload.company_id):
        raise HTTPException(status_code=404, detail="Company not found")
    if payload.department_id and not await db.get(Department, payload.department_id):
        raise HTTPException(status_code=404, detail="Department not found")
    sub = Subscription(**data)
    db.add(sub)
    await db.flush()
    for uid in dict.fromkeys(payload.user_ids):  # de-dupe, keep order
        db.add(SubscriptionSeat(subscription_id=sub.id, user_id=uid))
    record(
        db, user=user, action="created", entity_type="subscription", entity_id=sub.id,
        summary=f"Added subscription {sub.name}",
    )
    await db.commit()
    sub = await _get(db, sub.id)
    return await _serialize(db, sub)


@router.get("/{sub_id}", response_model=SubscriptionOut)
async def get_subscription(
    sub_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    return await _serialize(db, await _get(db, sub_id))


@router.patch("/{sub_id}", response_model=SubscriptionOut)
async def update_subscription(
    sub_id: uuid.UUID,
    payload: SubscriptionUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    sub = await _get(db, sub_id)
    data = payload.model_dump(exclude_unset=True)
    _validate(data)
    for field, value in data.items():
        setattr(sub, field, value)
    record(
        db, user=user, action="updated", entity_type="subscription", entity_id=sub.id,
        summary=f"Updated subscription {sub.name}",
    )
    await db.commit()
    return await _serialize(db, await _get(db, sub_id))


@router.delete("/{sub_id}", status_code=204)
async def delete_subscription(
    sub_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    sub = await db.get(Subscription, sub_id)
    if sub:
        await db.delete(sub)
        await db.commit()


@router.post("/{sub_id}/seats", response_model=SubscriptionOut)
async def assign_seats(
    sub_id: uuid.UUID,
    payload: SeatAssign,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    sub = await _get(db, sub_id)
    existing = {s.user_id: s for s in sub.seats}
    for uid in dict.fromkeys(payload.user_ids):
        seat = existing.get(uid)
        if seat:
            # Re-activate a previously revoked seat.
            seat.status = "active"
            seat.revoked_at = None
            seat.revoked_by_id = None
        else:
            if not await db.get(User, uid):
                continue
            db.add(SubscriptionSeat(subscription_id=sub.id, user_id=uid))
    record(
        db, user=user, action="updated", entity_type="subscription", entity_id=sub.id,
        summary=f"Assigned seats on {sub.name}",
    )
    await db.commit()
    return await _serialize(db, await _get(db, sub_id))


@router.post("/seats/{seat_id}/revoke", response_model=SeatOut)
async def revoke_seat(
    seat_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    seat = await db.get(SubscriptionSeat, seat_id)
    if not seat:
        raise HTTPException(status_code=404, detail="Seat not found")
    seat.status = "revoked"
    seat.revoked_at = datetime.now(timezone.utc)
    seat.revoked_by_id = user.id
    sub = await db.get(Subscription, seat.subscription_id)
    record(
        db, user=user, action="updated", entity_type="subscription",
        entity_id=seat.subscription_id,
        summary=f"Revoked a seat on {sub.name if sub else 'subscription'}",
    )
    await db.commit()
    await db.refresh(seat)
    labels = await user_labels(db, {seat.user_id})
    out = SeatOut.model_validate(seat)
    lab = labels.get(seat.user_id) or {}
    out.user_name = lab.get("name")
    out.user_title = lab.get("title")
    return out


@router.delete("/seats/{seat_id}", status_code=204)
async def remove_seat(
    seat_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    seat = await db.get(SubscriptionSeat, seat_id)
    if seat:
        await db.delete(seat)
        await db.commit()
