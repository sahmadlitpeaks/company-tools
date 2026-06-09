"""Light performance management: goals, review cycles and reviews.

Goals are visible to the employee, their reporting-line manager and admins/HR.
Review cycles are admin/HR-managed; a review is written by the subject's
reviewer (manager) or HR. The subject can read their own submitted reviews.
"""
import uuid
from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.core.database import get_db
from app.models.hr import (
    GOAL_STATUSES,
    REVIEW_STATUSES,
    PerformanceGoal,
    Review,
    ReviewCycle,
)
from app.models.user import User
from app.schemas.performance import (
    CycleCreate,
    CycleOut,
    CycleUpdate,
    GoalCreate,
    GoalOut,
    GoalUpdate,
    ReviewCreate,
    ReviewOut,
    ReviewUpdate,
)
from app.services.activity import record
from app.services.people import user_names

router = APIRouter(prefix="/performance", tags=["hr"])


def _is_hr(user: User) -> bool:
    return user.is_admin or "hr" in user.effective_permissions


async def _can_view_person(db: AsyncSession, viewer: User, target_id: uuid.UUID) -> bool:
    if viewer.id == target_id or _is_hr(viewer):
        return True
    target = await db.get(User, target_id)
    return bool(target and target.manager_id == viewer.id)


# ---- Goals ---------------------------------------------------------------
@router.get("/goals/by-user/{user_id}", response_model=list[GoalOut])
async def list_goals(
    user_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    viewer: User = Depends(get_current_user),
):
    if not await _can_view_person(db, viewer, user_id):
        raise HTTPException(status_code=403, detail="Not allowed")
    return (
        await db.execute(
            select(PerformanceGoal)
            .where(PerformanceGoal.user_id == user_id)
            .order_by(PerformanceGoal.created_at.desc())
        )
    ).scalars().all()


@router.post("/goals/by-user/{user_id}", response_model=GoalOut, status_code=201)
async def create_goal(
    user_id: uuid.UUID,
    payload: GoalCreate,
    db: AsyncSession = Depends(get_db),
    viewer: User = Depends(get_current_user),
):
    if not await _can_view_person(db, viewer, user_id):
        raise HTTPException(status_code=403, detail="Not allowed")
    if not payload.title.strip():
        raise HTTPException(status_code=422, detail="Title is required")
    if payload.status not in GOAL_STATUSES:
        raise HTTPException(status_code=422, detail="Invalid status")
    goal = PerformanceGoal(
        user_id=user_id,
        title=payload.title.strip(),
        description=payload.description,
        status=payload.status,
        progress=max(0, min(100, payload.progress)),
        due_date=payload.due_date,
        created_by_id=viewer.id,
    )
    db.add(goal)
    await db.commit()
    await db.refresh(goal)
    return goal


@router.patch("/goals/{goal_id}", response_model=GoalOut)
async def update_goal(
    goal_id: uuid.UUID,
    payload: GoalUpdate,
    db: AsyncSession = Depends(get_db),
    viewer: User = Depends(get_current_user),
):
    goal = await db.get(PerformanceGoal, goal_id)
    if not goal:
        raise HTTPException(status_code=404, detail="Goal not found")
    if not await _can_view_person(db, viewer, goal.user_id):
        raise HTTPException(status_code=403, detail="Not allowed")
    data = payload.model_dump(exclude_unset=True)
    if "status" in data and data["status"] not in GOAL_STATUSES:
        raise HTTPException(status_code=422, detail="Invalid status")
    if "progress" in data and data["progress"] is not None:
        data["progress"] = max(0, min(100, data["progress"]))
    for field, value in data.items():
        setattr(goal, field, value)
    await db.commit()
    await db.refresh(goal)
    return goal


@router.delete("/goals/{goal_id}", status_code=204)
async def delete_goal(
    goal_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    viewer: User = Depends(get_current_user),
):
    goal = await db.get(PerformanceGoal, goal_id)
    if not goal:
        return
    if not await _can_view_person(db, viewer, goal.user_id):
        raise HTTPException(status_code=403, detail="Not allowed")
    await db.delete(goal)
    await db.commit()


# ---- Review cycles (admin/HR) --------------------------------------------
@router.get("/cycles", response_model=list[CycleOut])
async def list_cycles(
    db: AsyncSession = Depends(get_db), viewer: User = Depends(get_current_user)
):
    if not _is_hr(viewer):
        raise HTTPException(status_code=403, detail="Not allowed")
    cycles = (
        await db.execute(select(ReviewCycle).order_by(ReviewCycle.created_at.desc()))
    ).scalars().all()
    counts = dict(
        (
            await db.execute(
                select(Review.cycle_id, func.count()).group_by(Review.cycle_id)
            )
        ).all()
    )
    submitted = dict(
        (
            await db.execute(
                select(Review.cycle_id, func.count())
                .where(Review.status == "submitted")
                .group_by(Review.cycle_id)
            )
        ).all()
    )
    out = []
    for c in cycles:
        item = CycleOut.model_validate(c)
        item.review_count = int(counts.get(c.id, 0))
        item.submitted_count = int(submitted.get(c.id, 0))
        out.append(item)
    return out


@router.post("/cycles", response_model=CycleOut, status_code=201)
async def create_cycle(
    payload: CycleCreate,
    db: AsyncSession = Depends(get_db),
    viewer: User = Depends(get_current_user),
):
    if not _is_hr(viewer):
        raise HTTPException(status_code=403, detail="Not allowed")
    if not payload.name.strip():
        raise HTTPException(status_code=422, detail="Name is required")
    cycle = ReviewCycle(**payload.model_dump())
    db.add(cycle)
    await db.commit()
    await db.refresh(cycle)
    return CycleOut.model_validate(cycle)


