import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth.deps import get_current_user
from app.core.database import get_db
from app.core.permissions import resolve_permissions
from app.models.brand import Brand
from app.models.people import (
    DEFAULT_OFFBOARDING,
    DEFAULT_ONBOARDING,
    AccessGrant,
    OnboardingJourney,
    OnboardingTask,
)
from app.models.tracked_asset import AssetEvent, TrackedAsset
from app.models.user import User
from app.models.workplace import Announcement
from app.schemas.people import (
    AccessAction,
    AccessGrantCreate,
    AccessGrantOut,
    AssignAssetIn,
    AssignedAsset,
    JourneyCreate,
    JourneyDetail,
    JourneyOut,
    JourneyTaskOut,
    TargetAccess,
    TaskCreate,
    TaskUpdate,
)
from app.services.activity import record
from app.services.notify import notify_user
from app.services.onboarding_pdf import render_journey_report
from app.services.people import user_names

router = APIRouter(prefix="/people", tags=["people-ops"])

KINDS = {"onboarding", "offboarding"}
TASK_STATUSES = {"pending", "done", "na"}


def _task_out(t: OnboardingTask, names: dict) -> JourneyTaskOut:
    o = JourneyTaskOut.model_validate(t)
    o.owner_name = names.get(t.owner_id) if t.owner_id else None
    o.done_by_name = names.get(t.done_by_id) if t.done_by_id else None
    return o


def _journey_out(j: OnboardingJourney, names: dict, brands: dict | None = None) -> JourneyOut:
    o = JourneyOut.model_validate(j)
    o.target_name = names.get(j.target_user_id) if j.target_user_id else None
    o.created_by_name = names.get(j.created_by_id) if j.created_by_id else None
    o.brand_name = (brands or {}).get(j.brand_id) if j.brand_id else None
    tasks = j.__dict__.get("tasks") or []
    o.total_tasks = len(tasks)
    o.done_tasks = sum(1 for t in tasks if t.status == "done")
    return o


async def _brand_names(db: AsyncSession, ids: set) -> dict:
    ids = {i for i in ids if i}
    if not ids:
        return {}
    rows = (await db.execute(select(Brand.id, Brand.name).where(Brand.id.in_(ids)))).all()
    return {r[0]: r[1] for r in rows}


