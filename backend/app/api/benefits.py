"""Benefits: HR-managed plans, employee enrollments and dependents.

HR manages the plan catalogue and enrolls employees; every employee can see
their own enrollments and manage their own dependents via the ``/my`` routes.
"""
import uuid
from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.core.database import get_db
from app.core.permissions import is_hr
from app.models.benefits import (
    BENEFIT_CATEGORIES,
    COVERAGE_LEVELS,
    DEPENDENT_RELATIONSHIPS,
    ENROLLMENT_STATUSES,
    BenefitEnrollment,
    BenefitPlan,
    Dependent,
)
from app.models.user import User
from app.schemas.benefits import (
    DependentCreate,
    DependentOut,
    EnrollmentCreate,
    EnrollmentOut,
    EnrollmentUpdate,
    PlanCreate,
    PlanOut,
    PlanUpdate,
)

router = APIRouter(prefix="/benefits", tags=["benefits"])


def _require_hr(user: User) -> None:
    if not is_hr(user):
        raise HTTPException(status_code=403, detail="HR access required")


async def _plan_out(db: AsyncSession, plan: BenefitPlan) -> PlanOut:
    count = await db.scalar(
        select(func.count(BenefitEnrollment.id)).where(
            BenefitEnrollment.plan_id == plan.id,
            BenefitEnrollment.status == "enrolled",
        )
    )
    out = PlanOut.model_validate(plan)
    out.enrolled_count = count or 0
    return out


async def _enrollment_out(db: AsyncSession, e: BenefitEnrollment) -> EnrollmentOut:
    plan = await db.get(BenefitPlan, e.plan_id)
    emp = await db.get(User, e.user_id)
    return EnrollmentOut(
        id=e.id,
        plan_id=e.plan_id,
        plan_name=plan.name if plan else None,
        category=plan.category if plan else None,
        currency=plan.currency if plan else None,
        user_id=e.user_id,
        employee_name=emp.display_name if emp else None,
        status=e.status,
        coverage_level=e.coverage_level,
        elected_cost=e.elected_cost,
        effective_date=e.effective_date,
        end_date=e.end_date,
        note=e.note,
    )


