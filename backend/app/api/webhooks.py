"""Outbound webhook management (admin). Register URLs to receive platform
events, view delivery history, and send a test event."""
import secrets
import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_admin
from app.core.database import get_db
from app.models.user import User
from app.models.webhook import WEBHOOK_EVENTS, Webhook, WebhookDelivery
from app.schemas.webhook import (
    DeliveryOut,
    WebhookCreate,
    WebhookOut,
    WebhookUpdate,
)
from app.services import webhooks as wh

router = APIRouter(prefix="/webhooks", tags=["webhooks"])


def _out(w: Webhook) -> WebhookOut:
    return WebhookOut(
        id=w.id, url=w.url, description=w.description, events=w.events or [],
        active=w.active, has_secret=bool(w.secret), created_at=w.created_at,
    )


def _validate_events(events: list[str]) -> None:
    bad = [e for e in events if e not in WEBHOOK_EVENTS]
    if bad:
        raise HTTPException(status_code=422, detail=f"Unknown events: {', '.join(bad)}")


@router.get("/events")
async def list_events(_: User = Depends(get_current_admin)):
    return {"events": WEBHOOK_EVENTS}


@router.get("", response_model=list[WebhookOut])
async def list_webhooks(
    db: AsyncSession = Depends(get_db), _: User = Depends(get_current_admin)
):
    rows = (await db.execute(select(Webhook).order_by(Webhook.created_at.desc()))).scalars().all()
    return [_out(w) for w in rows]


@router.post("", response_model=dict, status_code=201)
async def create_webhook(
    body: WebhookCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    _validate_events(body.events)
    secret = secrets.token_urlsafe(24)
    w = Webhook(
        url=body.url, description=body.description, events=body.events or None,
        active=body.active, secret=secret,
    )
    db.add(w)
    await db.commit()
    await db.refresh(w)
    # Return the signing secret exactly once.
    return {**_out(w).model_dump(mode="json"), "secret": secret}


@router.patch("/{webhook_id}", response_model=WebhookOut)
async def update_webhook(
    webhook_id: uuid.UUID,
    body: WebhookUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    w = await db.get(Webhook, webhook_id)
    if not w:
        raise HTTPException(status_code=404, detail="Webhook not found")
    data = body.model_dump(exclude_unset=True)
    if "events" in data and data["events"] is not None:
        _validate_events(data["events"])
        w.events = data.pop("events") or None
    for k, v in data.items():
        setattr(w, k, v)
    await db.commit()
    await db.refresh(w)
    return _out(w)


@router.delete("/{webhook_id}", status_code=204)
async def delete_webhook(
    webhook_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    w = await db.get(Webhook, webhook_id)
    if w:
        await db.delete(w)
        await db.commit()


@router.get("/{webhook_id}/deliveries", response_model=list[DeliveryOut])
async def list_deliveries(
    webhook_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    rows = (
        await db.execute(
            select(WebhookDelivery)
            .where(WebhookDelivery.webhook_id == webhook_id)
            .order_by(WebhookDelivery.created_at.desc())
            .limit(50)
        )
    ).scalars().all()
    return list(rows)


@router.post("/{webhook_id}/test")
async def test_webhook(
    webhook_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(get_current_admin),
):
    w = await db.get(Webhook, webhook_id)
    if not w:
        raise HTTPException(status_code=404, detail="Webhook not found")
    # Temporarily target just this hook by emitting a test event it subscribes to,
    # but emit() fans to all — instead deliver directly to this one for clarity.
    import hashlib
    import hmac
    import json

    body_dict = {"event": "test.ping", "data": {"by": admin.email}}
    body = json.dumps(body_dict, default=str).encode()
    sig = hmac.new(w.secret.encode(), body, hashlib.sha256).hexdigest() if w.secret else None
    import anyio

    status, error = await anyio.to_thread.run_sync(wh._post, w.url, body, sig)
    db.add(WebhookDelivery(
        webhook_id=w.id, event="test.ping", payload=body_dict,
        status_code=status, success=bool(status and 200 <= status < 300), error=error,
    ))
    await db.commit()
    return {"status_code": status, "success": bool(status and 200 <= status < 300), "error": error}
