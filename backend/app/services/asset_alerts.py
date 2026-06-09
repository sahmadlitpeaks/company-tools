"""Generate asset alerts (warranty expiry + preventive-maintenance due) as
admin notifications. Shared by the manual endpoint and the background scheduler.
Idempotent via per-asset dedup keys.
"""
from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.tracked_asset import TrackedAsset
from app.models.user import User
from app.services.notify import notify_user

WARRANTY_SOON_DAYS = 30
MAINTENANCE_SOON_DAYS = 7


async def run_asset_alerts(db: AsyncSession) -> dict:
    today = date.today()
    admins = (
        await db.execute(select(User).where(User.is_admin.is_(True)))
    ).scalars().all()
    if not admins:
        return {"created": 0}
    created = 0

    # --- Warranties expiring within the window ---
    warranty_window = today + timedelta(days=WARRANTY_SOON_DAYS)
    warranties = (
        await db.execute(
            select(TrackedAsset).where(
                TrackedAsset.warranty_expiry.is_not(None),
                TrackedAsset.warranty_expiry >= today,
                TrackedAsset.warranty_expiry <= warranty_window,
            )
        )
    ).scalars().all()
    for asset in warranties:
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
            created += 1 if n is not None else 0

    # --- Preventive maintenance due / overdue ---
    maint_window = today + timedelta(days=MAINTENANCE_SOON_DAYS)
    due = (
        await db.execute(
            select(TrackedAsset).where(
                TrackedAsset.next_maintenance_date.is_not(None),
                TrackedAsset.next_maintenance_date <= maint_window,
                TrackedAsset.status != "retired",
            )
        )
    ).scalars().all()
    for asset in due:
        when = asset.next_maintenance_date
        overdue = when < today
        for admin in admins:
            n = await notify_user(
                db,
                user_id=admin.id,
                title="Maintenance overdue" if overdue else "Maintenance due soon",
                body=f"{asset.name} ({asset.asset_tag}) is scheduled for service on {when.isoformat()}.",
                link="/asset-tracker",
                category="maintenance",
                dedup_key=f"maint:{asset.id}:{when.isoformat()}",
            )
            created += 1 if n is not None else 0

    await db.commit()
    return {"created": created}
