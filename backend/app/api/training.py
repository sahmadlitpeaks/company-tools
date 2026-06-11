"""Training / LMS: HR-managed courses, per-employee assignments, and employee
certifications with expiry tracking."""
import uuid
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.core.database import get_db
from app.core.permissions import is_hr
from app.models.training import (
    ASSIGNMENT_STATUSES,
    Certification,
    Course,
    CourseAssignment,
)
from app.models.user import User
from app.schemas.training import (
    AssignIn,
    AssignmentOut,
    CertificationCreate,
    CertificationOut,
    CourseCreate,
    CourseOut,
    CourseUpdate,
)
from app.services.notify import notify_user
from app.services.people import user_names

router = APIRouter(prefix="/training", tags=["training"])


def _require_hr(user: User) -> None:
    if not is_hr(user):
        raise HTTPException(status_code=403, detail="HR access required")


async def _course_out(db: AsyncSession, c: Course) -> CourseOut:
    count = await db.scalar(
        select(func.count(CourseAssignment.id)).where(CourseAssignment.course_id == c.id)
    )
    out = CourseOut.model_validate(c)
    out.assigned_count = count or 0
    return out


# ---- Courses (HR) ----
@router.get("/courses", response_model=list[CourseOut])
async def list_courses(
    db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)
):
    rows = (
        await db.execute(select(Course).where(Course.active.is_(True)).order_by(Course.title))
    ).scalars().all()
    return [await _course_out(db, c) for c in rows]


