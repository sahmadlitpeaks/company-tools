import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth.deps import get_current_user
from app.core.database import get_db
from app.models.company import Company
from app.models.department import Department
from app.models.hr import EMPLOYMENT_EVENT_TYPES, EmploymentEvent
from app.models.people import (
    DEFAULT_OFFBOARDING,
    DEFAULT_ONBOARDING,
    AccessGrant,
    OnboardingJourney,
    OnboardingTask,
    OnboardingTemplate,
    OnboardingTemplateItem,
)
from app.models.phone_line import PhoneLine
from app.models.subscription import Subscription, SubscriptionSeat
from app.models.tracked_asset import AssetEvent, TrackedAsset
from app.models.user import User
from app.models.workplace import Announcement
from app.schemas.people import (
    AccessAction,
    AccessGrantCreate,
    AccessGrantOut,
    AssignAssetIn,
    AssignedAsset,
    AssignedPhone,
    EmploymentEventCreate,
    EmploymentEventOut,
    JourneyCreate,
    JourneyDetail,
    JourneyOut,
    JourneyTaskOut,
    OrgNode,
    PersonSubscription,
    ProvisionSuggestion,
    ProvisionSuggestions,
    TargetAccess,
    TaskCreate,
    TaskUpdate,
    TemplateCreate,
    TemplateOut,
    TemplateUpdate,
)
from app.services.activity import record
from app.services.notify import notify_user
from app.services.onboarding_pdf import render_journey_report
from app.services.onboarding_sync import remove_linked_task, sync_linked_task
from app.services.people import user_names
from app.services.subscriptions import person_subscriptions

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
    o.company_name = (brands or {}).get(j.company_id) if j.company_id else None
    tasks = j.__dict__.get("tasks") or []
    o.total_tasks = len(tasks)
    o.done_tasks = sum(1 for t in tasks if t.status == "done")
    return o


async def _company_names(db: AsyncSession, ids: set) -> dict:
    ids = {i for i in ids if i}
    if not ids:
        return {}
    rows = (await db.execute(select(Company.id, Company.name).where(Company.id.in_(ids)))).all()
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
    brands = await _company_names(db, {j.company_id for j in journeys})
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
        company_id=payload.company_id,
        note=payload.note,
        created_by_id=user.id,
    )
    db.add(journey)
    await db.flush()

    # Seed the checklist from a chosen template (packet), else the built-in default.
    template = None
    if payload.template_id:
        template = (
            await db.execute(
                select(OnboardingTemplate)
                .options(selectinload(OnboardingTemplate.items))
                .where(OnboardingTemplate.id == payload.template_id)
            )
        ).scalar_one_or_none()
    if template and template.items:
        for i, it in enumerate(sorted(template.items, key=lambda x: x.sort)):
            db.add(OnboardingTask(journey_id=journey.id, title=it.title, category=it.category, sort=i))
    else:
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
    brands = await _company_names(db, {journey.company_id})
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
    brands = await _company_names(db, {j.company_id})
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
            effective_permissions=target.effective_permissions,
        )
        assets = (
            await db.execute(
                select(TrackedAsset).where(TrackedAsset.assigned_to_id == target.id)
            )
        ).scalars().all()
        detail.assigned_assets = [
            AssignedAsset(id=a.id, asset_tag=a.asset_tag, name=a.name) for a in assets
        ]
        phones = (
            await db.execute(
                select(PhoneLine).where(PhoneLine.assigned_to_id == target.id)
            )
        ).scalars().all()
        detail.assigned_phones = [
            AssignedPhone(id=p.id, number=p.number) for p in phones
        ]
        grants = (
            await db.execute(
                select(AccessGrant)
                .where(AccessGrant.user_id == target.id)
                .order_by(AccessGrant.status.asc(), AccessGrant.created_at.desc())
            )
        ).scalars().all()
        detail.access_grants = [AccessGrantOut.model_validate(g) for g in grants]
        # Subscriptions the leaver is covered by (personal seats are revocable).
        for entry in await person_subscriptions(db, target):
            sub = entry["subscription"]
            seat = entry["seat"]
            detail.subscriptions.append(
                PersonSubscription(
                    subscription_id=sub.id,
                    name=sub.name,
                    vendor=sub.vendor,
                    source=entry["source"],
                    seat_id=seat.id if seat else None,
                    seat_status=seat.status if seat else None,
                )
            )
    return detail


