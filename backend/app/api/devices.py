"""Push-device registration for the mobile app and installed PWA.

A device registers the token its push provider handed it; the platform then
sends to that token whenever the user gets a notification. Tokens are owned by
the signed-in user, so re-registering a token that belonged to someone else
(a shared or handed-down phone) moves it rather than leaking notifications to
the previous owner.
"""
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.core.database import get_db
from app.models.device import PushDevice
from app.models.user import User
from app.schemas.device import PushDeviceIn, PushDeviceOut
from app.services.push import push_enabled
from app.services.sessions import normalise_platform

router = APIRouter(prefix="/devices", tags=["devices"])


@router.get("/config")
async def push_config(user: User = Depends(get_current_user)) -> dict:
    """Tells a client whether registering for push is worth doing at all."""
    return {"push_enabled": push_enabled()}


@router.get("", response_model=list[PushDeviceOut])
async def list_devices(
    db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)
):
    return list(
        (
            await db.execute(
                select(PushDevice)
                .where(PushDevice.user_id == user.id, PushDevice.active.is_(True))
                .order_by(PushDevice.created_at.desc())
            )
        ).scalars()
    )


@router.post("", response_model=PushDeviceOut)
async def register_device(
    body: PushDeviceIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Register (or re-register) this device's push token."""
    token = (body.token or "").strip()
    if not token:
        raise HTTPException(status_code=422, detail="A push token is required")

    existing = (
        await db.execute(select(PushDevice).where(PushDevice.token == token))
    ).scalar_one_or_none()

    now = datetime.now(timezone.utc)
    if existing is None:
        existing = PushDevice(user_id=user.id, token=token)
        db.add(existing)
    # Claim the token for whoever is signed in now — the same handset can be
    # handed to another employee, and they must not inherit the old alerts.
    existing.user_id = user.id
    existing.platform = normalise_platform(body.platform)
    existing.device_label = (body.device or None)
    existing.active = True
    existing.last_seen_at = now
    await db.commit()
    await db.refresh(existing)
    return existing


@router.delete("/{device_id}", response_model=dict)
async def unregister_device(
    device_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    row = await db.get(PushDevice, device_id)
    if row is None or row.user_id != user.id:
        raise HTTPException(status_code=404, detail="Device not found")
    row.active = False
    await db.commit()
    return {"ok": True}