# ---- Plans (HR) ----
@router.get("/plans", response_model=list[PlanOut])
async def list_plans(
    include_inactive: bool = False,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _require_hr(user)
    stmt = select(BenefitPlan)
    if not include_inactive:
        stmt = stmt.where(BenefitPlan.active.is_(True))
    stmt = stmt.order_by(BenefitPlan.sort, BenefitPlan.name)
    plans = (await db.execute(stmt)).scalars().all()
    return [await _plan_out(db, p) for p in plans]


@router.post("/plans", response_model=PlanOut, status_code=201)
async def create_plan(
    body: PlanCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _require_hr(user)
    if body.category not in BENEFIT_CATEGORIES:
        raise HTTPException(status_code=422, detail="Invalid category")
    plan = BenefitPlan(**body.model_dump())
    db.add(plan)
    await db.commit()
    await db.refresh(plan)
    return await _plan_out(db, plan)


@router.patch("/plans/{plan_id}", response_model=PlanOut)
async def update_plan(
    plan_id: uuid.UUID,
    body: PlanUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _require_hr(user)
    plan = await db.get(BenefitPlan, plan_id)
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")
    data = body.model_dump(exclude_unset=True)
    if "category" in data and data["category"] not in BENEFIT_CATEGORIES:
        raise HTTPException(status_code=422, detail="Invalid category")
    for k, v in data.items():
        setattr(plan, k, v)
    await db.commit()
    await db.refresh(plan)
    return await _plan_out(db, plan)


@router.delete("/plans/{plan_id}", status_code=204)
async def delete_plan(
    plan_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _require_hr(user)
    plan = await db.get(BenefitPlan, plan_id)
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")
    await db.delete(plan)
    await db.commit()


# ---- Enrollments (HR) ----
@router.get("/enrollments", response_model=list[EnrollmentOut])
async def list_enrollments(
    plan_id: uuid.UUID | None = None,
    user_id: uuid.UUID | None = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _require_hr(user)
    stmt = select(BenefitEnrollment)
    if plan_id:
        stmt = stmt.where(BenefitEnrollment.plan_id == plan_id)
    if user_id:
        stmt = stmt.where(BenefitEnrollment.user_id == user_id)
    stmt = stmt.order_by(BenefitEnrollment.created_at.desc())
    rows = (await db.execute(stmt)).scalars().all()
    return [await _enrollment_out(db, e) for e in rows]


@router.post("/enrollments", response_model=EnrollmentOut, status_code=201)
async def create_enrollment(
    body: EnrollmentCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _require_hr(user)
    plan = await db.get(BenefitPlan, body.plan_id)
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")
    if not await db.get(User, body.user_id):
        raise HTTPException(status_code=404, detail="Employee not found")
    if body.status not in ENROLLMENT_STATUSES:
        raise HTTPException(status_code=422, detail="Invalid status")
    if body.coverage_level not in COVERAGE_LEVELS:
        raise HTTPException(status_code=422, detail="Invalid coverage level")
    e = BenefitEnrollment(
        plan_id=body.plan_id,
        user_id=body.user_id,
        status=body.status,
        coverage_level=body.coverage_level,
        elected_cost=body.elected_cost if body.elected_cost is not None else plan.employee_cost,
        effective_date=body.effective_date or date.today(),
        end_date=body.end_date,
        note=body.note,
    )
    db.add(e)
    await db.commit()
    await db.refresh(e)
    return await _enrollment_out(db, e)


@router.patch("/enrollments/{enrollment_id}", response_model=EnrollmentOut)
async def update_enrollment(
    enrollment_id: uuid.UUID,
    body: EnrollmentUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _require_hr(user)
    e = await db.get(BenefitEnrollment, enrollment_id)
    if not e:
        raise HTTPException(status_code=404, detail="Enrollment not found")
    data = body.model_dump(exclude_unset=True)
    if "status" in data and data["status"] not in ENROLLMENT_STATUSES:
        raise HTTPException(status_code=422, detail="Invalid status")
    if "coverage_level" in data and data["coverage_level"] not in COVERAGE_LEVELS:
        raise HTTPException(status_code=422, detail="Invalid coverage level")
    for k, v in data.items():
        setattr(e, k, v)
    await db.commit()
    await db.refresh(e)
    return await _enrollment_out(db, e)


@router.delete("/enrollments/{enrollment_id}", status_code=204)
async def delete_enrollment(
    enrollment_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _require_hr(user)
    e = await db.get(BenefitEnrollment, enrollment_id)
    if not e:
        raise HTTPException(status_code=404, detail="Enrollment not found")
    await db.delete(e)
    await db.commit()


# ---- Employee self-service ----
@router.get("/my/enrollments", response_model=list[EnrollmentOut])
async def my_enrollments(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    rows = (
        await db.execute(
            select(BenefitEnrollment)
            .where(BenefitEnrollment.user_id == user.id)
            .order_by(BenefitEnrollment.created_at.desc())
        )
    ).scalars().all()
    return [await _enrollment_out(db, e) for e in rows]


@router.get("/my/dependents", response_model=list[DependentOut])
async def my_dependents(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    rows = (
        await db.execute(
            select(Dependent).where(Dependent.user_id == user.id).order_by(Dependent.name)
        )
    ).scalars().all()
    return list(rows)


@router.post("/my/dependents", response_model=DependentOut, status_code=201)
async def add_dependent(
    body: DependentCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if body.relationship_type not in DEPENDENT_RELATIONSHIPS:
        raise HTTPException(status_code=422, detail="Invalid relationship")
    dep = Dependent(
        user_id=user.id,
        name=body.name,
        relationship_type=body.relationship_type,
        date_of_birth=body.date_of_birth,
    )
    db.add(dep)
    await db.commit()
    await db.refresh(dep)
    return dep


@router.delete("/my/dependents/{dependent_id}", status_code=204)
async def remove_dependent(
    dependent_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    dep = await db.get(Dependent, dependent_id)
    if not dep or dep.user_id != user.id:
        raise HTTPException(status_code=404, detail="Dependent not found")
    await db.delete(dep)
    await db.commit()
