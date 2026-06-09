"""Company SaaS / tool subscriptions with billing details and seat assignment."""
import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth.deps import get_current_user
from app.core.database import get_db
from app.models.brand import Brand
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
    SubscriptionCreate,
    SubscriptionOut,
    SubscriptionSummary,
    SubscriptionUpdate,
)
from app.services.activity import record
from app.services.people import user_labels
from app.services.subscriptions import monthly_cost

router = APIRouter(prefix="/subscriptions", tags=["subscriptions"])


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
    if payload.brand_id and not await db.get(Brand, payload.brand_id):
        raise HTTPException(status_code=404, detail="Brand not found")
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
