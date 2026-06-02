import uuid
from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.core.database import get_db
from app.models.notification import Notification
from app.models.tracked_asset import TrackedAsset
from app.models.user import User
from app.services.notify import notify_user

router = APIRouter(prefix="/notifications", tags=["notifications"])

WARRANTY_SOON_DAYS = 30


class NotificationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title: str
    body: str | None = None
    link: str | None = None
    category: str
    is_read: bool
    created_at: object


@router.get("", response_model=list[NotificationOut])
async def my_notifications(
    db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)
):
    return (
        await db.execute(
            select(Notification)
            .where(Notification.user_id == user.id)
            .order_by(Notification.created_at.desc())
            .limit(50)
        )
    ).scalars().all()


@router.get("/unread-count")
async def unread_count(
    db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)
):
    count = (
        await db.execute(
            select(func.count())
            .select_from(Notification)
            .where(Notification.user_id == user.id, Notification.is_read.is_(False))
        )
    ).scalar_one()
    return {"count": int(count)}


@router.post("/{notification_id}/read", status_code=204)
async def mark_read(
    notification_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    n = await db.get(Notification, notification_id)
    if not n or n.user_id != user.id:
        raise HTTPException(status_code=404, detail="Not found")
    n.is_read = True
    await db.commit()


@router.post("/read-all", status_code=204)
async def mark_all_read(
    db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)
):
    await db.execute(
        update(Notification)
        .where(Notification.user_id == user.id, Notification.is_read.is_(False))
        .values(is_read=True)
    )
    await db.commit()


@router.post("/check-warranties")
async def check_warranties(
    db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)
):
    """Generate warranty-expiry notifications for admins (idempotent via dedup)."""
    today = date.today()
    soon = today + timedelta(days=WARRANTY_SOON_DAYS)
    assets = (
        await db.execute(
            select(TrackedAsset).where(
                TrackedAsset.warranty_expiry.is_not(None),
                TrackedAsset.warranty_expiry >= today,
                TrackedAsset.warranty_expiry <= soon,
            )
        )
    ).scalars().all()
    if not assets:
        return {"created": 0}

    admins = (
        await db.execute(select(User).where(User.is_admin.is_(True)))
    ).scalars().all()
    created = 0
    for asset in assets:
        days = (asset.warranty_expiry - today).days
        for admin in admins:
            n = await notify_user(
                db,
                user_id=admin.id,
                title="Warranty expiring soon",
                body=f"{asset.name} ({asset.asset_tag}) warranty expires in {days} day(s).",
                link="/asset-tracker",
                category="warranty",
                dedup_key=f"warranty:{asset.id}",
            )
            if n is not None:
                created += 1
    await db.commit()
    return {"created": created}
