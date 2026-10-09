"""Project tracker reports: burndown, velocity, workload and activity heat maps.

Read-only and visible to every project role, under the same ``/api/pm`` prefix
and ``projects`` module gate as the main tracker API.
"""
import uuid
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.core.database import get_db
from app.models.pm import PmComment, PmIssue, PmIssueHistory, PmIssueLink, PmProjectMember, PmSprint
from app.models.user import User
from app.services.people import user_names
from app.services.pm_access import require_project

router = APIRouter(prefix="/pm", tags=["project-tracker-reports"])

MAX_WEEKS = 26


def _monday(day: date) -> date:
    return day - timedelta(days=day.weekday())


def _aware(value: datetime) -> datetime:
    """Treat naive timestamps (SQLite) as UTC."""
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value


def _day(value: datetime | None) -> date | None:
    if value is None:
        return None
    return _aware(value).astimezone(timezone.utc).date()


def _weeks(start: date | None, count: int) -> list[date]:
    if not 1 <= count <= MAX_WEEKS:
        raise HTTPException(422, f"Choose between 1 and {MAX_WEEKS} weeks.")
    first = _monday(start or date.today())
    return [first + timedelta(weeks=i) for i in range(count)]


@router.get("/projects/{project_id}/links")
async def project_links(
    project_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Every issue link in the project, for drawing timeline dependencies."""
    await require_project(db, user, project_id)
    issue_ids = select(PmIssue.id).where(PmIssue.project_id == project_id)
    rows = (
        await db.scalars(
            select(PmIssueLink).where(
                or_(PmIssueLink.source_id.in_(issue_ids), PmIssueLink.target_id.in_(issue_ids))
            )
        )
    ).all()
    return [
        {"id": str(r.id), "source_id": str(r.source_id), "target_id": str(r.target_id), "link_type": r.link_type}
        for r in rows
    ]


async def _sprint_scope(db: AsyncSession, sprint: PmSprint) -> list[PmIssue]:
    """Issues in the sprint now, plus unfinished ones moved out when it closed."""
    issues = list(
        (await db.scalars(select(PmIssue).where(PmIssue.sprint_id == sprint.id))).all()
    )
    if sprint.status == "closed" and sprint.started_at:
        moves = (
            await db.execute(
                select(PmIssueHistory.issue_id, PmIssueHistory.created_at)
                .join(PmIssue, PmIssue.id == PmIssueHistory.issue_id)
                .where(
                    PmIssue.project_id == sprint.project_id,
                    PmIssueHistory.field == "sprint",
                    PmIssueHistory.old_value == sprint.name,
                )
            )
        ).all()
        # Compare in Python: timestamps from the database default and from the
        # application are not reliably comparable as stored text everywhere.
        # Database-default timestamps can be whole seconds; compare from the second.
        started = _aware(sprint.started_at).replace(microsecond=0)
        known = {i.id for i in issues}
        extra = {issue_id for issue_id, when in moves if when and _aware(when) >= started} - known
        if extra:
            issues += list((await db.scalars(select(PmIssue).where(PmIssue.id.in_(extra)))).all())
    return issues


@router.get("/projects/{project_id}/reports/burndown")
async def burndown(
    project_id: uuid.UUID,
    sprint_id: uuid.UUID | None = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Remaining story points per day of a sprint against the ideal line.

    Defaults to the active sprint, else the most recently completed one.
    Scope is the sprint's issues (including unfinished work moved out at
    completion); an issue counts as burned on the day it was resolved.
    """
    await require_project(db, user, project_id)
    return await burndown_data(db, project_id, sprint_id)


async def burndown_data(db: AsyncSession, project_id: uuid.UUID, sprint_id: uuid.UUID | None = None) -> dict:
    """Burndown for ``sprint_id``, else the active or latest completed sprint."""
    if sprint_id:
        sprint = await db.get(PmSprint, sprint_id)
        if not sprint or sprint.project_id != project_id:
            raise HTTPException(404, "Sprint not found")
    else:
        sprints = (
            await db.scalars(
                select(PmSprint).where(
                    PmSprint.project_id == project_id, PmSprint.status.in_(("active", "closed"))
                )
            )
        ).all()
        active = [s for s in sprints if s.status == "active"]
        closed = sorted(
            (s for s in sprints if s.status == "closed"),
            key=lambda s: s.completed_at or datetime.min.replace(tzinfo=timezone.utc),
        )
        sprint = active[0] if active else (closed[-1] if closed else None)
    if not sprint or sprint.status == "future" or not sprint.start_date or not sprint.end_date:
        return {"sprint": None, "total_points": 0, "days": []}
    if sprint.status == "closed" and sprint.burndown_snapshot is not None:
        return sprint.burndown_snapshot

    scope = await _sprint_scope(db, sprint)
    total = float(sum(i.story_points or 0 for i in scope))
    last = min(date.today(), _day(sprint.completed_at) or date.today())
    length = max((sprint.end_date - sprint.start_date).days, 1)
    days = []
    current = sprint.start_date
    while current <= sprint.end_date:
        burned = sum(
            i.story_points or 0 for i in scope
            if i.status == "done" and i.resolved_at and _day(i.resolved_at) <= current
        )
        elapsed = (current - sprint.start_date).days
        days.append({
            "date": current.isoformat(),
            "ideal": round(total * (1 - elapsed / length), 2),
            # Future days have no actual value yet.
            "remaining": round(total - burned, 2) if current <= last else None,
        })
        current += timedelta(days=1)
    return {
        "sprint": {
            "id": str(sprint.id), "name": sprint.name, "status": sprint.status,
            "start_date": sprint.start_date.isoformat(), "end_date": sprint.end_date.isoformat(),
        },
        "total_points": total,
        "days": days,
    }


@router.get("/projects/{project_id}/reports/velocity")
async def velocity(
    project_id: uuid.UUID,
    limit: int = Query(7, ge=1, le=20),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Committed vs completed points for the most recent closed sprints."""
    await require_project(db, user, project_id)
    return await velocity_data(db, project_id, limit)


async def velocity_data(db: AsyncSession, project_id: uuid.UUID, limit: int = 7) -> dict:
    closed = (
        await db.scalars(
            select(PmSprint).where(PmSprint.project_id == project_id, PmSprint.status == "closed")
        )
    ).all()
    recent = sorted(
        closed, key=lambda s: s.completed_at or datetime.min.replace(tzinfo=timezone.utc)
    )[-limit:]
    rows = [
        {
            "id": str(s.id), "name": s.name,
            "committed": float(s.committed_points or 0), "completed": float(s.completed_points or 0),
        }
        for s in recent
    ]
    average = round(sum(r["completed"] for r in rows) / len(rows), 1) if rows else 0
    return {"sprints": rows, "average_completed": average}


async def _member_names(db: AsyncSession, project_id: uuid.UUID, extra: set) -> dict:
    members = set(
        (
            await db.scalars(
                select(PmProjectMember.user_id).where(PmProjectMember.project_id == project_id)
            )
        ).all()
    )
    return await user_names(db, members | {u for u in extra if u})


@router.get("/projects/{project_id}/reports/workload")
async def workload(
    project_id: uuid.UUID,
    start: date | None = None,
    weeks: int = Query(8),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Story points and issue count per assignee per week.

    An issue's window runs from its start date to its due date, falling back
    to its sprint's dates. Its points are spread evenly over the weeks the
    window touches. Issues with no dates at all are reported as unscheduled.
    """
    await require_project(db, user, project_id)
    columns = _weeks(start, weeks)
    issues = (
        await db.scalars(
            select(PmIssue).where(
                PmIssue.project_id == project_id,
                PmIssue.issue_type != "epic",
                PmIssue.assignee_id.is_not(None),
            )
        )
    ).all()
    sprint_ids = {i.sprint_id for i in issues if i.sprint_id}
    sprints = {
        s.id: s for s in (await db.scalars(select(PmSprint).where(PmSprint.id.in_(sprint_ids)))).all()
    } if sprint_ids else {}
    points: dict = defaultdict(lambda: defaultdict(float))
    counts: dict = defaultdict(lambda: defaultdict(int))
    unscheduled: dict = defaultdict(int)
    for issue in issues:
        sprint = sprints.get(issue.sprint_id)
        begin = issue.start_date or (sprint.start_date if sprint else None)
        end = issue.due_date or (sprint.end_date if sprint else None)
        if not begin and not end:
            if issue.status != "done":
                unscheduled[issue.assignee_id] += 1
            continue
        begin, end = begin or end, end or begin
        if end < begin:
            begin, end = end, begin
        touched = []
        week = _monday(begin)
        while week <= end:
            touched.append(week)
            week += timedelta(weeks=1)
        share = (issue.story_points or 0) / len(touched)
        for week in touched:
            if week in columns:
                points[issue.assignee_id][week] += share
                counts[issue.assignee_id][week] += 1
    people = set(points) | set(unscheduled)
    names = await _member_names(db, project_id, people)
    rows = [
        {
            "user_id": str(uid), "name": names.get(uid, "Former member"),
            "points": [round(points[uid][w], 1) for w in columns],
            "issues": [counts[uid][w] for w in columns],
            "unscheduled": unscheduled.get(uid, 0),
        }
        for uid in sorted(names, key=lambda u: names[u].lower())
    ]
    return {"weeks": [w.isoformat() for w in columns], "people": rows}


@router.get("/projects/{project_id}/reports/activity")
async def activity(
    project_id: uuid.UUID,
    weeks: int = Query(12),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Issues created, fields changed and comments written, per person per week."""
    await require_project(db, user, project_id)
    last = _monday(date.today())
    if not 1 <= weeks <= MAX_WEEKS:
        raise HTTPException(422, f"Choose between 1 and {MAX_WEEKS} weeks.")
    columns = [last - timedelta(weeks=weeks - 1 - i) for i in range(weeks)]
    since = datetime.combine(columns[0], datetime.min.time(), tzinfo=timezone.utc)
    in_project = select(PmIssue.id).where(PmIssue.project_id == project_id)
    events: list[tuple] = []
    events += (
        await db.execute(
            select(PmIssue.created_by_id, PmIssue.created_at).where(
                PmIssue.project_id == project_id, PmIssue.created_at >= since
            )
        )
    ).all()
    events += (
        await db.execute(
            select(PmIssueHistory.actor_id, PmIssueHistory.created_at).where(
                PmIssueHistory.issue_id.in_(in_project), PmIssueHistory.created_at >= since
            )
        )
    ).all()
    events += (
        await db.execute(
            select(PmComment.author_id, PmComment.created_at).where(
                PmComment.issue_id.in_(in_project), PmComment.created_at >= since
            )
        )
    ).all()
    grid: dict = defaultdict(lambda: defaultdict(int))
    for actor, when in events:
        if not actor or not when:
            continue
        week = _monday(_day(when))
        if week in columns:
            grid[actor][week] += 1
    names = await _member_names(db, project_id, set(grid))
    rows = [
        {"user_id": str(uid), "name": names.get(uid, "Former member"), "counts": [grid[uid][w] for w in columns]}
        for uid in sorted(names, key=lambda u: names[u].lower())
    ]
    totals = [sum(row["counts"][i] for row in rows) for i in range(len(columns))]
    return {"weeks": [w.isoformat() for w in columns], "people": rows, "totals": totals}
