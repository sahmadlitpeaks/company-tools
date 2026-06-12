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
from app.services.notify import notify_user
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


# ==========================================================================
# Performance depth: 360 feedback, 1:1s, continuous feedback
# ==========================================================================
from datetime import datetime, timezone  # noqa: E402

from app.models.hr import ReviewCycle as _Cycle  # noqa: E402,F401
from app.models.performance import (  # noqa: E402
    FEEDBACK_RELATIONS,
    ONE_ON_ONE_STATUSES,
    ContinuousFeedback,
    OneOnOne,
    ReviewFeedback,
)
from app.schemas.performance import (  # noqa: E402
    ContinuousFeedbackIn,
    ContinuousFeedbackOut,
    FeedbackRequestIn,
    FeedbackSubmitIn,
    OneOnOneCreate,
    OneOnOneOut,
    OneOnOneUpdate,
    ReviewFeedbackOut,
)


async def _is_manager_of(db: AsyncSession, viewer: User, target_id: uuid.UUID) -> bool:
    target = await db.get(User, target_id)
    return bool(target and target.manager_id == viewer.id)


# ---- 360 feedback on reviews ---------------------------------------------
@router.get("/reviews/{review_id}/feedback", response_model=list[ReviewFeedbackOut])
async def list_review_feedback(
    review_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    viewer: User = Depends(get_current_user),
):
    review = await db.get(Review, review_id)
    if not review:
        raise HTTPException(status_code=404, detail="Review not found")
    # The reviewer, HR and the subject's manager can see all 360 inputs.
    if not (_is_hr(viewer) or review.reviewer_id == viewer.id
            or await _is_manager_of(db, viewer, review.user_id)):
        raise HTTPException(status_code=403, detail="Not allowed")
    rows = (
        await db.execute(
            select(ReviewFeedback).where(ReviewFeedback.review_id == review_id)
        )
    ).scalars().all()
    names = await user_names(db, {r.author_id for r in rows})
    return [
        ReviewFeedbackOut(
            id=r.id, review_id=r.review_id, author_id=r.author_id,
            author_name=names.get(r.author_id), relation=r.relation, status=r.status,
            rating=r.rating, strengths=r.strengths, improvements=r.improvements,
            submitted_at=r.submitted_at,
        )
        for r in rows
    ]


@router.post("/reviews/{review_id}/feedback", response_model=ReviewFeedbackOut, status_code=201)
async def request_review_feedback(
    review_id: uuid.UUID,
    body: FeedbackRequestIn,
    db: AsyncSession = Depends(get_db),
    viewer: User = Depends(get_current_user),
):
    review = await db.get(Review, review_id)
    if not review:
        raise HTTPException(status_code=404, detail="Review not found")
    if not (_is_hr(viewer) or review.reviewer_id == viewer.id):
        raise HTTPException(status_code=403, detail="Only the reviewer or HR can request feedback")
    if body.relation not in FEEDBACK_RELATIONS:
        raise HTTPException(status_code=422, detail="Invalid relation")
    if not await db.get(User, body.author_id):
        raise HTTPException(status_code=404, detail="Author not found")
    fb = ReviewFeedback(
        review_id=review_id, author_id=body.author_id, relation=body.relation, status="requested"
    )
    db.add(fb)
    await notify_user(
        db, user_id=body.author_id,
        title="360 feedback requested",
        body="You've been asked to give feedback for a performance review.",
        link="/performance", category="performance",
    )
    await db.commit()
    await db.refresh(fb)
    names = await user_names(db, {fb.author_id})
    return ReviewFeedbackOut(
        id=fb.id, review_id=fb.review_id, author_id=fb.author_id,
        author_name=names.get(fb.author_id), relation=fb.relation, status=fb.status,
        rating=fb.rating, strengths=fb.strengths, improvements=fb.improvements,
    )