@router.get("/journeys/{journey_id}/suggestions", response_model=ProvisionSuggestions)
async def provision_suggestions(
    journey_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """What to provision for a new hire: subscriptions & access that a majority
    of their department peers hold but they don't yet, plus the dept/company
    subscriptions they're already auto-covered by."""
    j = await _get_journey(db, journey_id)
    target = await db.get(User, j.target_user_id) if j.target_user_id else None
    if not target:
        raise HTTPException(status_code=400, detail="Journey has no employee")

    out = ProvisionSuggestions()
    for entry in await person_subscriptions(db, target):
        if entry["source"] != "seat":
            sub = entry["subscription"]
            out.auto_covered.append(
                PersonSubscription(
                    subscription_id=sub.id, name=sub.name, vendor=sub.vendor,
                    source=entry["source"],
                )
            )
    if not target.department_id:
        return out

    dept = await db.get(Department, target.department_id)
    out.department_name = dept.name if dept else None
    peers = (
        await db.execute(
            select(User).where(
                User.department_id == target.department_id,
                User.id != target.id,
                User.status == "active",
            )
        )
    ).scalars().all()
    out.peer_total = len(peers)
    if not peers:
        return out
    peer_ids = {p.id for p in peers}

    # Subscriptions the target is already seated on (skip these).
    target_subs = {
        s.subscription_id
        for s in (
            await db.execute(
                select(SubscriptionSeat).where(
                    SubscriptionSeat.user_id == target.id,
                    SubscriptionSeat.status == "active",
                )
            )
        ).scalars().all()
    }
    holders: dict[uuid.UUID, set] = {}
    for sub_id, uid in (
        await db.execute(
            select(SubscriptionSeat.subscription_id, SubscriptionSeat.user_id).where(
                SubscriptionSeat.user_id.in_(peer_ids),
                SubscriptionSeat.status == "active",
            )
        )
    ).all():
        holders.setdefault(sub_id, set()).add(uid)
    suggest_ids = [
        sid for sid, who in holders.items()
        if sid not in target_subs and 2 * len(who) >= len(peers)
    ]
    if suggest_ids:
        subs = (
            await db.execute(select(Subscription).where(Subscription.id.in_(suggest_ids)))
        ).scalars().all()
        for sub in subs:
            out.subscriptions.append(
                ProvisionSuggestion(
                    kind="subscription", ref_id=sub.id, label=sub.name,
                    detail=sub.vendor, peer_count=len(holders[sub.id]),
                    peer_total=len(peers),
                )
            )
        out.subscriptions.sort(key=lambda s: s.peer_count, reverse=True)

    # Account / system access common among peers.
    target_access = {
        g.name.lower()
        for g in (
            await db.execute(
                select(AccessGrant).where(
                    AccessGrant.user_id == target.id, AccessGrant.status == "active"
                )
            )
        ).scalars().all()
    }
    access_holders: dict[str, set] = {}
    display: dict[str, str] = {}
    for name, uid in (
        await db.execute(
            select(AccessGrant.name, AccessGrant.user_id).where(
                AccessGrant.user_id.in_(peer_ids), AccessGrant.status == "active"
            )
        )
    ).all():
        key = name.lower()
        access_holders.setdefault(key, set()).add(uid)
        display.setdefault(key, name)
    for key, who in access_holders.items():
        if key not in target_access and 2 * len(who) >= len(peers):
            out.access.append(
                ProvisionSuggestion(
                    kind="access", label=display[key], peer_count=len(who),
                    peer_total=len(peers),
                )
            )
    out.access.sort(key=lambda s: s.peer_count, reverse=True)
    return out


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
    await db.flush()
    await sync_linked_task(db, task, user.id)
    if task.owner_id and task.owner_id != user.id:
        await notify_user(
            db,
            user_id=task.owner_id,
            title=f"{j.kind.title()} action assigned to you",
            body=task.title,
            link="/tasks",
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
            link="/tasks",
            category="people_ops",
        )
    await sync_linked_task(db, task, user.id)
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
        await remove_linked_task(db, task.id)
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
    brand = await db.get(Company, j.company_id) if j.company_id else None
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


# --------------------------------------------------------------------------
# HR: org chart + employment history
# --------------------------------------------------------------------------
@router.get("/org-chart", response_model=list[OrgNode])
async def org_chart(
    root_id: uuid.UUID | None = None,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Reporting tree. Top level is everyone without a manager (or the given
    root). Inactive/departed people are excluded."""
    users = (
        await db.execute(
            select(User).where(User.status != "departed").order_by(User.display_name)
        )
    ).scalars().all()
    children: dict[uuid.UUID, list[User]] = {}
    for u in users:
        children.setdefault(u.manager_id, []).append(u)

    def build(u: User) -> OrgNode:
        kids = children.get(u.id, [])
        return OrgNode(
            id=u.id,
            name=u.display_name,
            job_title=u.job_title,
            avatar_url=u.avatar_url,
            department_name=u.department_name,
            report_count=len(kids),
            reports=[build(k) for k in kids],
        )

    if root_id:
        root = await db.get(User, root_id)
        return [build(root)] if root else []
    return [build(u) for u in children.get(None, [])]


@router.get("/{user_id}/events", response_model=list[EmploymentEventOut])
async def list_events(
    user_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    events = (
        await db.execute(
            select(EmploymentEvent)
            .where(EmploymentEvent.user_id == user_id)
            .order_by(EmploymentEvent.effective_date.desc(), EmploymentEvent.created_at.desc())
        )
    ).scalars().all()
    names = await user_names(db, {e.created_by_id for e in events})
    out = []
    for e in events:
        item = EmploymentEventOut.model_validate(e)
        item.created_by_name = names.get(e.created_by_id)
        out.append(item)
    return out


@router.post("/{user_id}/events", response_model=EmploymentEventOut, status_code=201)
async def add_event(
    user_id: uuid.UUID,
    payload: EmploymentEventCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if not await db.get(User, user_id):
        raise HTTPException(status_code=404, detail="User not found")
    if payload.event_type not in EMPLOYMENT_EVENT_TYPES:
        raise HTTPException(status_code=422, detail="Invalid event type")
    if not (payload.title or "").strip():
        raise HTTPException(status_code=422, detail="Title is required")
    event = EmploymentEvent(
        user_id=user_id,
        event_type=payload.event_type,
        effective_date=payload.effective_date or datetime.now(timezone.utc).date(),
        title=payload.title.strip(),
        detail=payload.detail,
        created_by_id=user.id,
    )
    db.add(event)
    record(
        db, user=user, action="created", entity_type="user", entity_id=user_id,
        summary=f"Added employment event: {event.title}",
    )
    await db.commit()
    await db.refresh(event)
    out = EmploymentEventOut.model_validate(event)
    out.created_by_name = user.display_name
    return out


@router.delete("/events/{event_id}", status_code=204)
async def delete_event(
    event_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    event = await db.get(EmploymentEvent, event_id)
    if event:
        await db.delete(event)
        await db.commit()


# --------------------------------------------------------------------------
# Onboarding templates (packets)
# --------------------------------------------------------------------------
@router.get("/templates", response_model=list[TemplateOut])
async def list_templates(
    kind: str | None = None,
    include_inactive: bool = False,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    stmt = (
        select(OnboardingTemplate)
        .options(selectinload(OnboardingTemplate.items))
        .order_by(OnboardingTemplate.name)
    )
    if kind:
        stmt = stmt.where(OnboardingTemplate.kind == kind)
    if not include_inactive:
        stmt = stmt.where(OnboardingTemplate.active.is_(True))
    return (await db.execute(stmt)).scalars().unique().all()


@router.post("/templates", response_model=TemplateOut, status_code=201)
async def create_template(
    payload: TemplateCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if not payload.name.strip():
        raise HTTPException(status_code=422, detail="Name is required")
    if payload.kind not in KINDS:
        raise HTTPException(status_code=422, detail="Invalid kind")
    tpl = OnboardingTemplate(
        name=payload.name.strip(), kind=payload.kind, description=payload.description
    )
    db.add(tpl)
    await db.flush()
    for i, it in enumerate(payload.items):
        db.add(OnboardingTemplateItem(
            template_id=tpl.id, title=it.title, category=it.category, sort=it.sort or i
        ))
    await db.commit()
    return await _template(db, tpl.id)


@router.patch("/templates/{template_id}", response_model=TemplateOut)
async def update_template(
    template_id: uuid.UUID,
    payload: TemplateUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    tpl = await _template(db, template_id)
    data = payload.model_dump(exclude_unset=True)
    items = data.pop("items", None)
    for k, v in data.items():
        setattr(tpl, k, v)
    if items is not None:
        # Replace the item set wholesale.
        for it in list(tpl.items):
            await db.delete(it)
        await db.flush()
        for i, it in enumerate(items):
            db.add(OnboardingTemplateItem(
                template_id=tpl.id, title=it["title"],
                category=it.get("category", "other"), sort=it.get("sort", i),
            ))
    await db.commit()
    return await _template(db, template_id)


@router.delete("/templates/{template_id}", status_code=204)
async def delete_template(
    template_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    tpl = await db.get(OnboardingTemplate, template_id)
    if tpl:
        await db.delete(tpl)
        await db.commit()


async def _template(db: AsyncSession, template_id: uuid.UUID) -> OnboardingTemplate:
    tpl = (
        await db.execute(
            select(OnboardingTemplate)
            .options(selectinload(OnboardingTemplate.items))
            .where(OnboardingTemplate.id == template_id)
            .execution_options(populate_existing=True)
        )
    ).scalar_one_or_none()
    if not tpl:
        raise HTTPException(status_code=404, detail="Template not found")
    return tpl
