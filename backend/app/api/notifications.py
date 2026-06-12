import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.core.database import get_db
from app.models.notification import Notification
from app.models.user import User
from app.services.asset_alerts import run_asset_alerts
from app.services.notify import notify_user

router = APIRouter(prefix="/notifications", tags=["notifications"])


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
    """Run warranty + maintenance alerts now (also runs automatically)."""
    return await run_asset_alerts(db)


@router.get("/channels")
async def channel_status(_: User = Depends(get_current_user)):
    """Which outbound notification channels are configured/enabled."""
    from app.core.config import settings
    from app.services.dispatch import email_enabled, slack_enabled, teams_enabled

    return {
        "outbound_enabled": settings.NOTIFY_OUTBOUND,
        "email_configured": email_enabled(),
        "slack_configured": slack_enabled(),
        "teams_configured": teams_enabled(),
    }


# Categories users can mute for outbound channels (in-app always delivered).
NOTIFY_CATEGORIES = [
    "approval", "kudos", "performance", "info", "ticket", "task", "leave",
]


@router.get("/preferences")
async def get_preferences(user: User = Depends(get_current_user)):
    return {"categories": NOTIFY_CATEGORIES, "muted": user.notify_muted or []}


class PreferencesIn(BaseModel):
    muted: list[str]


@router.put("/preferences")
async def set_preferences(
    body: PreferencesIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    user.notify_muted = [c for c in body.muted if c in NOTIFY_CATEGORIES]
    await db.commit()
    return {"muted": user.notify_muted}


@router.post("/test")
async def test_outbound(
    db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)
):
    """Send a test notification to the current user across configured channels."""
    from app.services.dispatch import deliver_notification

    await notify_user(
        db, user_id=user.id,
        title="Test notification",
        body="This is a test of the in-app notification channel.",
        link="/",
        category="info",
    )
    await db.commit()
    attempted = deliver_notification(
        to_email=user.email,
        title="Test notification",
        body="This confirms outbound email/Slack delivery is working.",
        link="/",
    )
    return {"in_app": True, "external_channels": attempted}
