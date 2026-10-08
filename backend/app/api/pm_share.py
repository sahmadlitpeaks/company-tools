"""Read-only public share links for project tracker views.

Project administrators create a link to one view (board, timeline or
progress). Anyone holding the link can read that view until it expires or is
revoked. The public payload is deliberately small: keys, summaries, types,
statuses, priorities, points, dates and assignee names - never descriptions,
comments, attachments, reporters, labels or people's emails.
"""
import uuid
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.pm import _health
from app.api.pm_reports import burndown_data, velocity_data
from app.auth.deps import get_current_user
from app.core.database import get_db
from app.core.permissions import disabled_keys, is_enabled
from app.models.pm import SHARE_VIEWS, SPRINTABLE_TYPES, PmIssue, PmIssueLink, PmProject, PmShareLink, PmSprint
from app.models.user import User
from app.services import crypto
from app.services.activity import record
from app.services.people import user_names
from app.services.pm_access import require_project

router = APIRouter(prefix="/pm", tags=["project-tracker-sharing"])
public_router = APIRouter(prefix="/public/pm-shares", tags=["project-tracker-sharing"])

KANBAN_DONE_DAYS = 14
UNAVAILABLE = "This link isn't available. It may have expired or been revoked."


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(value: datetime | None) -> datetime | None:
    return value.replace(tzinfo=timezone.utc) if value and value.tzinfo is None else value


class ShareCreate(BaseModel):
    view: str
    label: str | None = Field(default=None, max_length=120)
    # 0 = never expires.
    expires_in_days: int = Field(default=30, ge=0, le=365)


def _state(link: PmShareLink) -> str:
    if link.revoked_at:
        return "revoked"
    if link.expires_at and _aware(link.expires_at) <= _now():
        return "expired"
    return "active"


def _out(link: PmShareLink, names: dict) -> dict:
    return {
        "id": str(link.id), "view": link.view, "label": link.label, "state": _state(link),
        "expires_at": link.expires_at, "revoked_at": link.revoked_at, "created_at": link.created_at,
        "created_by_name": names.get(link.created_by_id), "view_count": link.view_count,
        "last_viewed_at": link.last_viewed_at,
    }