@router.get("/feedback/mine", response_model=list[ReviewFeedbackOut])
async def my_feedback_requests(
    db: AsyncSession = Depends(get_db),
    viewer: User = Depends(get_current_user),
):
    """360 feedback the current user has been asked to provide."""
    rows = (
        await db.execute(
            select(ReviewFeedback)
            .where(ReviewFeedback.author_id == viewer.id, ReviewFeedback.status == "requested")
            .order_by(ReviewFeedback.created_at)
        )
    ).scalars().all()
    out: list[ReviewFeedbackOut] = []
    for r in rows:
        review = await db.get(Review, r.review_id)
        subject = await db.get(User, review.user_id) if review else None
        cycle = await db.get(ReviewCycle, review.cycle_id) if review else None
        out.append(ReviewFeedbackOut(
            id=r.id, review_id=r.review_id, author_id=r.author_id, relation=r.relation,
            status=r.status, rating=r.rating, strengths=r.strengths, improvements=r.improvements,
            submitted_at=r.submitted_at,
            subject_name=subject.display_name if subject else None,
            cycle_name=cycle.name if cycle else None,
        ))
    return out


@router.patch("/feedback/{feedback_id}", response_model=ReviewFeedbackOut)
async def submit_review_feedback(
    feedback_id: uuid.UUID,
    body: FeedbackSubmitIn,
    db: AsyncSession = Depends(get_db),
    viewer: User = Depends(get_current_user),
):
    fb = await db.get(ReviewFeedback, feedback_id)
    if not fb:
        raise HTTPException(status_code=404, detail="Feedback not found")
    if fb.author_id != viewer.id:
        raise HTTPException(status_code=403, detail="Only the assigned author can submit")
    fb.rating = body.rating
    fb.strengths = body.strengths
    fb.improvements = body.improvements
    fb.status = "submitted"
    fb.submitted_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(fb)
    names = await user_names(db, {fb.author_id})
    return ReviewFeedbackOut(
        id=fb.id, review_id=fb.review_id, author_id=fb.author_id,
        author_name=names.get(fb.author_id), relation=fb.relation, status=fb.status,
        rating=fb.rating, strengths=fb.strengths, improvements=fb.improvements,
        submitted_at=fb.submitted_at,
    )


# ---- 1:1 meetings --------------------------------------------------------
def _agenda_list(raw) -> list:
    return raw or []


async def _one_on_one_out(db: AsyncSession, o: OneOnOne) -> OneOnOneOut:
    names = await user_names(db, {o.manager_id, o.employee_id})
    return OneOnOneOut(
        id=o.id, manager_id=o.manager_id, manager_name=names.get(o.manager_id),
        employee_id=o.employee_id, employee_name=names.get(o.employee_id),
        scheduled_at=o.scheduled_at, status=o.status,
        agenda=_agenda_list(o.agenda), shared_notes=o.shared_notes,
    )


@router.get("/one-on-ones", response_model=list[OneOnOneOut])
async def list_one_on_ones(
    db: AsyncSession = Depends(get_db),
    viewer: User = Depends(get_current_user),
):
    """1:1s where the viewer is the manager or the employee."""
    rows = (
        await db.execute(
            select(OneOnOne)
            .where((OneOnOne.manager_id == viewer.id) | (OneOnOne.employee_id == viewer.id))
            .order_by(OneOnOne.scheduled_at.desc())
        )
    ).scalars().all()
    return [await _one_on_one_out(db, o) for o in rows]


@router.post("/one-on-ones", response_model=OneOnOneOut, status_code=201)
async def create_one_on_one(
    body: OneOnOneCreate,
    db: AsyncSession = Depends(get_db),
    viewer: User = Depends(get_current_user),
):
    employee = await db.get(User, body.employee_id)
    if not employee:
        raise HTTPException(status_code=404, detail="Employee not found")
    # The viewer must manage the employee (or be HR).
    if not (_is_hr(viewer) or employee.manager_id == viewer.id):
        raise HTTPException(status_code=403, detail="Only the manager or HR can schedule a 1:1")
    o = OneOnOne(
        manager_id=viewer.id, employee_id=body.employee_id, scheduled_at=body.scheduled_at,
        agenda=[a.model_dump() for a in body.agenda], shared_notes=body.shared_notes,
    )
    db.add(o)
    await notify_user(
        db, user_id=body.employee_id,
        title="1:1 scheduled",
        body=f"{viewer.display_name or viewer.email} scheduled a 1:1 with you.",
        link="/performance", category="performance",
    )
    await db.commit()
    await db.refresh(o)
    return await _one_on_one_out(db, o)


