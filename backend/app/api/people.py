import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth.deps import get_current_user
from app.core.database import get_db
from app.core.permissions import resolve_permissions
from app.models.people import (
    DEFAULT_OFFBOARDING,
    DEFAULT_ONBOARDING,
    OnboardingJourney,
    OnboardingTask,
)
from app.models.tracked_asset import TrackedAsset
from app.models.user import User
from app.models.workplace import Announcement
from app.schemas.people import (
    AccessAction,
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
from app.services.people import user_names

router = APIRouter(prefix="/people", tags=["people-ops"])

KINDS = {"onboarding", "offboarding"}
TASK_STATUSES = {"pending", "done", "na"}


def _task_out(t: OnboardingTask, names: dict) -> JourneyTaskOut:
    o = JourneyTaskOut.model_validate(t)
    o.owner_name = names.get(t.owner_id) if t.owner_id else None
    o.done_by_name = names.get(t.done_by_id) if t.done_by_id else None
    return o


def _journey_out(j: OnboardingJourney, names: dict) -> JourneyOut:
    o = JourneyOut.model_validate(j)
    o.target_name = names.get(j.target_user_id) if j.target_user_id else None
    o.created_by_name = names.get(j.created_by_id) if j.created_by_id else None
    tasks = j.__dict__.get("tasks") or []
    o.total_tasks = len(tasks)
    o.done_tasks = sum(1 for t in tasks if t.status == "done")
    return o


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
    return [_journey_out(j, names) for j in journeys]


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
    return _journey_out(journey, names)


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
    detail = JourneyDetail(**_journey_out(j, names).model_dump())
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