@router.get("/projects/{project_id}/shares")
async def list_shares(
    project_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await require_project(db, user, project_id, "admin")
    links = (
        await db.scalars(
            select(PmShareLink).where(PmShareLink.project_id == project_id).order_by(PmShareLink.created_at.desc())
        )
    ).all()
    names = await user_names(db, {link.created_by_id for link in links})
    return [_out(link, names) for link in links]


@router.post("/projects/{project_id}/shares", status_code=201)
async def create_share(
    project_id: uuid.UUID,
    payload: ShareCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    project, _ = await require_project(db, user, project_id, "admin")
    if payload.view not in SHARE_VIEWS:
        raise HTTPException(422, "Choose the board, timeline or progress view.")
    token = crypto.new_token()
    link = PmShareLink(
        project_id=project.id, token_hash=crypto.token_hash(token), view=payload.view,
        label=(payload.label or "").strip() or None, created_by_id=user.id, view_count=0,
        expires_at=_now() + timedelta(days=payload.expires_in_days) if payload.expires_in_days else None,
    )
    db.add(link)
    record(
        db, user=user, action="shared", entity_type="pm_project", entity_id=project.id,
        summary=f"{user.display_name or user.email} created a read-only {payload.view} link for {project.key}",
    )
    await db.commit()
    await db.refresh(link)
    out = _out(link, {user.id: user.display_name or user.email})
    # The token is returned once; only its hash is stored.
    out["token"] = token
    out["path"] = f"/share/p/{token}"
    return out


@router.delete("/shares/{share_id}", status_code=204)
async def revoke_share(
    share_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    link = await db.get(PmShareLink, share_id)
    if not link:
        return
    project, _ = await require_project(db, user, link.project_id, "admin")
    if not link.revoked_at:
        link.revoked_at = _now()
        record(
            db, user=user, action="revoked", entity_type="pm_project", entity_id=project.id,
            summary=f"{user.display_name or user.email} revoked a {link.view} link for {project.key}",
        )
        await db.commit()


# ------------------------------------------------------------------ public
def _issue(issue: PmIssue, project_key: str, names: dict, parents: dict) -> dict:
    parent = parents.get(issue.parent_id)
    return {
        "id": str(issue.id), "key": f"{project_key}-{issue.number}", "number": issue.number, "issue_type": issue.issue_type,
        "summary": issue.summary, "status": issue.status, "priority": issue.priority,
        "story_points": issue.story_points, "assignee_name": names.get(issue.assignee_id),
        "parent_id": str(issue.parent_id) if issue.parent_id else None,
        "parent": {"id": str(parent.id), "key": f"{project_key}-{parent.number}", "summary": parent.summary,
                   "issue_type": parent.issue_type, "status": parent.status} if parent else None,
        "sprint_id": str(issue.sprint_id) if issue.sprint_id else None,
        "start_date": issue.start_date, "due_date": issue.due_date, "resolved_at": issue.resolved_at,
        "rank": issue.rank,
    }


async def _issues(db: AsyncSession, project: PmProject, issues: list[PmIssue]) -> list[dict]:
    ids = {i.id for i in issues}
    children: dict = {}
    for row in (await db.scalars(select(PmIssue).where(PmIssue.parent_id.in_(ids)))).all() if ids else []:
        total, done = children.get(row.parent_id, (0, 0))
        children[row.parent_id] = (total + 1, done + (row.status == "done"))
    parent_ids = {i.parent_id for i in issues if i.parent_id}
    parents = {
        p.id: p for p in (await db.scalars(select(PmIssue).where(PmIssue.id.in_(parent_ids)))).all()
    } if parent_ids else {}
    names = await user_names(db, {i.assignee_id for i in issues})
    out = []
    for issue in issues:
        row = _issue(issue, project.key, names, parents)
        row["child_count"], row["child_done"] = children.get(issue.id, (0, 0))
        out.append(row)
    return out


def _sprint(sprint: PmSprint) -> dict:
    return {
        "id": str(sprint.id), "name": sprint.name, "goal": sprint.goal, "status": sprint.status,
        "start_date": sprint.start_date, "end_date": sprint.end_date,
    }


async def _board(db: AsyncSession, project: PmProject) -> dict:
    stmt = select(PmIssue).where(PmIssue.project_id == project.id, PmIssue.issue_type.in_(SPRINTABLE_TYPES))
    sprint = None
    if project.sprints_enabled:
        sprint = await db.scalar(
            select(PmSprint).where(PmSprint.project_id == project.id, PmSprint.status == "active")
        )
        if not sprint:
            return {"sprint": None, "issues": []}
        stmt = stmt.where(PmIssue.sprint_id == sprint.id)
    else:
        recent = _now() - timedelta(days=KANBAN_DONE_DAYS)
        stmt = stmt.where(or_(PmIssue.status != "done", PmIssue.resolved_at >= recent))
    issues = list((await db.scalars(stmt.order_by(PmIssue.rank, PmIssue.number))).all())
    return {"sprint": _sprint(sprint) if sprint else None, "issues": await _issues(db, project, issues)}


async def _timeline(db: AsyncSession, project: PmProject) -> dict:
    issues = list(
        (await db.scalars(
            select(PmIssue)
            .where(PmIssue.project_id == project.id, PmIssue.issue_type.in_(("epic", *SPRINTABLE_TYPES)))
            .order_by(PmIssue.rank, PmIssue.number)
        )).all()
    )
    ids = {i.id for i in issues}
    links = (await db.scalars(
        select(PmIssueLink).where(PmIssueLink.link_type == "blocks", PmIssueLink.source_id.in_(ids))
    )).all() if ids else []
    sprints = (await db.scalars(select(PmSprint).where(PmSprint.project_id == project.id))).all() \
        if project.sprints_enabled else []
    return {
        "issues": await _issues(db, project, issues),
        "links": [
            {"id": str(l.id), "source_id": str(l.source_id), "target_id": str(l.target_id), "link_type": l.link_type}
            for l in links if l.target_id in ids
        ],
        "sprints": [_sprint(s) for s in sprints if s.start_date and s.end_date],
    }


async def _progress(db: AsyncSession, project: PmProject) -> dict:
    issues = (await db.scalars(select(PmIssue).where(PmIssue.project_id == project.id))).all()
    work = [i for i in issues if i.issue_type != "epic"]
    epics = [i for i in issues if i.issue_type == "epic"]
    counts = {status: sum(1 for i in work if i.status == status) for status in ("todo", "in_progress", "in_review", "done")}
    epic_rows = []
    for epic in sorted(epics, key=lambda e: (e.rank, e.number)):
        children = [i for i in work if i.parent_id == epic.id]
        epic_rows.append({
            "key": f"{project.key}-{epic.number}", "summary": epic.summary, "status": epic.status,
            "issue_count": len(children), "done_count": sum(1 for c in children if c.status == "done"),
            "due_date": epic.due_date,
        })
    out = {"counts": counts, "epics": epic_rows, "burndown": None, "velocity": None}
    if project.sprints_enabled:
        out["burndown"] = await burndown_data(db, project.id)
        out["velocity"] = await velocity_data(db, project.id)
    return out


@public_router.get("/{token}")
async def view_share(token: str, response: Response, db: AsyncSession = Depends(get_db)):
    response.headers["Cache-Control"] = "private, no-store"
    response.headers["X-Robots-Tag"] = "noindex, nofollow"
    response.headers["Referrer-Policy"] = "no-referrer"
    link = await db.scalar(select(PmShareLink).where(PmShareLink.token_hash == crypto.token_hash(token)))
    # Unknown, expired and revoked links look the same to the visitor, and
    # switching the Projects module off org-wide switches sharing off too.
    if not link or _state(link) != "active" or not is_enabled("projects", await disabled_keys(db)):
        raise HTTPException(404, UNAVAILABLE)
    project = await db.get(PmProject, link.project_id)
    if not project:
        raise HTTPException(404, UNAVAILABLE)
    link.view_count = (link.view_count or 0) + 1
    link.last_viewed_at = _now()
    work = (await db.scalars(
        select(PmIssue).where(PmIssue.project_id == project.id, PmIssue.issue_type != "epic")
    )).all()
    open_count = sum(1 for i in work if i.status != "done")
    overdue = sum(1 for i in work if i.status != "done" and i.due_date and i.due_date < date.today())
    payload = {
        "view": link.view,
        "label": link.label,
        "expires_at": link.expires_at,
        "generated_at": _now(),
        "project": {
            "key": project.key, "name": project.name, "status": project.status,
            "sprints_enabled": project.sprints_enabled,
            "start_date": project.start_date, "target_date": project.target_date,
            "issue_count": len(work), "done_count": len(work) - open_count, "overdue_count": overdue,
            "health": _health(project, open_count, overdue),
        },
    }
    if link.view == "board":
        payload["board"] = await _board(db, project)
    elif link.view == "timeline":
        payload["timeline"] = await _timeline(db, project)
    else:
        payload["progress"] = await _progress(db, project)
    await db.commit()
    return payload