@router.get("/journeys", response_model=list[JourneyOut])
async def list_journeys(
    kind: str | None = None,
    status: str | None = None,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    stmt = (
        select(OnboardingJourney)
        .options(selectinload(OnboardingJourney.tasks))
        .order_by(OnboardingJourney.created_at.desc())
    )
    if kind:
        stmt = stmt.where(OnboardingJourney.kind == kind)
    if status:
        stmt = stmt.where(OnboardingJourney.status == status)
    journeys = (await db.execute(stmt)).scalars().all()
    names = await user_names(
        db,
        {j.target_user_id for j in journeys} | {j.created_by_id for j in journeys},
    )
    brands = await _brand_names(db, {j.brand_id for j in journeys})
    return [_journey_out(j, names, brands) for j in journeys]


@router.post("/journeys", response_model=JourneyOut, status_code=201)
async def create_journey(
    payload: JourneyCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if payload.kind not in KINDS:
        raise HTTPException(status_code=422, detail="Invalid kind")
    target = await db.get(User, payload.target_user_id)
    if not target:
        raise HTTPException(status_code=404, detail="Target user not found")

    journey = OnboardingJourney(
        kind=payload.kind,
        target_user_id=target.id,
        brand_id=payload.brand_id,
        note=payload.note,
        created_by_id=user.id,
    )
    db.add(journey)
    await db.flush()

    defaults = DEFAULT_ONBOARDING if payload.kind == "onboarding" else DEFAULT_OFFBOARDING
    for i, (category, title) in enumerate(defaults):
        db.add(
            OnboardingTask(
                journey_id=journey.id, title=title, category=category, sort=i
            )
        )

    # Optionally broadcast on the announcements channel.
    if payload.announce:
        verb = "joining" if payload.kind == "onboarding" else "leaving"
        body = payload.announce_message or (
            f"Please welcome {target.display_name or target.email} to the team!"
            if payload.kind == "onboarding"
            else f"{target.display_name or target.email} will be {verb} us. Thank you for everything."
        )
        ann = Announcement(
            title=(
                f"Welcome {target.display_name or target.email}"
                if payload.kind == "onboarding"
                else f"Farewell to {target.display_name or target.email}"
            ),
            body=body,
            author_id=user.id,
            is_published=True,
        )
        db.add(ann)
        recipients = (
            await db.execute(
                select(User.id).where(User.status == "active", User.id != user.id)
            )
        ).scalars().all()
        for uid in recipients:
            await notify_user(
                db,
                user_id=uid,
                title="New announcement",
                body=ann.title,
                link="/announcements",
                category="announcement",
                dedup_key=f"journey-ann:{journey.id}:{uid}",
            )

    # Offboarding goes to IT/managers to remove access.
    if payload.kind == "offboarding":
        agents = (
            await db.execute(
                select(User.id).where(
                    User.is_admin.is_(True) | (User.role == "manager"),
                    User.status == "active",
                    User.id != user.id,
                )
            )
        ).scalars().all()
        for aid in agents:
            await notify_user(
                db,
                user_id=aid,
                title="Offboarding — remove access",
                body=f"Please revoke access & collect equipment for {target.display_name or target.email}.",
                link="/people-ops",
                category="people_ops",
                dedup_key=f"offboard:{journey.id}:{aid}",
            )

    record(
        db,
        user=user,
        action="created",
        entity_type="people_ops",
        entity_id=journey.id,
        summary=f"Started {payload.kind} for {target.display_name or target.email}",
    )
    await db.commit()
    await db.refresh(journey, ["tasks"])
    names = await user_names(db, {journey.target_user_id, journey.created_by_id})
    brands = await _brand_names(db, {journey.brand_id})
    return _journey_out(journey, names, brands)


async def _get_journey(db: AsyncSession, journey_id: uuid.UUID) -> OnboardingJourney:
    # Use a select (not db.get) so the eager load is applied even when the
    # journey is already in the identity map.
    j = (
        await db.execute(
            select(OnboardingJourney)
            .where(OnboardingJourney.id == journey_id)
            .options(selectinload(OnboardingJourney.tasks))
        )
    ).scalar_one_or_none()
    if not j:
        raise HTTPException(status_code=404, detail="Journey not found")
    return j


@router.get("/journeys/{journey_id}", response_model=JourneyDetail)
async def get_journey(
    journey_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    j = await _get_journey(db, journey_id)
    owner_ids = {t.owner_id for t in j.tasks} | {t.done_by_id for t in j.tasks}
    names = await user_names(
        db, owner_ids | {j.target_user_id, j.created_by_id}
    )
    brands = await _brand_names(db, {j.brand_id})
    detail = JourneyDetail(**_journey_out(j, names, brands).model_dump())
    detail.tasks = [_task_out(t, names) for t in j.tasks]

    target = await db.get(User, j.target_user_id) if j.target_user_id else None
    if target:
        detail.target = TargetAccess(
            id=target.id,
            name=target.display_name,
            email=target.email,
            status=target.status,
            role=target.role,
            is_admin=target.is_admin,
            effective_permissions=resolve_permissions(
                role=target.role,
                is_admin=target.is_admin,
                permissions=target.permissions,
            ),
        )
        assets = (
            await db.execute(
                select(TrackedAsset).where(TrackedAsset.assigned_to_id == target.id)
            )
        ).scalars().all()
        detail.assigned_assets = [
            AssignedAsset(id=a.id, asset_tag=a.asset_tag, name=a.name) for a in assets
        ]
        grants = (
            await db.execute(
                select(AccessGrant)
                .where(AccessGrant.user_id == target.id)
                .order_by(AccessGrant.status.asc(), AccessGrant.created_at.desc())
            )
        ).scalars().all()
        detail.access_grants = [AccessGrantOut.model_validate(g) for g in grants]
    return detail


@router.post("/journeys/{journey_id}/tasks", response_model=JourneyTaskOut, status_code=201)
async def add_task(
    journey_id: uuid.UUID,
    payload: TaskCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    j = await _get_journey(db, journey_id)
    sort = max((t.sort for t in j.tasks), default=-1) + 1
    task = OnboardingTask(
        journey_id=j.id,
        title=payload.title,
        category=payload.category,
        owner_id=payload.owner_id,
        sort=sort,
    )
    db.add(task)
    if task.owner_id and task.owner_id != user.id:
        await notify_user(
            db,
            user_id=task.owner_id,
            title=f"{j.kind.title()} action assigned to you",
            body=task.title,
            link="/",
            category="people_ops",
        )
    await db.commit()
    await db.refresh(task)
    names = await user_names(db, {task.owner_id, task.done_by_id})
    return _task_out(task, names)


@router.patch("/tasks/{task_id}", response_model=JourneyTaskOut)
async def update_task(
    task_id: uuid.UUID,
    payload: TaskUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    task = await db.get(OnboardingTask, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    data = payload.model_dump(exclude_unset=True)
    if "status" in data and data["status"] not in TASK_STATUSES:
        raise HTTPException(status_code=422, detail="Invalid status")

    prev_owner = task.owner_id
    for field, value in data.items():
        setattr(task, field, value)
    if "status" in data:
        if data["status"] == "done":
            task.done_by_id = user.id
            task.done_at = datetime.now(timezone.utc)
        else:
            task.done_by_id = None
            task.done_at = None
    if task.owner_id and task.owner_id not in (prev_owner, user.id):
        j = await db.get(OnboardingJourney, task.journey_id)
        await notify_user(
            db,
            user_id=task.owner_id,
            title=f"{(j.kind if j else 'Onboarding').title()} action assigned to you",
            body=task.title,
            link="/",
            category="people_ops",
        )
    await _maybe_complete(db, task.journey_id, user)
    await db.commit()
    await db.refresh(task)
    names = await user_names(db, {task.owner_id, task.done_by_id})
    return _task_out(task, names)


@router.delete("/tasks/{task_id}", status_code=204)
async def delete_task(
    task_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    task = await db.get(OnboardingTask, task_id)
    if task:
        await db.delete(task)
        await db.commit()


@router.post("/journeys/{journey_id}/access", response_model=JourneyDetail)
async def access_action(
    journey_id: uuid.UUID,
    payload: AccessAction,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Check/adjust the target's system access (offboarding/onboarding). Admin only."""
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="Admin privileges required")
    j = await _get_journey(db, journey_id)
    target = await db.get(User, j.target_user_id) if j.target_user_id else None
    if not target:
        raise HTTPException(status_code=404, detail="Target user not found")
    if payload.action == "disable":
        target.status = "disabled"
    elif payload.action == "activate":
        target.status = "active"
    elif payload.action == "revoke_access":
        target.permissions = []
        target.status = "disabled"
    else:
        raise HTTPException(status_code=422, detail="Unknown action")
    record(
        db,
        user=user,
        action="updated",
        entity_type="user",
        entity_id=target.id,
        summary=f"{payload.action.replace('_', ' ').title()} for {target.email} (via {j.kind})",
    )
    await db.commit()
    return await get_journey(journey_id, db, user)


# ---- Asset assignment (linked to the Asset Tracker) ----
@router.get("/assignable-assets", response_model=list[AssignedAsset])
async def assignable_assets(
    db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)
):
    """Available tracked assets, so HR can hand out equipment without needing
    the Asset Tracker module directly."""
    assets = (
        await db.execute(
            select(TrackedAsset)
            .where(TrackedAsset.status == "available")
            .order_by(TrackedAsset.asset_tag)
        )
    ).scalars().all()
    return [AssignedAsset(id=a.id, asset_tag=a.asset_tag, name=a.name) for a in assets]


@router.post("/journeys/{journey_id}/assets", response_model=JourneyDetail)
async def assign_asset(
    journey_id: uuid.UUID,
    payload: AssignAssetIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    j = await _get_journey(db, journey_id)
    if not j.target_user_id:
        raise HTTPException(status_code=400, detail="Journey has no employee")
    asset = await db.get(TrackedAsset, payload.asset_id)
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")
    asset.assigned_to_id = j.target_user_id
    asset.status = "assigned"
    db.add(
        AssetEvent(
            asset_id=asset.id,
            event_type="checkout",
            user_id=j.target_user_id,
            note=f"Assigned during {j.kind}",
            performed_by_id=user.id,
        )
    )
    await notify_user(
        db,
        user_id=j.target_user_id,
        title="An asset was assigned to you",
        body=f"{asset.name} ({asset.asset_tag})",
        link="/",
        category="asset",
    )
    await db.commit()
    return await get_journey(journey_id, db, user)


@router.post("/journeys/{journey_id}/assets/{asset_id}/return", response_model=JourneyDetail)
async def return_asset(
    journey_id: uuid.UUID,
    asset_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    j = await _get_journey(db, journey_id)
    asset = await db.get(TrackedAsset, asset_id)
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")
    previous = asset.assigned_to_id
    asset.assigned_to_id = None
    asset.status = "available"
    db.add(
        AssetEvent(
            asset_id=asset.id,
            event_type="checkin",
            user_id=previous,
            note=f"Collected during {j.kind}",
            performed_by_id=user.id,
        )
    )
    await db.commit()
    return await get_journey(journey_id, db, user)


# ---- Account / system access grants ----
@router.post("/journeys/{journey_id}/grants", response_model=AccessGrantOut, status_code=201)
async def add_grant(
    journey_id: uuid.UUID,
    payload: AccessGrantCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    j = await _get_journey(db, journey_id)
    if not j.target_user_id:
        raise HTTPException(status_code=400, detail="Journey has no employee")
    grant = AccessGrant(
        user_id=j.target_user_id,
        journey_id=j.id,
        name=payload.name,
        system=payload.system,
        username=payload.username,
        notes=payload.notes,
        granted_by_id=user.id,
    )
    db.add(grant)
    await db.commit()
    await db.refresh(grant)
    return grant


@router.post("/grants/{grant_id}/revoke", response_model=AccessGrantOut)
async def revoke_grant(
    grant_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    grant = await db.get(AccessGrant, grant_id)
    if not grant:
        raise HTTPException(status_code=404, detail="Access grant not found")
    grant.status = "revoked"
    grant.revoked_by_id = user.id
    grant.revoked_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(grant)
    return grant


@router.delete("/grants/{grant_id}", status_code=204)
async def delete_grant(
    grant_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    grant = await db.get(AccessGrant, grant_id)
    if grant:
        await db.delete(grant)
        await db.commit()


# ---- PDF hard copy ----
@router.get("/journeys/{journey_id}/report.pdf")
async def journey_report(
    journey_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    j = await _get_journey(db, journey_id)
    target = await db.get(User, j.target_user_id) if j.target_user_id else None
    brand = await db.get(Brand, j.brand_id) if j.brand_id else None
    assets = (
        await db.execute(
            select(TrackedAsset).where(TrackedAsset.assigned_to_id == j.target_user_id)
        )
    ).scalars().all() if target else []
    grants = (
        await db.execute(
            select(AccessGrant).where(AccessGrant.user_id == j.target_user_id)
        )
    ).scalars().all() if target else []
    pdf = render_journey_report(
        kind=j.kind,
        target_name=(target.display_name or target.email) if target else "—",
        target_email=target.email if target else "—",
        branch=brand.name if brand else None,
        status=j.status,
        created_at=j.created_at,
        assets=[(a.asset_tag, a.name) for a in assets],
        grants=[
            (g.name, g.username or g.system or "", g.status) for g in grants
        ],
        tasks=[(t.title, t.category, t.status) for t in j.tasks],
    )
    fname = f"{j.kind}-{(target.email.split('@')[0] if target else 'record')}.pdf"
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )


async def _maybe_complete(
    db: AsyncSession, journey_id: uuid.UUID, user: User
) -> None:
    j = await _get_journey(db, journey_id)
    if j.status != "in_progress" or not j.tasks:
        return
    if all(t.status in ("done", "na") for t in j.tasks):
        j.status = "completed"
        j.completed_at = datetime.now(timezone.utc)
        if j.created_by_id and j.created_by_id != user.id:
            await notify_user(
                db,
                user_id=j.created_by_id,
                title=f"{j.kind.title()} completed",
                body="All checklist items are done.",
                link="/people-ops",
                category="people_ops",
            )
