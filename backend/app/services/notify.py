"""Create in-app notifications (adds to the session; caller commits).

Email delivery is intentionally handled by the caller (so it can run in a
threadpool after commit) — this module only owns the in-app record + dedup.
"""
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.notification import Notification
from app.models.user import User


async def notify_user(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    title: str,
    body: str | None = None,
    link: str | None = None,
    category: str = "info",
    dedup_key: str | None = None,
) -> Notification | None:
    """Queue an in-app notification. Returns None if deduped."""
    if dedup_key:
        existing = (
            await db.execute(
                select(Notification).where(
                    Notification.user_id == user_id,
                    Notification.dedup_key == dedup_key,
                    Notification.is_read.is_(False),
                )
            )
        ).scalar_one_or_none()
        if existing:
            return None
    n = Notification(
        user_id=user_id,
        title=title,
        body=body,
        link=link,
        category=category,
        dedup_key=dedup_key,
    )
    db.add(n)

    # Best-effort fan-out to external channels when enabled (never breaks the
    # flow). Respects each user's muted categories. Push is gated separately
    # from email/Slack/Teams — see services/push.py for why.
    from app.services.push import push_enabled

    push_on = push_enabled()
    if settings.NOTIFY_OUTBOUND or push_on:
        try:
            target = await db.get(User, user_id)
            muted = (target.notify_muted or []) if target else []
            if category not in muted:
                if settings.NOTIFY_OUTBOUND:
                    from app.services.dispatch import deliver_notification

                    deliver_notification(
                        to_email=target.email if target else None,
                        title=title, body=body, link=link,
                    )
                if push_on:
                    from app.services.push import push_to_user

                    await push_to_user(
                        db, user_id=user_id, title=title, body=body, link=link
                    )
        except Exception:
            pass

    return n
