"""Per-person profile: a single view of someone's access, belongings and work.

Visibility:
  * the person themselves
  * admins and anyone with the People-Ops permission (HR)
  * a department *manager* — role ``manager`` in the same access department
"""
import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload, selectinload

from app.auth.deps import get_current_user
from app.core.database import get_db
from app.models.hr import EmploymentEvent
from app.models.people import AccessGrant, OnboardingJourney, OnboardingTask
from app.models.phone_line import PhoneLine
from app.models.tracked_asset import TrackedAsset
from app.models.user import User
from app.models.workplace import Task
from app.schemas.profile import (
    ProfileEvent,
    ProfileItem,
    ProfileJourney,
    ProfileOut,
    ProfileSubscription,
    ProfileTask,
    ProfileUpdate,
)
from app.models.field_audit import FieldChange
from app.services.activity import record
from app.services.field_audit import record_field_change
from app.services.people import user_names
from app.services.subscriptions import person_subscriptions

# Fields any manager/HR editor may change vs. admin-only ones.
_HR_FIELDS = {
    "display_name", "given_name", "surname",
    "job_title", "office_location", "mobile_phone", "business_phone",
    "personal_email", "nationality", "passport_no", "date_of_birth",
    "employment_type", "hire_date", "probation_end_date", "contract_end_date",
    "emergency_contact_name", "emergency_contact_phone", "emergency_contact_relationship",
}
_ADMIN_FIELDS = {"manager_id", "department_id", "role", "status"}

router = APIRouter(prefix="/profiles", tags=["profiles"])


def _can_view(viewer: User, target: User) -> tuple[bool, bool, bool]:
    """Return (can_view, can_manage, can_see_sensitive) for viewer→target."""
    is_self = viewer.id == target.id
    is_hr = viewer.is_admin or "hr" in viewer.effective_permissions
    is_dept_manager = (
        viewer.role == "manager"
        and viewer.department_id is not None
        and viewer.department_id == target.department_id
    )
    can_view = is_self or is_hr or is_dept_manager
    can_manage = viewer.is_admin or is_hr
    can_see_sensitive = is_self or is_hr
    return can_view, can_manage, can_see_sensitive


async def _build(db: AsyncSession, viewer: User, target: User) -> ProfileOut:
    can_view, can_manage, sensitive = _can_view(viewer, target)
    if not can_view:
        raise HTTPException(status_code=403, detail="You can't view this profile")

    # Re-load with the manager + access-department relationships eagerly present.
    # `db.get()` can hand back an identity-mapped instance whose `manager` isn't
    # loaded, and accessing `manager_name`/`department_name` below would then try
    # to lazy-load during serialization — illegal under async (MissingGreenlet).
    target = (
        await db.execute(
            select(User)
            .options(joinedload(User.manager), selectinload(User.access_department))
            .where(User.id == target.id)
            .execution_options(populate_existing=True)
        )
    ).scalar_one()

    out = ProfileOut(
        id=target.id,
        name=target.display_name,
        email=target.email,
        job_title=target.job_title,
        role=target.role,
        status=target.status,
        is_admin=target.is_admin,
        department_name=target.department_name,
        hr_department=target.department,
        office_location=target.office_location,
        mobile_phone=target.mobile_phone,
        business_phone=target.business_phone,
        avatar_url=target.avatar_url,
        created_at=target.created_at,
        modules=target.effective_permissions,
        manager_id=target.manager_id,
        manager_name=target.manager_name,
        employment_type=target.employment_type,
        hire_date=target.hire_date,
        probation_end_date=target.probation_end_date,
        contract_end_date=target.contract_end_date,
        can_manage=can_manage,
        can_see_sensitive=sensitive,
    )
    if sensitive:
        out.personal_email = target.personal_email
        out.nationality = target.nationality
        out.passport_no = target.passport_no
        out.date_of_birth = target.date_of_birth
        out.emergency_contact_name = target.emergency_contact_name
        out.emergency_contact_phone = target.emergency_contact_phone
        out.emergency_contact_relationship = target.emergency_contact_relationship

    reports = (
        await db.execute(
            select(User).where(User.manager_id == target.id).order_by(User.display_name)
        )
    ).scalars().all()
    out.direct_reports = [
        ProfileItem(id=r.id, label=r.display_name or r.email or "—", sub=r.job_title, status=r.status)
        for r in reports
    ]

    grants = (
        await db.execute(
            select(AccessGrant)
            .where(AccessGrant.user_id == target.id)
            .order_by(AccessGrant.status.asc(), AccessGrant.created_at.desc())
        )
    ).scalars().all()
    out.access_grants = [
        ProfileItem(id=g.id, label=g.name, sub=g.system, status=g.status) for g in grants
    ]

    for entry in await person_subscriptions(db, target):
        sub, seat = entry["subscription"], entry["seat"]
        out.subscriptions.append(
            ProfileSubscription(
                subscription_id=sub.id,
                name=sub.name,
                vendor=sub.vendor,
                source=entry["source"],
                seat_status=seat.status if seat else None,
            )
        )

    assets = (
        await db.execute(
            select(TrackedAsset).where(TrackedAsset.assigned_to_id == target.id)
        )
    ).scalars().all()
    out.assets = [
        ProfileItem(id=a.id, label=a.name, sub=a.asset_tag, status=a.status) for a in assets
    ]

    phones = (
        await db.execute(
            select(PhoneLine).where(PhoneLine.assigned_to_id == target.id)
        )
    ).scalars().all()
    out.phones = [
        ProfileItem(id=p.id, label=p.number, sub=p.carrier, status=p.status) for p in phones
    ]

    tasks = (
        await db.execute(
            select(Task)
            .where(Task.assignee_id == target.id, Task.status != "done")
            .order_by(Task.created_at.desc())
            .limit(50)
        )
    ).scalars().all()
    out.open_tasks = [
        ProfileTask(
            id=t.id, title=t.title, status=t.status, priority=t.priority, due_date=t.due_date
        )
        for t in tasks
    ]

    journeys = (
        await db.execute(
            select(OnboardingJourney)
            .where(OnboardingJourney.target_user_id == target.id)
            .order_by(OnboardingJourney.created_at.desc())
        )
    ).scalars().all()
    for j in journeys:
        total = (
            await db.execute(
                select(OnboardingTask).where(OnboardingTask.journey_id == j.id)
            )
        ).scalars().all()
        out.journeys.append(
            ProfileJourney(
                id=j.id,
                kind=j.kind,
                status=j.status,
                total_tasks=len(total),
                done_tasks=sum(1 for t in total if t.status in ("done", "na")),
                created_at=j.created_at,
            )
        )

    if sensitive:
        events = (
            await db.execute(
                select(EmploymentEvent)
                .where(EmploymentEvent.user_id == target.id)
                .order_by(EmploymentEvent.effective_date.desc())
                .limit(50)
            )
        ).scalars().all()
        out.events = [
            ProfileEvent(
                id=e.id, event_type=e.event_type, effective_date=e.effective_date,
                title=e.title, detail=e.detail, created_at=e.created_at,
            )
            for e in events
        ]
    return out


