"""HR dashboard — a single overview for HR staff (gated by the ``hr`` module)."""
from datetime import date, timedelta

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.core.database import get_db
from app.models.department import Department
from app.models.hr import HrDocument, ReviewCycle
from app.models.people import OnboardingJourney
from app.models.user import User
from app.models.workplace import ApprovalRequest
from app.schemas.hr_overview import CountItem, HrOverview, JoinerItem

router = APIRouter(prefix="/hr", tags=["hr"])


@router.get("/overview", response_model=HrOverview)
async def overview(
    db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)
):
    today = date.today()
    soon_60 = today + timedelta(days=60)
    soon_30 = today + timedelta(days=30)
    recent_30 = today - timedelta(days=30)

    active = (
        await db.execute(select(User).where(User.status == "active"))
    ).scalars().all()
    out = HrOverview(headcount=len(active))

    # Approved leave covering today / pending leave requests.
    leaves = (
        await db.execute(
            select(ApprovalRequest).where(ApprovalRequest.type == "leave")
        )
    ).scalars().all()
    for lv in leaves:
        if lv.status == "approved" and lv.start_date:
            end = lv.end_date or lv.start_date
            if lv.start_date <= today <= end:
                out.on_leave_today += 1
        elif lv.status == "pending":
            out.pending_leave += 1

    out.docs_expiring = (
        await db.scalar(
            select(func.count(HrDocument.id)).where(
                HrDocument.expiry_date.is_not(None), HrDocument.expiry_date <= soon_60
            )
        )
    ) or 0
    out.open_review_cycles = (
        await db.scalar(select(func.count(ReviewCycle.id)).where(ReviewCycle.status == "open"))
    ) or 0
    out.open_journeys = (
        await db.scalar(
            select(func.count(OnboardingJourney.id)).where(
                OnboardingJourney.status == "in_progress"
            )
        )
    ) or 0

    # Department + employment-type breakdowns and date-driven lists.
    dept_rows = (await db.execute(select(Department.id, Department.name))).all()
    dept_names = {r[0]: r[1] for r in dept_rows}
    by_dept: dict[str, int] = {}
    by_type: dict[str, int] = {}
    for u in active:
        dlabel = dept_names.get(u.department_id, "Unassigned")
        by_dept[dlabel] = by_dept.get(dlabel, 0) + 1
        tlabel = (u.employment_type or "unspecified").replace("_", " ")
        by_type[tlabel] = by_type.get(tlabel, 0) + 1
        if u.contract_end_date and today <= u.contract_end_date <= soon_60:
            out.contracts_expiring += 1
        if u.probation_end_date and today <= u.probation_end_date <= soon_30:
            out.probation_ending += 1

    out.by_department = [
        CountItem(label=k, count=v)
        for k, v in sorted(by_dept.items(), key=lambda kv: kv[1], reverse=True)
    ]
    out.by_employment_type = [
        CountItem(label=k, count=v)
        for k, v in sorted(by_type.items(), key=lambda kv: kv[1], reverse=True)
    ]

    joiners = sorted(
        (u for u in active if u.hire_date), key=lambda u: u.hire_date, reverse=True
    )
    out.recent_joiners = [
        JoinerItem(id=u.id, name=u.display_name, job_title=u.job_title, hire_date=u.hire_date)
        for u in joiners
        if recent_30 <= u.hire_date <= today
    ][:8]
    out.upcoming_joiners = [
        JoinerItem(id=u.id, name=u.display_name, job_title=u.job_title, hire_date=u.hire_date)
        for u in sorted((u for u in active if u.hire_date and u.hire_date > today), key=lambda u: u.hire_date)
    ][:8]
    return out
