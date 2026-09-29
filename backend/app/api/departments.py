"""Admin-managed departments (access groups) that grant module permissions."""
import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_admin
from app.core.database import get_db
from app.core.permissions import ALL_MODULES
from app.models.department import Department
from app.models.user import User
from app.schemas.department import (
    DepartmentCreate, DepartmentMemberAdd, DepartmentMemberOut, DepartmentOut, DepartmentUpdate,
)
from app.services.activity import record

router = APIRouter(prefix="/departments", tags=["departments"])


def _validate_modules(perms: list[str]) -> None:
    invalid = set(perms) - set(ALL_MODULES)
    if invalid:
        raise HTTPException(
            status_code=422, detail=f"Unknown modules: {', '.join(sorted(invalid))}"
        )


async def _counts(db: AsyncSession, ids: set[uuid.UUID]) -> dict[uuid.UUID, int]:
    if not ids:
        return {}
    rows = (
        await db.execute(
            select(User.department_id, func.count())
            .where(User.department_id.in_(ids))
            .group_by(User.department_id)
        )
    ).all()
    return {r[0]: int(r[1]) for r in rows}


def _serialize(dept: Department, counts: dict) -> DepartmentOut:
    out = DepartmentOut.model_validate(dept)
    out.member_count = counts.get(dept.id, 0)
    return out


def _member(user: User) -> DepartmentMemberOut:
    return DepartmentMemberOut.model_validate(user, from_attributes=True)


@router.get("", response_model=list[DepartmentOut])
async def list_departments(
    db: AsyncSession = Depends(get_db), _: User = Depends(get_current_admin)
):
    depts = (await db.execute(select(Department).order_by(Department.name))).scalars().all()
    counts = await _counts(db, {d.id for d in depts})
    return [_serialize(d, counts) for d in depts]


@router.get("/{department_id}/members", response_model=list[DepartmentMemberOut])
async def list_members(
    department_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    if not await db.get(Department, department_id):
        raise HTTPException(status_code=404, detail="Department not found")
    members = (await db.scalars(select(User).where(User.department_id == department_id)
        .order_by(User.display_name, User.email))).all()
    return [_member(user) for user in members]


@router.post("/{department_id}/members", response_model=DepartmentMemberOut, status_code=201)
async def add_member(
    department_id: uuid.UUID,
    payload: DepartmentMemberAdd,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(get_current_admin),
):
    dept = await db.get(Department, department_id)
    if not dept:
        raise HTTPException(status_code=404, detail="Department not found")
    member = await db.get(User, payload.user_id, with_for_update=True)
    if not member:
        raise HTTPException(status_code=404, detail="User not found")
    if member.department_id == department_id:
        raise HTTPException(status_code=409, detail="This person is already in the department")
    previous = member.access_department.name if member.access_department else "no department"
    # Convert legacy standalone grants to personal grants so the new group
    # actually supplies its base access without removing existing grants.
    if member.permissions is not None:
        member.extra_permissions = sorted(set(member.extra_permissions or []) | set(member.permissions))
        member.permissions = None
    member.department_id = department_id
    record(db, user=admin, action="updated", entity_type="user", entity_id=member.id,
        summary=f"Moved {member.email or member.display_name or member.id} from {previous} to {dept.name}")
    await db.commit()
    return _member(member)


@router.delete("/{department_id}/members/{user_id}", status_code=204)
async def remove_member(
    department_id: uuid.UUID,
    user_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(get_current_admin),
):
    dept = await db.get(Department, department_id)
    if not dept:
        raise HTTPException(status_code=404, detail="Department not found")
    member = await db.get(User, user_id, with_for_update=True)
    if not member or member.department_id != department_id:
        raise HTTPException(status_code=404, detail="Department member not found")
    # An ungrouped user otherwise falls back to role defaults, which can grant
    # a manager more modules than this department allowed. Keep only personal
    # grants as the explicit base when the department base is removed.
    if member.permissions is None:
        member.permissions = list(member.extra_permissions or [])
    member.department_id = None
    record(db, user=admin, action="updated", entity_type="user", entity_id=member.id,
        summary=f"Removed {member.email or member.display_name or member.id} from {dept.name}")
    await db.commit()


@router.post("", response_model=DepartmentOut, status_code=201)
async def create_department(
    payload: DepartmentCreate,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(get_current_admin),
):
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="Name is required")
    _validate_modules(payload.permissions)
    dept = Department(name=name, description=payload.description, permissions=payload.permissions)
    db.add(dept)
    record(
        db, user=admin, action="created", entity_type="department", entity_id=dept.id,
        summary=f"Created department {name}",
    )
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="A department with that name exists")
    await db.refresh(dept)
    return _serialize(dept, {})


@router.patch("/{department_id}", response_model=DepartmentOut)
async def update_department(
    department_id: uuid.UUID,
    payload: DepartmentUpdate,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(get_current_admin),
):
    dept = await db.get(Department, department_id)
    if not dept:
        raise HTTPException(status_code=404, detail="Department not found")
    data = payload.model_dump(exclude_unset=True)
    if "permissions" in data and data["permissions"] is not None:
        _validate_modules(data["permissions"])
    if "name" in data and data["name"]:
        data["name"] = data["name"].strip()
    for field, value in data.items():
        setattr(dept, field, value)
    record(
        db, user=admin, action="updated", entity_type="department", entity_id=dept.id,
        summary=f"Updated department {dept.name}",
    )
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="A department with that name exists")
    await db.refresh(dept)
    counts = await _counts(db, {dept.id})
    return _serialize(dept, counts)


@router.delete("/{department_id}", status_code=204)
async def delete_department(
    department_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    dept = await db.get(Department, department_id)
    if dept:
        # Members keep their per-person grants; they just lose the dept base.
        await db.delete(dept)
        await db.commit()