@router.patch("/one-on-ones/{meeting_id}", response_model=OneOnOneOut)
async def update_one_on_one(
    meeting_id: uuid.UUID,
    body: OneOnOneUpdate,
    db: AsyncSession = Depends(get_db),
    viewer: User = Depends(get_current_user),
):
    o = await db.get(OneOnOne, meeting_id)
    if not o:
        raise HTTPException(status_code=404, detail="1:1 not found")
    if viewer.id not in (o.manager_id, o.employee_id) and not _is_hr(viewer):
        raise HTTPException(status_code=403, detail="Not allowed")
    data = body.model_dump(exclude_unset=True)
    if "status" in data and data["status"] not in ONE_ON_ONE_STATUSES:
        raise HTTPException(status_code=422, detail="Invalid status")
    if "agenda" in data and data["agenda"] is not None:
        o.agenda = data.pop("agenda")
    for k, v in data.items():
        setattr(o, k, v)
    await db.commit()
    await db.refresh(o)
    return await _one_on_one_out(db, o)


# ---- Continuous (private) feedback ---------------------------------------
@router.post("/continuous-feedback", response_model=ContinuousFeedbackOut, status_code=201)
async def give_continuous_feedback(
    body: ContinuousFeedbackIn,
    db: AsyncSession = Depends(get_db),
    viewer: User = Depends(get_current_user),
):
    if body.to_user_id == viewer.id:
        raise HTTPException(status_code=422, detail="You can't give yourself feedback")
    if not await db.get(User, body.to_user_id):
        raise HTTPException(status_code=404, detail="Recipient not found")
    if not body.body.strip():
        raise HTTPException(status_code=422, detail="Feedback body is required")
    fb = ContinuousFeedback(from_user_id=viewer.id, to_user_id=body.to_user_id, body=body.body.strip())
    db.add(fb)
    await notify_user(
        db, user_id=body.to_user_id,
        title="You received feedback",
        body="A colleague shared private feedback with you.",
        link="/performance", category="performance",
    )
    await db.commit()
    await db.refresh(fb)
    names = await user_names(db, {viewer.id, body.to_user_id})
    return ContinuousFeedbackOut(
        id=fb.id, from_user_id=fb.from_user_id, from_name=names.get(viewer.id),
        to_user_id=fb.to_user_id, to_name=names.get(body.to_user_id), body=fb.body,
        created_at=fb.created_at,
    )


@router.get("/continuous-feedback/about/{user_id}", response_model=list[ContinuousFeedbackOut])
async def feedback_about(
    user_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    viewer: User = Depends(get_current_user),
):
    """Private feedback about a person — visible to them, their manager and HR."""
    if not await _can_view_person(db, viewer, user_id):
        raise HTTPException(status_code=403, detail="Not allowed")
    rows = (
        await db.execute(
            select(ContinuousFeedback)
            .where(ContinuousFeedback.to_user_id == user_id)
            .order_by(ContinuousFeedback.created_at.desc())
        )
    ).scalars().all()
    names = await user_names(db, {r.from_user_id for r in rows} | {user_id})
    return [
        ContinuousFeedbackOut(
            id=r.id, from_user_id=r.from_user_id, from_name=names.get(r.from_user_id),
            to_user_id=r.to_user_id, to_name=names.get(user_id), body=r.body,
            created_at=r.created_at,
        )
        for r in rows
    ]
