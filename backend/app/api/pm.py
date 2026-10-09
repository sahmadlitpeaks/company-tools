"""Project tracker API (Jira-style projects, issues, comments and history).

Mounted under ``/api/pm`` behind the ``projects`` module. Every route also
checks the caller's role on the specific project (see services/pm_access.py).
"""
import re
import uuid
from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import case, delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.core.database import get_db
from app.models.pm import (
    ISSUE_PRIORITIES,
    ISSUE_STATUSES,
    ISSUE_TYPES,
    SPRINTABLE_TYPES,
    PROJECT_ROLES,
    PmComment,
    PmIssue,
    PmIssueHistory,
    PmIssueLink,
    PmIssueWatcher,
    PmProject,
    PmProjectMember,
    PmSprint,
)
from app.models.user import User
from app.models.workplace import Attachment
from app.schemas.pm import (
    PmCommentIn,
    PmCommentOut,
    PmHistoryOut,
    PmIssueCreate,
    PmIssueDetail,
    PmIssueOut,
    PmIssueRef,
    PmIssueUpdate,
    PmLinkCreate,
    PmLinkOut,
    PmMemberIn,
    PmMemberOut,
    PmMemberUpdate,
    PmPersonOut,
    PmProjectCreate,
    PmProjectOut,
    PmProjectUpdate,
    PmSprintComplete,
    PmSprintCreate,
    PmSprintOut,
    PmSprintStart,
    PmSprintUpdate,
    PmWatcherIn,
    PmWatcherOut,
)
from app.services.activity import record
from app.services.notify import notify_user
from app.services.people import user_names
from app.services.pm_access import (
    ensure_writable as _ensure_writable,
    member_ids,
    require_project,
    role_at_least,
    visible_project_ids,
)
from app.services.storage import absolute_path

router = APIRouter(prefix="/pm", tags=["project-tracker"])

KEY_RE = re.compile(r"^[A-Z][A-Z0-9]{1,9}$")
ISSUE_KEY_RE = re.compile(r"^([A-Z][A-Z0-9]{1,9})-(\d+)$")
# Hierarchy level: an epic holds standard issues, which hold sub-tasks.
LEVEL = {"epic": 0, "story": 1, "task": 1, "bug": 1, "subtask": 2}
MAX_LABELS = 20


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _key(project: PmProject, number: int) -> str:
    return f"{project.key}-{number}"


def _ref(issue: PmIssue, project: PmProject) -> PmIssueRef:
    return PmIssueRef(
        id=issue.id, key=_key(project, issue.number), summary=issue.summary,
        issue_type=issue.issue_type, status=issue.status,
    )


def _link(project: PmProject, issue: PmIssue) -> str:
    return f"/projects/{project.key}?issue={_key(project, issue.number)}"


# ---------------------------------------------------------------- projects
async def _project_by_ref(db: AsyncSession, ref: str) -> PmProject | None:
    try:
        return await db.get(PmProject, uuid.UUID(ref))
    except ValueError:
        return await db.scalar(select(PmProject).where(PmProject.key == ref.upper()))


async def _project_outs(
    db: AsyncSession, user: User, projects: list[PmProject]
) -> list[PmProjectOut]:
    if not projects:
        return []
    ids = [p.id for p in projects]
    counts = {
        row[0]: (int(row[1]), int(row[2]))
        for row in (
            await db.execute(
                select(
                    PmIssue.project_id,
                    func.count(PmIssue.id),
                    func.coalesce(func.sum(case((PmIssue.status == "done", 1), else_=0)), 0),
                )
                .where(PmIssue.project_id.in_(ids), PmIssue.issue_type != "epic")
                .group_by(PmIssue.project_id)
            )
        ).all()
    }
    overdue = {
        row[0]: int(row[1])
        for row in (
            await db.execute(
                select(PmIssue.project_id, func.count(PmIssue.id))
                .where(
                    PmIssue.project_id.in_(ids), PmIssue.issue_type != "epic",
                    PmIssue.status != "done", PmIssue.due_date < date.today(),
                )
                .group_by(PmIssue.project_id)
            )
        ).all()
    }
    members = {
        row[0]: int(row[1])
        for row in (
            await db.execute(
                select(PmProjectMember.project_id, func.count())
                .where(PmProjectMember.project_id.in_(ids))
                .group_by(PmProjectMember.project_id)
            )
        ).all()
    }
    roles = dict(
        (
            await db.execute(
                select(PmProjectMember.project_id, PmProjectMember.role).where(
                    PmProjectMember.project_id.in_(ids), PmProjectMember.user_id == user.id
                )
            )
        ).all()
    )
    names = await user_names(db, {p.lead_id for p in projects})
    outs = []
    for project in projects:
        out = PmProjectOut.model_validate(project)
        out.lead_name = names.get(project.lead_id) if project.lead_id else None
        out.my_role = "admin" if user.is_admin else roles.get(project.id)
        out.issue_count, out.done_count = counts.get(project.id, (0, 0))
        out.member_count = members.get(project.id, 0)
        out.overdue_count = overdue.get(project.id, 0)
        out.health = _health(project, out.issue_count - out.done_count, out.overdue_count)
        outs.append(out)
    return outs


def _health(project: PmProject, open_count: int, overdue_count: int) -> str:
    """on_track | at_risk | late, from the target date and overdue issues."""
    if project.target_date and project.target_date < date.today() and open_count:
        return "late"
    if overdue_count:
        return "at_risk"
    return "on_track"


async def _active_user(db: AsyncSession, user_id: uuid.UUID) -> User:
    person = await db.get(User, user_id)
    if not person or not person.is_active or person.status != "active":
        raise HTTPException(422, "Choose an active team member.")
    return person


def _check_dates(start, end, label="Target date"):
    if start and end and end < start:
        raise HTTPException(422, f"{label} must be on or after the start date.")