@router.get("/me", response_model=ProfileOut)
async def my_profile(
    db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)
):
    return await _build(db, user, user)


@router.get("/{user_id}", response_model=ProfileOut)
async def get_profile(
    user_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    viewer: User = Depends(get_current_user),
):
    target = await db.get(User, user_id)
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    return await _build(db, viewer, target)


@router.patch("/{user_id}", response_model=ProfileOut)
async def update_profile(
    user_id: uuid.UUID,
    payload: ProfileUpdate,
    db: AsyncSession = Depends(get_db),
    viewer: User = Depends(get_current_user),
):
    target = await db.get(User, user_id)
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    _, can_manage, _ = _can_view(viewer, target)
    if not can_manage:
        raise HTTPException(status_code=403, detail="You can't edit this profile")

    data = payload.model_dump(exclude_unset=True)
    if "hr_department" in data:
        new_dept = data.pop("hr_department")
        record_field_change(
            db, entity_type="user", entity_id=target.id, field="hr_department",
            old=target.department, new=new_dept, actor_id=viewer.id,
        )
        target.department = new_dept
    if data.get("manager_id") is not None and viewer.is_admin:
        if data["manager_id"] == target.id:
            raise HTTPException(status_code=422, detail="A user can't manage themselves")
        if not await db.get(User, data["manager_id"]):
            raise HTTPException(status_code=404, detail="Manager not found")
    for field in list(data):
        if field in _ADMIN_FIELDS and not viewer.is_admin:
            data.pop(field)  # silently ignore admin-only fields for HR editors
            continue
        if field in _HR_FIELDS or field in _ADMIN_FIELDS:
            old = getattr(target, field)
            record_field_change(
                db, entity_type="user", entity_id=target.id, field=field,
                old=old, new=data[field], actor_id=viewer.id,
            )
            setattr(target, field, data[field])
    record(
        db, user=viewer, action="updated", entity_type="user", entity_id=target.id,
        summary=f"Updated profile for {target.display_name or target.email}",
    )
    await db.commit()
    # Re-SELECT so selectin relationships (manager, access dept) repopulate.
    target = (
        await db.execute(
            select(User).where(User.id == target.id).execution_options(populate_existing=True)
        )
    ).scalar_one()
    return await _build(db, viewer, target)


@router.get("/{user_id}/field-history")
async def field_history(
    user_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    viewer: User = Depends(get_current_user),
):
    """Per-field change history for a profile. Visible to HR and the person."""
    target = await db.get(User, user_id)
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    _, _, sensitive = _can_view(viewer, target)
    if not sensitive:
        raise HTTPException(status_code=403, detail="Not allowed")
    rows = (
        await db.execute(
            select(FieldChange)
            .where(FieldChange.entity_type == "user", FieldChange.entity_id == user_id)
            .order_by(FieldChange.created_at.desc())
            .limit(100)
        )
    ).scalars().all()
    names = await user_names(db, {r.actor_id for r in rows})
    return [
        {
            "id": str(r.id),
            "field": r.field,
            "old_value": r.old_value,
            "new_value": r.new_value,
            "actor_name": names.get(r.actor_id) if r.actor_id else None,
            "created_at": r.created_at.isoformat(),
        }
        for r in rows
    ]