@router.patch("/cycles/{cycle_id}", response_model=CycleOut)
async def update_cycle(
    cycle_id: uuid.UUID,
    payload: CycleUpdate,
    db: AsyncSession = Depends(get_db),
    viewer: User = Depends(get_current_user),
):
    if not _is_hr(viewer):
        raise HTTPException(status_code=403, detail="Not allowed")
    cycle = await db.get(ReviewCycle, cycle_id)
    if not cycle:
        raise HTTPException(status_code=404, detail="Cycle not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(cycle, field, value)
    await db.commit()
    await db.refresh(cycle)
    return CycleOut.model_validate(cycle)


# ---- Reviews -------------------------------------------------------------
async def _serialize_review(db: AsyncSession, r: Review, names: dict, cycles: dict) -> ReviewOut:
    out = ReviewOut.model_validate(r)
    out.user_name = names.get(r.user_id)
    out.reviewer_name = names.get(r.reviewer_id) if r.reviewer_id else None
    out.cycle_name = cycles.get(r.cycle_id)
    return out


@router.get("/reviews", response_model=list[ReviewOut])
async def list_reviews(
    cycle_id: uuid.UUID | None = None,
    user_id: uuid.UUID | None = None,
    scope: str = "to_review",  # to_review | mine | all
    db: AsyncSession = Depends(get_db),
    viewer: User = Depends(get_current_user),
):
    stmt = select(Review).order_by(Review.created_at.desc())
    if cycle_id:
        stmt = stmt.where(Review.cycle_id == cycle_id)
    if user_id:
        if not await _can_view_person(db, viewer, user_id):
            raise HTTPException(status_code=403, detail="Not allowed")
        stmt = stmt.where(Review.user_id == user_id)
    elif scope == "mine":
        # Reviews about me that have been submitted.
        stmt = stmt.where(Review.user_id == viewer.id, Review.status == "submitted")
    elif scope == "to_review":
        stmt = stmt.where(Review.reviewer_id == viewer.id)
    elif scope == "all":
        if not _is_hr(viewer):
            raise HTTPException(status_code=403, detail="Not allowed")
    reviews = (await db.execute(stmt)).scalars().all()
    names = await user_names(
        db, {r.user_id for r in reviews} | {r.reviewer_id for r in reviews}
    )
    cyc_rows = (await db.execute(select(ReviewCycle.id, ReviewCycle.name))).all()
    cycles = {r[0]: r[1] for r in cyc_rows}
    return [await _serialize_review(db, r, names, cycles) for r in reviews]


@router.post("/reviews", response_model=ReviewOut, status_code=201)
async def create_review(
    payload: ReviewCreate,
    db: AsyncSession = Depends(get_db),
    viewer: User = Depends(get_current_user),
):
    cycle = await db.get(ReviewCycle, payload.cycle_id)
    if not cycle:
        raise HTTPException(status_code=404, detail="Cycle not found")
    subject = await db.get(User, payload.user_id)
    if not subject:
        raise HTTPException(status_code=404, detail="User not found")
    # The reviewer defaults to the subject's manager; HR may assign anyone.
    reviewer_id = payload.reviewer_id or subject.manager_id or viewer.id
    if not (_is_hr(viewer) or viewer.id == reviewer_id or viewer.id == subject.manager_id):
        raise HTTPException(status_code=403, detail="Not allowed")
    existing = (
        await db.execute(
            select(Review).where(
                Review.cycle_id == payload.cycle_id, Review.user_id == payload.user_id
            )
        )
    ).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=409, detail="Review already exists for this cycle")
    review = Review(
        cycle_id=payload.cycle_id, user_id=payload.user_id, reviewer_id=reviewer_id
    )
    db.add(review)
    await db.commit()
    await db.refresh(review)
    names = await user_names(db, {review.user_id, review.reviewer_id})
    return await _serialize_review(db, review, names, {cycle.id: cycle.name})


@router.patch("/reviews/{review_id}", response_model=ReviewOut)
async def update_review(
    review_id: uuid.UUID,
    payload: ReviewUpdate,
    db: AsyncSession = Depends(get_db),
    viewer: User = Depends(get_current_user),
):
    review = await db.get(Review, review_id)
    if not review:
        raise HTTPException(status_code=404, detail="Review not found")
    if not (_is_hr(viewer) or viewer.id == review.reviewer_id):
        raise HTTPException(status_code=403, detail="Only the reviewer or HR can edit")
    data = payload.model_dump(exclude_unset=True)
    if "status" in data and data["status"] not in REVIEW_STATUSES:
        raise HTTPException(status_code=422, detail="Invalid status")
    if "rating" in data and data["rating"] is not None and not (1 <= data["rating"] <= 5):
        raise HTTPException(status_code=422, detail="Rating must be 1–5")
    for field, value in data.items():
        setattr(review, field, value)
    if review.status == "submitted" and not review.submitted_at:
        review.submitted_at = date.today()
    record(
        db, user=viewer, action="updated", entity_type="user", entity_id=review.user_id,
        summary="Updated performance review",
    )
    await db.commit()
    await db.refresh(review)
    names = await user_names(db, {review.user_id, review.reviewer_id})
    cyc = await db.get(ReviewCycle, review.cycle_id)
    return await _serialize_review(db, review, names, {review.cycle_id: cyc.name if cyc else None})