@router.get("/projects", response_model=list[PmProjectOut])
async def list_projects(
    status: str = Query("active", description="active | archived | all"),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    stmt = select(PmProject).order_by(PmProject.name)
    if status != "all":
        stmt = stmt.where(PmProject.status == status)
    visible = await visible_project_ids(db, user)
    if visible is not None:
        if not visible:
            return []
        stmt = stmt.where(PmProject.id.in_(visible))
    return await _project_outs(db, user, list((await db.scalars(stmt)).all()))


@router.post("/projects", response_model=PmProjectOut, status_code=201)
async def create_project(
    payload: PmProjectCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if not user.is_admin:
        raise HTTPException(403, "Only administrators can create projects")
    key = payload.key.strip().upper()
    if not KEY_RE.match(key):
        raise HTTPException(
            422, "Project key must be 2-10 letters or digits and start with a letter."
        )
    if await db.scalar(select(PmProject.id).where(PmProject.key == key)):
        raise HTTPException(409, f"Project key {key} is already in use.")
    _check_dates(payload.start_date, payload.target_date)
    lead_id = payload.lead_id or user.id
    await _active_user(db, lead_id)
    project = PmProject(
        key=key,
        name=payload.name.strip(),
        description=payload.description,
        lead_id=lead_id,
        start_date=payload.start_date,
        target_date=payload.target_date,
        created_by_id=user.id,
        issue_seq=0,
    )
    db.add(project)
    await db.flush()
    # The lead administers the project; platform admins already see it.
    db.add(PmProjectMember(project_id=project.id, user_id=lead_id, role="admin"))
    record(
        db, user=user, action="created", entity_type="pm_project", entity_id=project.id,
        summary=f"{user.display_name or user.email} created project {key} '{project.name}'",
    )
    await db.commit()
    await db.refresh(project)
    return (await _project_outs(db, user, [project]))[0]


@router.get("/projects/{ref}", response_model=PmProjectOut)
async def get_project(
    ref: str, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)
):
    project = await _project_by_ref(db, ref)
    if not project:
        raise HTTPException(404, "Project not found")
    await require_project(db, user, project.id)
    return (await _project_outs(db, user, [project]))[0]


@router.patch("/projects/{project_id}", response_model=PmProjectOut)
async def update_project(
    project_id: uuid.UUID,
    payload: PmProjectUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    project, _ = await require_project(db, user, project_id, "admin", for_update=True)
    data = payload.model_dump(exclude_unset=True)
    if "name" in data and not (data["name"] or "").strip():
        raise HTTPException(422, "Enter a project name.")
    if "status" in data and data["status"] not in ("active", "archived"):
        raise HTTPException(422, "Invalid project status")
    if data.get("lead_id"):
        await _active_user(db, data["lead_id"])
    if data.get("sprints_enabled") is None:
        data.pop("sprints_enabled", None)
    elif not data["sprints_enabled"] and await _active_sprint(db, project.id):
        raise HTTPException(409, "Complete the active sprint before switching sprints off.")
    _check_dates(data.get("start_date", project.start_date), data.get("target_date", project.target_date))
    for field, value in data.items():
        setattr(project, field, value.strip() if field == "name" else value)
    if data.get("lead_id"):
        membership = await db.scalar(
            select(PmProjectMember).where(
                PmProjectMember.project_id == project.id,
                PmProjectMember.user_id == data["lead_id"],
            )
        )
        if membership:
            membership.role = "admin"
        else:
            db.add(PmProjectMember(project_id=project.id, user_id=data["lead_id"], role="admin"))
    await db.commit()
    await db.refresh(project)
    return (await _project_outs(db, user, [project]))[0]


# ----------------------------------------------------------------- members
@router.get("/projects/{project_id}/members", response_model=list[PmMemberOut])
async def list_members(
    project_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await require_project(db, user, project_id)
    rows = (
        await db.execute(
            select(PmProjectMember.user_id, PmProjectMember.role, User.display_name, User.email)
            .join(User, User.id == PmProjectMember.user_id)
            .where(PmProjectMember.project_id == project_id)
            .order_by(User.display_name, User.email)
        )
    ).all()
    return [
        PmMemberOut(user_id=r[0], role=r[1], name=r[2] or r[3], email=r[3]) for r in rows
    ]


def _check_role(role: str) -> None:
    if role not in PROJECT_ROLES:
        raise HTTPException(422, "Role must be admin, member or viewer.")


async def _admin_count(db: AsyncSession, project_id: uuid.UUID) -> int:
    return int(
        await db.scalar(
            select(func.count()).where(
                PmProjectMember.project_id == project_id, PmProjectMember.role == "admin"
            )
        )
    )


@router.post("/projects/{project_id}/members", response_model=PmMemberOut, status_code=201)
async def add_member(
    project_id: uuid.UUID,
    payload: PmMemberIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await require_project(db, user, project_id, "admin", for_update=True)
    _check_role(payload.role)
    person = await _active_user(db, payload.user_id)
    existing = await db.scalar(
        select(PmProjectMember).where(
            PmProjectMember.project_id == project_id, PmProjectMember.user_id == person.id
        )
    )
    if existing:
        raise HTTPException(409, "This person is already on the project.")
    db.add(PmProjectMember(project_id=project_id, user_id=person.id, role=payload.role))
    await db.commit()
    return PmMemberOut(
        user_id=person.id, role=payload.role,
        name=person.display_name or person.email, email=person.email,
    )


@router.patch("/projects/{project_id}/members/{user_id}", response_model=PmMemberOut)
async def update_member(
    project_id: uuid.UUID,
    user_id: uuid.UUID,
    payload: PmMemberUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await require_project(db, user, project_id, "admin", for_update=True)
    _check_role(payload.role)
    membership = await db.scalar(
        select(PmProjectMember).where(
            PmProjectMember.project_id == project_id, PmProjectMember.user_id == user_id
        ).with_for_update()
    )
    if not membership:
        raise HTTPException(404, "This person is not on the project.")
    if membership.role == "admin" and payload.role != "admin" and await _admin_count(db, project_id) <= 1:
        raise HTTPException(409, "A project needs at least one administrator.")
    membership.role = payload.role
    await db.commit()
    person = await db.get(User, user_id)
    return PmMemberOut(
        user_id=user_id, role=membership.role,
        name=person.display_name or person.email, email=person.email,
    )


@router.delete("/projects/{project_id}/members/{user_id}", status_code=204)
async def remove_member(
    project_id: uuid.UUID,
    user_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await require_project(db, user, project_id, "admin", for_update=True)
    membership = await db.scalar(
        select(PmProjectMember).where(
            PmProjectMember.project_id == project_id, PmProjectMember.user_id == user_id
        ).with_for_update()
    )
    if not membership:
        return
    if membership.role == "admin" and await _admin_count(db, project_id) <= 1:
        raise HTTPException(409, "A project needs at least one administrator.")
    await db.delete(membership)
    # Watching an issue requires seeing the project.
    issue_ids = select(PmIssue.id).where(PmIssue.project_id == project_id)
    await db.execute(
        delete(PmIssueWatcher).where(
            PmIssueWatcher.user_id == user_id, PmIssueWatcher.issue_id.in_(issue_ids)
        )
    )
    await db.commit()


@router.get("/people", response_model=list[PmPersonOut])
async def people(
    q: str | None = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Active people a project administrator can add to a project."""
    if not user.is_admin:
        administers = await db.scalar(
            select(PmProjectMember.id).where(
                PmProjectMember.user_id == user.id, PmProjectMember.role == "admin"
            ).limit(1)
        )
        if not administers:
            raise HTTPException(403, "Only project administrators can browse people")
    stmt = (
        select(User)
        .where(User.is_active.is_(True), User.status == "active")
        .order_by(User.display_name, User.email)
    )
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(or_(User.display_name.ilike(like), User.email.ilike(like)))
    rows = (await db.scalars(stmt.limit(200))).all()
    return [PmPersonOut(id=r.id, name=r.display_name or r.email, email=r.email) for r in rows]


# ------------------------------------------------------------------ issues
async def _issue_by_ref(db: AsyncSession, ref: str) -> PmIssue | None:
    match = ISSUE_KEY_RE.match(ref.upper())
    if match:
        return await db.scalar(
            select(PmIssue)
            .join(PmProject, PmProject.id == PmIssue.project_id)
            .where(PmProject.key == match.group(1), PmIssue.number == int(match.group(2)))
        )
    try:
        return await db.get(PmIssue, uuid.UUID(ref))
    except ValueError:
        return None


async def _load_issue(
    db: AsyncSession, user: User, ref: str, minimum: str = "viewer"
) -> tuple[PmIssue, PmProject, str]:
    issue = await _issue_by_ref(db, ref)
    if not issue:
        raise HTTPException(404, "Issue not found")
    project, role = await require_project(db, user, issue.project_id, minimum, for_update=minimum != "viewer")
    if minimum != "viewer":
        # Another issue/sprint mutation may have committed while we waited.
        issue = await db.scalar(
            select(PmIssue).where(PmIssue.id == issue.id).execution_options(populate_existing=True)
        )
        if not issue:
            raise HTTPException(404, "Issue not found")
    return issue, project, role


async def _issue_outs(
    db: AsyncSession, project: PmProject, issues: list[PmIssue]
) -> list[PmIssueOut]:
    if not issues:
        return []
    ids = [i.id for i in issues]
    children = {
        row[0]: (int(row[1]), int(row[2]))
        for row in (
            await db.execute(
                select(
                    PmIssue.parent_id,
                    func.count(PmIssue.id),
                    func.coalesce(func.sum(case((PmIssue.status == "done", 1), else_=0)), 0),
                )
                .where(PmIssue.parent_id.in_(ids))
                .group_by(PmIssue.parent_id)
            )
        ).all()
    }
    comments = dict(
        (
            await db.execute(
                select(PmComment.issue_id, func.count())
                .where(PmComment.issue_id.in_(ids))
                .group_by(PmComment.issue_id)
            )
        ).all()
    )
    known = {i.id: i for i in issues}
    missing = {i.parent_id for i in issues if i.parent_id and i.parent_id not in known}
    if missing:
        for parent in (await db.scalars(select(PmIssue).where(PmIssue.id.in_(missing)))).all():
            known[parent.id] = parent
    names = await user_names(
        db, {i.reporter_id for i in issues} | {i.assignee_id for i in issues}
    )
    sprint_ids = {i.sprint_id for i in issues if i.sprint_id}
    sprint_names = dict(
        (await db.execute(select(PmSprint.id, PmSprint.name).where(PmSprint.id.in_(sprint_ids)))).all()
    ) if sprint_ids else {}
    outs = []
    for issue in issues:
        out = PmIssueOut.model_validate(issue)
        out.key = _key(project, issue.number)
        out.reporter_name = names.get(issue.reporter_id) if issue.reporter_id else None
        out.assignee_name = names.get(issue.assignee_id) if issue.assignee_id else None
        parent = known.get(issue.parent_id) if issue.parent_id else None
        out.parent = _ref(parent, project) if parent else None
        out.sprint_name = sprint_names.get(issue.sprint_id) if issue.sprint_id else None
        out.child_count, out.child_done = children.get(issue.id, (0, 0))
        out.comment_count = int(comments.get(issue.id, 0))
        outs.append(out)
    return outs


def _clean_labels(labels: list[str] | None) -> list[str]:
    seen: list[str] = []
    for raw in labels or []:
        label = re.sub(r"\s+", "-", (raw or "").strip())[:50]
        if label and label not in seen:
            seen.append(label)
    if len(seen) > MAX_LABELS:
        raise HTTPException(422, f"Use at most {MAX_LABELS} labels.")
    return seen


def _check_choice(value: str, allowed: tuple[str, ...], label: str) -> None:
    if value not in allowed:
        raise HTTPException(422, f"Invalid {label}.")


async def _check_people(
    db: AsyncSession, project_id: uuid.UUID, reporter_id=None, assignee_id=None
) -> None:
    members = await member_ids(db, project_id)
    if reporter_id and reporter_id not in members:
        raise HTTPException(422, "The reporter must be on the project.")
    if assignee_id and members.get(assignee_id) not in ("admin", "member"):
        raise HTTPException(422, "Assign the issue to a project member or administrator.")


async def _check_parent(
    db: AsyncSession, project_id: uuid.UUID, issue_type: str,
    parent_id: uuid.UUID | None, self_id: uuid.UUID | None = None,
) -> PmIssue | None:
    if issue_type == "epic":
        if parent_id:
            raise HTTPException(422, "An epic cannot have a parent.")
        return None
    if issue_type == "subtask" and not parent_id:
        raise HTTPException(422, "A sub-task needs a parent issue.")
    if not parent_id:
        return None
    if parent_id == self_id:
        raise HTTPException(422, "An issue cannot be its own parent.")
    parent = await db.get(PmIssue, parent_id)
    if not parent or parent.project_id != project_id:
        raise HTTPException(422, "The parent must be an issue in the same project.")
    if issue_type == "subtask" and LEVEL[parent.issue_type] != 1:
        raise HTTPException(422, "A sub-task's parent must be a story, task or bug.")
    if issue_type != "subtask" and parent.issue_type != "epic":
        raise HTTPException(422, "Stories, tasks and bugs can only belong to an epic.")
    return parent


async def _active_sprint(db: AsyncSession, project_id: uuid.UUID) -> PmSprint | None:
    return await db.scalar(
        select(PmSprint).where(PmSprint.project_id == project_id, PmSprint.status == "active")
    )


async def _check_sprint(
    db: AsyncSession, project: PmProject, issue_type: str, sprint_id: uuid.UUID | None
) -> None:
    if not sprint_id:
        return
    if not project.sprints_enabled:
        raise HTTPException(422, "This project doesn't use sprints.")
    if issue_type not in SPRINTABLE_TYPES:
        raise HTTPException(
            422, "Only stories, tasks and bugs go into sprints; sub-tasks follow their parent."
        )
    sprint = await db.get(PmSprint, sprint_id)
    if not sprint or sprint.project_id != project.id:
        raise HTTPException(422, "Choose a sprint from this project.")
    if sprint.status == "closed":
        raise HTTPException(422, "That sprint is closed.")


async def _watch(db: AsyncSession, issue_id: uuid.UUID, user_ids) -> None:
    wanted = {u for u in user_ids if u}
    if not wanted:
        return
    existing = set(
        (
            await db.scalars(
                select(PmIssueWatcher.user_id).where(
                    PmIssueWatcher.issue_id == issue_id, PmIssueWatcher.user_id.in_(wanted)
                )
            )
        ).all()
    )
    for user_id in wanted - existing:
        db.add(PmIssueWatcher(issue_id=issue_id, user_id=user_id))


async def _notify_watchers(
    db: AsyncSession, issue: PmIssue, project: PmProject, actor: User, title: str,
    skip: set[uuid.UUID] | None = None,
) -> None:
    watchers = (
        await db.scalars(select(PmIssueWatcher.user_id).where(PmIssueWatcher.issue_id == issue.id))
    ).all()
    for user_id in set(watchers) - {actor.id} - (skip or set()):
        await notify_user(
            db, user_id=user_id, title=title,
            body=f"{_key(project, issue.number)} {issue.summary}",
            link=_link(project, issue), category="projects",
        )


async def _notify_assignee(
    db: AsyncSession, issue: PmIssue, project: PmProject, actor: User
) -> None:
    if issue.assignee_id and issue.assignee_id != actor.id:
        await notify_user(
            db, user_id=issue.assignee_id,
            title=f"{actor.display_name or actor.email} assigned you an issue",
            body=f"{_key(project, issue.number)} {issue.summary}",
            link=_link(project, issue), category="projects",
        )


@router.get("/projects/{project_id}/issues", response_model=list[PmIssueOut])
async def list_issues(
    project_id: uuid.UUID,
    issue_type: str | None = Query(None, description="Comma-separated issue types"),
    status: str | None = Query(None, description="Comma-separated statuses"),
    assignee: str | None = Query(None, description="me | none | <user id>"),
    parent_id: uuid.UUID | None = None,
    sprint: str | None = Query(None, description="backlog | active | <sprint id>"),
    label: str | None = None,
    q: str | None = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    project, _ = await require_project(db, user, project_id)
    stmt = (
        select(PmIssue)
        .where(PmIssue.project_id == project_id)
        .order_by(PmIssue.rank, PmIssue.number)
    )
    if issue_type:
        stmt = stmt.where(PmIssue.issue_type.in_(issue_type.split(",")))
    if status:
        stmt = stmt.where(PmIssue.status.in_(status.split(",")))
    if assignee == "me":
        stmt = stmt.where(PmIssue.assignee_id == user.id)
    elif assignee == "none":
        stmt = stmt.where(PmIssue.assignee_id.is_(None))
    elif assignee:
        try:
            stmt = stmt.where(PmIssue.assignee_id == uuid.UUID(assignee))
        except ValueError:
            raise HTTPException(422, "Invalid assignee filter")
    if parent_id:
        stmt = stmt.where(PmIssue.parent_id == parent_id)
    if sprint == "backlog":
        stmt = stmt.where(PmIssue.sprint_id.is_(None))
    elif sprint == "active":
        active = await _active_sprint(db, project_id)
        if not active:
            return []
        stmt = stmt.where(PmIssue.sprint_id == active.id)
    elif sprint:
        try:
            stmt = stmt.where(PmIssue.sprint_id == uuid.UUID(sprint))
        except ValueError:
            raise HTTPException(422, "Invalid sprint filter")
    issues = list((await db.scalars(stmt)).all())
    if label:
        issues = [i for i in issues if label in (i.labels or [])]
    if q:
        needle = q.strip().lower()
        issues = [
            i for i in issues
            if needle in i.summary.lower() or needle == _key(project, i.number).lower()
        ]
    return await _issue_outs(db, project, issues)


@router.post("/projects/{project_id}/issues", response_model=PmIssueOut, status_code=201)
async def create_issue(
    project_id: uuid.UUID,
    payload: PmIssueCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await require_project(db, user, project_id, "member")
    # Lock the project row so concurrent creates get distinct numbers.
    # populate_existing: the access check already cached this row, and a stale
    # issue_seq would hand out a duplicate number.
    project = await db.scalar(
        select(PmProject)
        .where(PmProject.id == project_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    _ensure_writable(project)
    _check_choice(payload.issue_type, ISSUE_TYPES, "issue type")
    _check_choice(payload.status, ISSUE_STATUSES, "status")
    _check_choice(payload.priority, ISSUE_PRIORITIES, "priority")
    _check_dates(payload.start_date, payload.due_date, "Due date")
    summary = payload.summary.strip()
    if not summary:
        raise HTTPException(422, "Enter a summary.")
    reporter_id = payload.reporter_id or user.id
    await _check_people(
        db, project_id,
        # The caller already passed the project check (or is a platform admin).
        reporter_id=reporter_id if reporter_id != user.id else None,
        assignee_id=payload.assignee_id,
    )
    await _check_parent(db, project_id, payload.issue_type, payload.parent_id)
    await _check_sprint(db, project, payload.issue_type, payload.sprint_id)
    project.issue_seq = (project.issue_seq or 0) + 1
    top = await db.scalar(
        select(func.coalesce(func.max(PmIssue.rank), 0)).where(PmIssue.project_id == project_id)
    )
    issue = PmIssue(
        project_id=project_id,
        number=project.issue_seq,
        issue_type=payload.issue_type,
        summary=summary,
        description=payload.description,
        status=payload.status,
        priority=payload.priority,
        story_points=payload.story_points,
        labels=_clean_labels(payload.labels),
        reporter_id=reporter_id,
        assignee_id=payload.assignee_id,
        parent_id=payload.parent_id,
        sprint_id=payload.sprint_id,
        start_date=payload.start_date,
        due_date=payload.due_date,
        resolved_at=_now() if payload.status == "done" else None,
        rank=float(top or 0) + 1,
        created_by_id=user.id,
    )
    db.add(issue)
    await db.flush()
    await _watch(db, issue.id, {user.id, reporter_id, payload.assignee_id})
    await _notify_assignee(db, issue, project, user)
    record(
        db, user=user, action="created", entity_type="pm_issue", entity_id=issue.id,
        summary=f"{user.display_name or user.email} created {_key(project, issue.number)} '{summary}'",
    )
    await db.commit()
    await db.refresh(issue)
    return (await _issue_outs(db, project, [issue]))[0]


async def _links_for(db: AsyncSession, issue: PmIssue, project: PmProject) -> list[PmLinkOut]:
    rows = (
        await db.scalars(
            select(PmIssueLink).where(
                or_(PmIssueLink.source_id == issue.id, PmIssueLink.target_id == issue.id)
            ).order_by(PmIssueLink.created_at)
        )
    ).all()
    other_ids = {r.target_id if r.source_id == issue.id else r.source_id for r in rows}
    others = {
        i.id: i for i in (await db.scalars(select(PmIssue).where(PmIssue.id.in_(other_ids)))).all()
    } if other_ids else {}
    links = []
    for row in rows:
        outgoing = row.source_id == issue.id
        other = others.get(row.target_id if outgoing else row.source_id)
        if not other:
            continue
        if row.link_type == "relates":
            relation = "relates"
        else:
            relation = "blocks" if outgoing else "is_blocked_by"
        links.append(PmLinkOut(id=row.id, relation=relation, issue=_ref(other, project)))
    return links


@router.get("/issues/{ref}", response_model=PmIssueDetail)
async def get_issue(
    ref: str, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)
):
    issue, project, role = await _load_issue(db, user, ref)
    base = (await _issue_outs(db, project, [issue]))[0]
    detail = PmIssueDetail(**base.model_dump())
    detail.project_key = project.key
    detail.project_name = project.name
    detail.my_role = role
    children = list(
        (
            await db.scalars(
                select(PmIssue).where(PmIssue.parent_id == issue.id).order_by(PmIssue.rank, PmIssue.number)
            )
        ).all()
    )
    detail.children = await _issue_outs(db, project, children)
    detail.links = await _links_for(db, issue, project)
    watcher_ids = set(
        (await db.scalars(select(PmIssueWatcher.user_id).where(PmIssueWatcher.issue_id == issue.id))).all()
    )
    names = await user_names(db, watcher_ids)
    detail.watchers = sorted(
        (PmWatcherOut(user_id=w, name=names.get(w, "Unknown")) for w in watcher_ids),
        key=lambda w: w.name.lower(),
    )
    detail.watching = user.id in watcher_ids
    return detail


async def _display(db: AsyncSession, project: PmProject, field: str, value) -> str | None:
    if value is None:
        return None
    if field in ("reporter_id", "assignee_id"):
        return (await user_names(db, {value})).get(value)
    if field == "parent_id":
        parent = await db.get(PmIssue, value)
        return _key(project, parent.number) if parent else None
    if field == "sprint_id":
        sprint = await db.get(PmSprint, value)
        return sprint.name if sprint else None
    if field == "labels":
        return ", ".join(value) or None
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value)


HISTORY_FIELDS = {
    "issue_type": "type", "summary": "summary", "description": "description",
    "status": "status", "priority": "priority", "story_points": "story points",
    "labels": "labels", "reporter_id": "reporter", "assignee_id": "assignee",
    "parent_id": "parent", "start_date": "start date", "due_date": "due date",
    "sprint_id": "sprint",
}


@router.patch("/issues/{issue_id}", response_model=PmIssueOut)
async def update_issue(
    issue_id: uuid.UUID,
    payload: PmIssueUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    issue, project, _ = await _load_issue(db, user, str(issue_id), "member")
    _ensure_writable(project)
    data = payload.model_dump(exclude_unset=True)
    for field in ("issue_type", "status", "priority", "summary"):
        if field in data and data[field] is None:
            raise HTTPException(422, f"{HISTORY_FIELDS[field].capitalize()} is required.")
    if "issue_type" in data:
        _check_choice(data["issue_type"], ISSUE_TYPES, "issue type")
    if "status" in data:
        _check_choice(data["status"], ISSUE_STATUSES, "status")
    if "priority" in data:
        _check_choice(data["priority"], ISSUE_PRIORITIES, "priority")
    if "summary" in data:
        data["summary"] = data["summary"].strip()
        if not data["summary"]:
            raise HTTPException(422, "Enter a summary.")
    if "labels" in data:
        data["labels"] = _clean_labels(data["labels"])
    _check_dates(data.get("start_date", issue.start_date), data.get("due_date", issue.due_date), "Due date")
    await _check_people(
        db, project.id,
        reporter_id=data.get("reporter_id") if data.get("reporter_id") != issue.reporter_id else None,
        assignee_id=data.get("assignee_id") if data.get("assignee_id") != issue.assignee_id else None,
    )
    new_type = data.get("issue_type", issue.issue_type)
    if new_type != issue.issue_type:
        has_children = await db.scalar(select(PmIssue.id).where(PmIssue.parent_id == issue.id).limit(1))
        if has_children and LEVEL[new_type] != LEVEL[issue.issue_type]:
            raise HTTPException(
                409, "Move or remove this issue's child issues before changing it to that type."
            )
    if "issue_type" in data or "parent_id" in data:
        parent_id = data.get("parent_id", issue.parent_id)
        # An epic never has a parent; drop a stale one when converting to epic.
        if new_type == "epic" and "parent_id" not in data:
            parent_id = None
            data["parent_id"] = None
        await _check_parent(db, project.id, new_type, parent_id, issue.id)
    if new_type not in SPRINTABLE_TYPES and issue.sprint_id and "sprint_id" not in data:
        # Epics and sub-tasks don't sit in sprints.
        data["sprint_id"] = None
    final_sprint_id = data.get("sprint_id", issue.sprint_id)
    if final_sprint_id and final_sprint_id == issue.sprint_id:
        sprint = await db.get(PmSprint, final_sprint_id)
        if new_type not in SPRINTABLE_TYPES:
            data["sprint_id"] = None
        elif sprint and sprint.status == "closed" and data.get("status", issue.status) != "done":
            # An unchanged closed sprint is stale Edit form state, not an
            # explicit destination. Also repair already-stranded open work.
            data["sprint_id"] = None
    if "sprint_id" in data and data["sprint_id"] != issue.sprint_id:
        await _check_sprint(db, project, new_type, data["sprint_id"])

    prev_status = issue.status
    prev_assignee = issue.assignee_id
    for field, value in data.items():
        old = getattr(issue, field)
        if old == value:
            continue
        if field in HISTORY_FIELDS:
            db.add(
                PmIssueHistory(
                    issue_id=issue.id, actor_id=user.id, field=HISTORY_FIELDS[field],
                    old_value=await _display(db, project, field, old),
                    new_value=await _display(db, project, field, value),
                )
            )
        setattr(issue, field, value)
    if issue.status != prev_status:
        issue.resolved_at = _now() if issue.status == "done" else None
        await _notify_watchers(
            db, issue, project, user,
            f"{user.display_name or user.email} moved an issue to {issue.status.replace('_', ' ')}",
        )
    if issue.assignee_id != prev_assignee:
        await _watch(db, issue.id, {issue.assignee_id})
        await _notify_assignee(db, issue, project, user)
    if data.get("reporter_id"):
        await _watch(db, issue.id, {data["reporter_id"]})
    await db.commit()
    await db.refresh(issue)
    return (await _issue_outs(db, project, [issue]))[0]


@router.delete("/issues/{issue_id}", status_code=204)
async def delete_issue(
    issue_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    issue, project, role = await _load_issue(db, user, str(issue_id), "member")
    _ensure_writable(project)
    if role != "admin" and issue.created_by_id != user.id:
        raise HTTPException(403, "Only a project administrator or the issue's creator can delete it.")
    # Sub-tasks go with their parent (as in Jira); an epic's issues stay and
    # simply lose their epic.
    doomed = [issue.id]
    if LEVEL[issue.issue_type] == 1:
        doomed += list(
            (await db.scalars(select(PmIssue.id).where(PmIssue.parent_id == issue.id))).all()
        )
    else:
        children = (await db.scalars(select(PmIssue).where(PmIssue.parent_id == issue.id))).all()
        for child in children:
            child.parent_id = None
    attachments = (
        await db.scalars(
            select(Attachment).where(
                Attachment.entity_type == "pm_issue", Attachment.entity_id.in_(doomed)
            )
        )
    ).all()
    paths = [a.file_path for a in attachments]
    for attachment in attachments:
        await db.delete(attachment)
    for model, column in (
        (PmComment, PmComment.issue_id), (PmIssueHistory, PmIssueHistory.issue_id),
        (PmIssueWatcher, PmIssueWatcher.issue_id),
    ):
        await db.execute(delete(model).where(column.in_(doomed)))
    await db.execute(
        delete(PmIssueLink).where(
            or_(PmIssueLink.source_id.in_(doomed), PmIssueLink.target_id.in_(doomed))
        )
    )
    await db.execute(delete(PmIssue).where(PmIssue.id.in_(doomed[1:])))
    record(
        db, user=user, action="deleted", entity_type="pm_issue", entity_id=issue.id,
        summary=f"{user.display_name or user.email} deleted {_key(project, issue.number)} '{issue.summary}'",
    )
    await db.delete(issue)
    await db.commit()
    for path in paths:
        try:
            absolute_path(path).unlink(missing_ok=True)
        except OSError:
            pass


# ----------------------------------------------------------- links/watchers
@router.post("/issues/{issue_id}/links", response_model=PmLinkOut, status_code=201)
async def add_link(
    issue_id: uuid.UUID,
    payload: PmLinkCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    issue, project, _ = await _load_issue(db, user, str(issue_id), "member")
    _ensure_writable(project)
    if payload.relation not in ("blocks", "is_blocked_by", "relates"):
        raise HTTPException(422, "Invalid link type.")
    target = await db.get(PmIssue, payload.target_id)
    if not target or target.project_id != project.id:
        raise HTTPException(422, "Link to an issue in the same project.")
    if target.id == issue.id:
        raise HTTPException(422, "An issue cannot link to itself.")
    source_id, target_id = (
        (target.id, issue.id) if payload.relation == "is_blocked_by" else (issue.id, target.id)
    )
    link_type = "relates" if payload.relation == "relates" else "blocks"
    pair = [(source_id, target_id)] + ([(target_id, source_id)] if link_type == "relates" else [])
    for a, b in pair:
        if await db.scalar(
            select(PmIssueLink.id).where(
                PmIssueLink.source_id == a, PmIssueLink.target_id == b,
                PmIssueLink.link_type == link_type,
            )
        ):
            raise HTTPException(409, "These issues are already linked that way.")
    link = PmIssueLink(source_id=source_id, target_id=target_id, link_type=link_type)
    db.add(link)
    await db.commit()
    return PmLinkOut(id=link.id, relation=payload.relation, issue=_ref(target, project))


@router.delete("/links/{link_id}", status_code=204)
async def delete_link(
    link_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    link = await db.get(PmIssueLink, link_id)
    if not link:
        return
    _, project, _ = await _load_issue(db, user, str(link.source_id), "member")
    _ensure_writable(project)
    await db.delete(link)
    await db.commit()


@router.post("/issues/{issue_id}/watchers", status_code=204)
async def add_watcher(
    issue_id: uuid.UUID,
    payload: PmWatcherIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    issue, project, role = await _load_issue(db, user, str(issue_id))
    _ensure_writable(project)
    if payload.user_id != user.id:
        if not role_at_least(role, "member"):
            raise HTTPException(403, "Viewers can only watch issues themselves.")
        if payload.user_id not in await member_ids(db, project.id):
            raise HTTPException(422, "Watchers must be on the project.")
    await _watch(db, issue.id, {payload.user_id})
    await db.commit()


@router.delete("/issues/{issue_id}/watchers/{user_id}", status_code=204)
async def remove_watcher(
    issue_id: uuid.UUID,
    user_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    issue, project, role = await _load_issue(db, user, str(issue_id))
    _ensure_writable(project)
    if user_id != user.id and not role_at_least(role, "member"):
        raise HTTPException(403, "Viewers can only stop watching issues themselves.")
    await db.execute(
        delete(PmIssueWatcher).where(
            PmIssueWatcher.issue_id == issue.id, PmIssueWatcher.user_id == user_id
        )
    )
    await db.commit()


# --------------------------------------------------------- comments/history
@router.get("/issues/{issue_id}/comments", response_model=list[PmCommentOut])
async def list_comments(
    issue_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    issue, _, _ = await _load_issue(db, user, str(issue_id))
    rows = (
        await db.scalars(
            select(PmComment).where(PmComment.issue_id == issue.id).order_by(PmComment.created_at)
        )
    ).all()
    names = await user_names(db, {c.author_id for c in rows})
    outs = []
    for row in rows:
        out = PmCommentOut.model_validate(row)
        out.author_name = names.get(row.author_id) if row.author_id else None
        outs.append(out)
    return outs


@router.post("/issues/{issue_id}/comments", response_model=PmCommentOut, status_code=201)
async def add_comment(
    issue_id: uuid.UUID,
    payload: PmCommentIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    # Viewers (stakeholders) may comment; that is how requesters give feedback.
    issue, project, _ = await _load_issue(db, user, str(issue_id))
    _ensure_writable(project)
    body = payload.body.strip()
    if not body:
        raise HTTPException(422, "Write a comment first.")
    comment = PmComment(issue_id=issue.id, author_id=user.id, body=body)
    db.add(comment)
    await _watch(db, issue.id, {user.id})
    await _notify_watchers(
        db, issue, project, user, f"{user.display_name or user.email} commented on an issue"
    )
    await db.commit()
    await db.refresh(comment)
    out = PmCommentOut.model_validate(comment)
    out.author_name = user.display_name or user.email
    return out


@router.patch("/comments/{comment_id}", response_model=PmCommentOut)
async def edit_comment(
    comment_id: uuid.UUID,
    payload: PmCommentIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    comment = await db.get(PmComment, comment_id)
    if not comment:
        raise HTTPException(404, "Comment not found")
    _, project, _ = await _load_issue(db, user, str(comment.issue_id))
    _ensure_writable(project)
    if comment.author_id != user.id:
        raise HTTPException(403, "You can only edit your own comments.")
    body = payload.body.strip()
    if not body:
        raise HTTPException(422, "Write a comment first.")
    comment.body = body
    await db.commit()
    await db.refresh(comment)
    out = PmCommentOut.model_validate(comment)
    out.author_name = user.display_name or user.email
    return out


@router.delete("/comments/{comment_id}", status_code=204)
async def delete_comment(
    comment_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    comment = await db.get(PmComment, comment_id)
    if not comment:
        return
    _, project, role = await _load_issue(db, user, str(comment.issue_id))
    _ensure_writable(project)
    if comment.author_id != user.id and role != "admin":
        raise HTTPException(403, "You can only delete your own comments.")
    await db.delete(comment)
    await db.commit()


@router.get("/issues/{issue_id}/history", response_model=list[PmHistoryOut])
async def issue_history(
    issue_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    issue, _, _ = await _load_issue(db, user, str(issue_id))
    rows = (
        await db.scalars(
            select(PmIssueHistory)
            .where(PmIssueHistory.issue_id == issue.id)
            .order_by(PmIssueHistory.created_at.desc())
        )
    ).all()
    names = await user_names(db, {r.actor_id for r in rows})
    outs = []
    for row in rows:
        out = PmHistoryOut.model_validate(row)
        out.actor_name = names.get(row.actor_id) if row.actor_id else None
        outs.append(out)
    return outs


# ------------------------------------------------------------------ sprints
async def _load_sprint(
    db: AsyncSession, user: User, sprint_id: uuid.UUID, minimum: str = "viewer"
) -> tuple[PmSprint, PmProject]:
    sprint = await db.get(PmSprint, sprint_id)
    if not sprint:
        raise HTTPException(404, "Sprint not found")
    project, _ = await require_project(db, user, sprint.project_id, minimum, for_update=minimum != "viewer")
    if minimum != "viewer":
        sprint = await db.scalar(
            select(PmSprint).where(PmSprint.id == sprint_id).execution_options(populate_existing=True)
        )
        if not sprint:
            raise HTTPException(404, "Sprint not found")
    return sprint, project


async def _sprint_outs(db: AsyncSession, sprints: list[PmSprint]) -> list[PmSprintOut]:
    if not sprints:
        return []
    done = case((PmIssue.status == "done", 1), else_=0)
    done_points = case((PmIssue.status == "done", func.coalesce(PmIssue.story_points, 0)), else_=0)
    totals = {
        row[0]: row[1:]
        for row in (
            await db.execute(
                select(
                    PmIssue.sprint_id,
                    func.count(PmIssue.id),
                    func.coalesce(func.sum(done), 0),
                    func.coalesce(func.sum(PmIssue.story_points), 0),
                    func.coalesce(func.sum(done_points), 0),
                )
                .where(PmIssue.sprint_id.in_([s.id for s in sprints]))
                .group_by(PmIssue.sprint_id)
            )
        ).all()
    }
    outs = []
    for sprint in sprints:
        out = PmSprintOut.model_validate(sprint)
        count, done_count, points, finished = totals.get(sprint.id, (0, 0, 0, 0))
        out.issue_count, out.done_count = int(count), int(done_count)
        out.points, out.done_points = float(points), float(finished)
        outs.append(out)
    return outs


async def _sprint_points(db: AsyncSession, sprint_id: uuid.UUID, done_only: bool) -> float:
    stmt = select(func.coalesce(func.sum(PmIssue.story_points), 0)).where(
        PmIssue.sprint_id == sprint_id
    )
    if done_only:
        stmt = stmt.where(PmIssue.status == "done")
    return float(await db.scalar(stmt) or 0)


async def _move_issues(
    db: AsyncSession, project: PmProject, user: User, issues, target: PmSprint | None
) -> None:
    """Move issues to ``target`` (None = backlog), recording each in history."""
    for issue in issues:
        if issue.sprint_id == (target.id if target else None):
            continue
        db.add(
            PmIssueHistory(
                issue_id=issue.id, actor_id=user.id, field="sprint",
                old_value=await _display(db, project, "sprint_id", issue.sprint_id),
                new_value=target.name if target else None,
            )
        )
        issue.sprint_id = target.id if target else None


def _require_sprints(project: PmProject) -> None:
    _ensure_writable(project)
    if not project.sprints_enabled:
        raise HTTPException(409, "Turn sprints on for this project first.")


@router.get("/projects/{project_id}/sprints", response_model=list[PmSprintOut])
async def list_sprints(
    project_id: uuid.UUID,
    state: str = Query("open", description="open (active and future) | closed | all"),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await require_project(db, user, project_id)
    stmt = select(PmSprint).where(PmSprint.project_id == project_id)
    if state == "open":
        stmt = stmt.where(PmSprint.status != "closed")
    elif state == "closed":
        stmt = stmt.where(PmSprint.status == "closed")
    order = {"active": 0, "future": 1, "closed": 2}
    sprints = sorted(
        (await db.scalars(stmt)).all(),
        key=lambda s: (
            order.get(s.status, 3),
            # Closed sprints newest first; others in creation order.
            -(s.completed_at.timestamp()) if s.status == "closed" and s.completed_at else 0,
            s.created_at,
        ),
    )
    return await _sprint_outs(db, sprints)


@router.post("/projects/{project_id}/sprints", response_model=PmSprintOut, status_code=201)
async def create_sprint(
    project_id: uuid.UUID,
    payload: PmSprintCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await require_project(db, user, project_id, "admin")
    project = await db.scalar(
        select(PmProject)
        .where(PmProject.id == project_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    _require_sprints(project)
    _check_dates(payload.start_date, payload.end_date, "End date")
    project.sprint_seq = (project.sprint_seq or 0) + 1
    name = (payload.name or "").strip() or f"{project.key} Sprint {project.sprint_seq}"
    sprint = PmSprint(
        project_id=project_id, name=name, goal=payload.goal,
        start_date=payload.start_date, end_date=payload.end_date, status="future",
    )
    db.add(sprint)
    await db.commit()
    await db.refresh(sprint)
    return (await _sprint_outs(db, [sprint]))[0]


@router.patch("/sprints/{sprint_id}", response_model=PmSprintOut)
async def update_sprint(
    sprint_id: uuid.UUID,
    payload: PmSprintUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    sprint, project = await _load_sprint(db, user, sprint_id, "admin")
    _require_sprints(project)
    if sprint.status == "closed":
        raise HTTPException(409, "Closed sprints can't be changed.")
    data = payload.model_dump(exclude_unset=True)
    if "name" in data:
        if not (data["name"] or "").strip():
            raise HTTPException(422, "Enter a sprint name.")
        data["name"] = data["name"].strip()
    _check_dates(data.get("start_date", sprint.start_date), data.get("end_date", sprint.end_date), "End date")
    if sprint.status == "active" and ("start_date" in data or "end_date" in data):
        if not data.get("start_date", sprint.start_date) or not data.get("end_date", sprint.end_date):
            raise HTTPException(422, "An active sprint needs start and end dates.")
    for field, value in data.items():
        setattr(sprint, field, value)
    await db.commit()
    await db.refresh(sprint)
    return (await _sprint_outs(db, [sprint]))[0]


@router.delete("/sprints/{sprint_id}", status_code=204)
async def delete_sprint(
    sprint_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    sprint, project = await _load_sprint(db, user, sprint_id, "admin")
    _ensure_writable(project)
    if sprint.status != "future":
        raise HTTPException(409, "Only sprints that haven't started can be deleted.")
    issues = (await db.scalars(select(PmIssue).where(PmIssue.sprint_id == sprint.id))).all()
    await _move_issues(db, project, user, issues, None)
    await db.flush()
    await db.delete(sprint)
    await db.commit()


@router.post("/sprints/{sprint_id}/start", response_model=PmSprintOut)
async def start_sprint(
    sprint_id: uuid.UUID,
    payload: PmSprintStart,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    sprint, project = await _load_sprint(db, user, sprint_id, "admin")
    _require_sprints(project)
    if sprint.status != "future":
        raise HTTPException(409, "This sprint has already started.")
    _check_dates(payload.start_date, payload.end_date, "End date")
    if await _active_sprint(db, project.id):
        raise HTTPException(409, "Complete the active sprint before starting another.")
    sprint.status = "active"
    sprint.start_date = payload.start_date
    sprint.end_date = payload.end_date
    if payload.goal is not None:
        sprint.goal = payload.goal
    sprint.started_at = _now()
    sprint.committed_points = await _sprint_points(db, sprint.id, done_only=False)
    record(
        db, user=user, action="started", entity_type="pm_sprint", entity_id=sprint.id,
        summary=f"{user.display_name or user.email} started {sprint.name} in {project.key}",
    )
    await db.commit()
    await db.refresh(sprint)
    return (await _sprint_outs(db, [sprint]))[0]


@router.post("/sprints/{sprint_id}/complete", response_model=PmSprintOut)
async def complete_sprint(
    sprint_id: uuid.UUID,
    payload: PmSprintComplete,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    sprint, project = await _load_sprint(db, user, sprint_id, "admin")
    _ensure_writable(project)
    if sprint.status != "active":
        raise HTTPException(409, "Only the active sprint can be completed.")
    target = None
    if payload.move_to != "backlog":
        try:
            target = await db.get(PmSprint, uuid.UUID(payload.move_to))
        except ValueError:
            target = None
        if not target or target.project_id != project.id or target.status != "future":
            raise HTTPException(422, "Move unfinished issues to the backlog or a future sprint.")
    unfinished = (
        await db.scalars(
            select(PmIssue).where(PmIssue.sprint_id == sprint.id, PmIssue.status != "done")
        )
    ).all()
    sprint.completed_points = await _sprint_points(db, sprint.id, done_only=True)
    sprint.completed_at = _now()
    # Issue edits/creation and sprint completion share the project lock, so this
    # snapshot and velocity describe the same committed completion state.
    from app.api.pm_reports import burndown_data

    snapshot = await burndown_data(db, project.id, sprint.id)
    snapshot["sprint"]["status"] = "closed"
    sprint.burndown_snapshot = snapshot
    sprint.status = "closed"
    await _move_issues(db, project, user, unfinished, target)
    record(
        db, user=user, action="completed", entity_type="pm_sprint", entity_id=sprint.id,
        summary=(
            f"{user.display_name or user.email} completed {sprint.name} in {project.key}; "
            f"{len(unfinished)} unfinished issue(s) moved to {target.name if target else 'the backlog'}"
        ),
    )
    await db.commit()
    await db.refresh(sprint)
    return (await _sprint_outs(db, [sprint]))[0]