@router.post("/courses", response_model=CourseOut, status_code=201)
async def create_course(
    body: CourseCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _require_hr(user)
    c = Course(**body.model_dump(), created_by_id=user.id)
    db.add(c)
    await db.commit()
    await db.refresh(c)
    return await _course_out(db, c)


@router.patch("/courses/{course_id}", response_model=CourseOut)
async def update_course(
    course_id: uuid.UUID,
    body: CourseUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _require_hr(user)
    c = await db.get(Course, course_id)
    if not c:
        raise HTTPException(status_code=404, detail="Course not found")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(c, k, v)
    await db.commit()
    await db.refresh(c)
    return await _course_out(db, c)


@router.delete("/courses/{course_id}", status_code=204)
async def delete_course(
    course_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _require_hr(user)
    c = await db.get(Course, course_id)
    if c:
        await db.delete(c)
        await db.commit()


@router.post("/courses/{course_id}/assign", response_model=list[AssignmentOut])
async def assign_course(
    course_id: uuid.UUID,
    body: AssignIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if not (is_hr(user) or user.role == "manager"):
        raise HTTPException(status_code=403, detail="Managers/HR only")
    course = await db.get(Course, course_id)
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    created: list[CourseAssignment] = []
    for uid in body.user_ids:
        exists = await db.scalar(
            select(func.count(CourseAssignment.id)).where(
                CourseAssignment.course_id == course_id, CourseAssignment.user_id == uid,
                CourseAssignment.status != "completed",
            )
        )
        if exists:
            continue
        a = CourseAssignment(
            course_id=course_id, user_id=uid, due_date=body.due_date, assigned_by_id=user.id
        )
        db.add(a)
        created.append(a)
        await notify_user(
            db, user_id=uid, title="New training assigned",
            body=course.title, link="/training", category="task",
        )
    await db.commit()
    names = await user_names(db, {a.user_id for a in created})
    return [
        AssignmentOut(
            id=a.id, course_id=a.course_id, course_title=course.title, user_id=a.user_id,
            user_name=names.get(a.user_id), status=a.status, due_date=a.due_date,
            completed_at=a.completed_at,
        )
        for a in created
    ]


@router.get("/courses/{course_id}/assignments", response_model=list[AssignmentOut])
async def course_assignments(
    course_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _require_hr(user)
    course = await db.get(Course, course_id)
    rows = (
        await db.execute(
            select(CourseAssignment).where(CourseAssignment.course_id == course_id)
        )
    ).scalars().all()
    names = await user_names(db, {a.user_id for a in rows})
    return [
        AssignmentOut(
            id=a.id, course_id=a.course_id, course_title=course.title if course else None,
            user_id=a.user_id, user_name=names.get(a.user_id), status=a.status,
            due_date=a.due_date, completed_at=a.completed_at,
        )
        for a in rows
    ]


# ---- Employee self-service ----
@router.get("/my/assignments", response_model=list[AssignmentOut])
async def my_assignments(
    db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)
):
    rows = (
        await db.execute(
            select(CourseAssignment).where(CourseAssignment.user_id == user.id)
            .order_by(CourseAssignment.created_at.desc())
        )
    ).scalars().all()
    titles = {}
    if rows:
        crows = (
            await db.execute(
                select(Course.id, Course.title).where(Course.id.in_({a.course_id for a in rows}))
            )
        ).all()
        titles = {r[0]: r[1] for r in crows}
    return [
        AssignmentOut(
            id=a.id, course_id=a.course_id, course_title=titles.get(a.course_id),
            user_id=a.user_id, user_name=user.display_name, status=a.status,
            due_date=a.due_date, completed_at=a.completed_at,
        )
        for a in rows
    ]


@router.patch("/assignments/{assignment_id}", response_model=AssignmentOut)
async def update_assignment(
    assignment_id: uuid.UUID,
    status: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    a = await db.get(CourseAssignment, assignment_id)
    if not a:
        raise HTTPException(status_code=404, detail="Assignment not found")
    if a.user_id != user.id and not is_hr(user):
        raise HTTPException(status_code=403, detail="Not allowed")
    if status not in ASSIGNMENT_STATUSES:
        raise HTTPException(status_code=422, detail="Invalid status")
    a.status = status
    a.completed_at = datetime.now(timezone.utc) if status == "completed" else None
    await db.commit()
    await db.refresh(a)
    course = await db.get(Course, a.course_id)
    return AssignmentOut(
        id=a.id, course_id=a.course_id, course_title=course.title if course else None,
        user_id=a.user_id, user_name=user.display_name, status=a.status,
        due_date=a.due_date, completed_at=a.completed_at,
    )


# ---- Certifications ----
def _cert_out(c: Certification, name: str | None) -> CertificationOut:
    out = CertificationOut.model_validate(c)
    out.user_name = name
    if c.expiry_date:
        delta = (c.expiry_date - date.today()).days
        out.days_to_expiry = delta
        out.expired = delta < 0
    return out


@router.get("/my/certifications", response_model=list[CertificationOut])
async def my_certifications(
    db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)
):
    rows = (
        await db.execute(
            select(Certification).where(Certification.user_id == user.id).order_by(Certification.name)
        )
    ).scalars().all()
    return [_cert_out(c, user.display_name) for c in rows]


@router.post("/my/certifications", response_model=CertificationOut, status_code=201)
async def add_certification(
    body: CertificationCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    c = Certification(user_id=user.id, **body.model_dump())
    db.add(c)
    await db.commit()
    await db.refresh(c)
    return _cert_out(c, user.display_name)


@router.delete("/my/certifications/{cert_id}", status_code=204)
async def delete_certification(
    cert_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    c = await db.get(Certification, cert_id)
    if not c or (c.user_id != user.id and not is_hr(user)):
        raise HTTPException(status_code=404, detail="Certification not found")
    await db.delete(c)
    await db.commit()


@router.get("/certifications/expiring", response_model=list[CertificationOut])
async def expiring_certifications(
    days: int = 60,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Company-wide certifications expiring within N days (HR view)."""
    _require_hr(user)
    cutoff = date.today() + timedelta(days=days)
    rows = (
        await db.execute(
            select(Certification)
            .where(Certification.expiry_date.is_not(None), Certification.expiry_date <= cutoff)
            .order_by(Certification.expiry_date)
        )
    ).scalars().all()
    names = await user_names(db, {c.user_id for c in rows})
    return [_cert_out(c, names.get(c.user_id)) for c in rows]
