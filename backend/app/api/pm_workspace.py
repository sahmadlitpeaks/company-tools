"""Configurable tracker workspace, saved boards and bounded issue queries."""
import json
import uuid
from collections import defaultdict
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import String, case, cast, func, literal, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.core.database import get_db
from app.models.pm import ISSUE_PRIORITIES, ISSUE_STATUSES, ISSUE_TYPES, PmIssue, PmProject, PmSprint
from app.models.pm_view import PmView
from app.models.user import User
from app.schemas.pm import PmIssueCreate
from app.schemas.pm_workspace import BulkUpdate, ViewCreate, ViewFilters, ViewIn, ViewOut, WorkspaceConfig
from app.services.activity import record
from app.services.pm_access import ensure_writable, member_ids, require_project, visible_project_ids
from app.services.pm_workspace import apply_workspace_fields, configuration

router = APIRouter(prefix="/pm", tags=["project-workspace"])


def parse_uuid(value, name):
    try:
        return uuid.UUID(value)
    except (ValueError, TypeError):
        raise HTTPException(422, f"Invalid {name}.")


def parse_date(value, name):
    try:
        return date.fromisoformat(value)
    except (ValueError, TypeError):
        raise HTTPException(422, f"Invalid {name}.")


def filter_query(filters: ViewFilters, user):
    stmt = select(PmIssue).join(PmProject, PmProject.id == PmIssue.project_id)
    for field, choices in (("status", ISSUE_STATUSES), ("issue_type", ISSUE_TYPES), ("priority", ISSUE_PRIORITIES)):
        raw = getattr(filters, field)
        if raw:
            values = raw.split(",")
            if any(value not in choices for value in values):
                raise HTTPException(422, f"Invalid {field} filter.")
            stmt = stmt.where(getattr(PmIssue, field).in_(values))
    for field in ("workflow_state", "component"):
        if value := getattr(filters, field):
            stmt = stmt.where(getattr(PmIssue, field) == value)
    if filters.parent_id:
        stmt = stmt.where(PmIssue.parent_id == parse_uuid(filters.parent_id, "epic"))
    if filters.assignee:
        if filters.assignee == "none":
            stmt = stmt.where(PmIssue.assignee_id.is_(None))
        else:
            assignee = user.id if filters.assignee == "me" else parse_uuid(filters.assignee, "assignee")
            stmt = stmt.where(PmIssue.assignee_id == assignee)
    if filters.sprint:
        if filters.sprint == "backlog":
            stmt = stmt.where(PmIssue.sprint_id.is_(None))
        elif filters.sprint == "active":
            stmt = stmt.where(PmIssue.sprint_id.in_(select(PmSprint.id).where(PmSprint.status == "active")))
        else:
            stmt = stmt.where(PmIssue.sprint_id == parse_uuid(filters.sprint, "sprint"))
    if filters.label:
        stmt = stmt.where(cast(PmIssue.labels, String).contains(json.dumps(filters.label, ensure_ascii=True), autoescape=True))
    if filters.q.strip():
        key = PmProject.key + literal("-") + cast(PmIssue.number, String)
        stmt = stmt.where(or_(
            PmIssue.summary.icontains(filters.q.strip(), autoescape=True),
            func.lower(key) == filters.q.strip().lower(),
        ))
    for field, operation in (("due_after", PmIssue.due_date.__ge__), ("due_before", PmIssue.due_date.__le__)):
        if raw := getattr(filters, field):
            stmt = stmt.where(operation(parse_date(raw, field.replace("_", " "))))
    if filters.due_after and filters.due_before and filters.due_after > filters.due_before:
        stmt = stmt.where(literal(False))
    if filters.project_ids:
        stmt = stmt.where(PmIssue.project_id.in_(filters.project_ids))
    return stmt


@router.get("/projects/{project_id}/configuration", response_model=WorkspaceConfig)
async def get_configuration(project_id: uuid.UUID, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    project, _ = await require_project(db, user, project_id)
    return configuration(project)


@router.put("/projects/{project_id}/configuration", response_model=WorkspaceConfig)
async def save_configuration(project_id: uuid.UUID, payload: WorkspaceConfig, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    project, _ = await require_project(db, user, project_id, "admin", for_update=True)
    ensure_writable(project)
    roles = await member_ids(db, project_id)
    if any(component.lead_id and roles.get(component.lead_id) not in ("admin", "member") for component in payload.components):
        raise HTTPException(422, "Component owners must be project members or administrators.")
    issues = (await db.scalars(select(PmIssue).where(PmIssue.project_id == project_id))).all()
    proposed = PmProject(workspace_config=payload.model_dump(mode="json"))
    fields = {field.key for field in payload.fields}
    for issue in issues:
        key = issue.workflow_state or issue.status
        states = {state.key: state for state in payload.states}
        if key not in states or states[key].category != issue.status:
            raise HTTPException(409, "Move issues out of a state before removing it or changing its category.")
        try:
            values = issue.custom_fields or {}
            if any(key not in fields and value not in (None, "") for key, value in values.items()):
                raise HTTPException(409, "Clear an issue's field values before removing that field.")
            cleaned = {key: value for key, value in values.items() if key in fields}
            apply_workspace_fields(proposed, {"custom_fields": cleaned}, issue)
            if cleaned != values:
                issue.custom_fields = cleaned
        except HTTPException as exc:
            raise HTTPException(409, f"Existing issue data conflicts with this configuration: {exc.detail}")
    project.workspace_config = payload.model_dump(mode="json")
    record(db, user=user, action="updated", entity_type="pm_project", entity_id=project.id,
           summary=f"Updated {project.key} workflow and fields")
    await db.commit()
    return payload


async def validate_view(db, user, project, payload):
    filter_query(payload.settings.filters, user)
    if project:
        if payload.settings.filters.project_ids and payload.settings.filters.project_ids != [project.id]:
            raise HTTPException(422, "A project view cannot include other projects.")
        states = {state.key for state in configuration(project).states}
        mapped = {key for column in payload.settings.columns for key in column.states}
        if payload.settings.columns and mapped != states:
            raise HTTPException(422, "Map every workflow state to one board column.")
        if payload.settings.board_type == "scrum" and not project.sprints_enabled:
            raise HTTPException(409, "Turn on project sprints before creating a Scrum board.")
    elif payload.visibility != "private" or payload.settings.layout == "board":
        raise HTTPException(422, "Cross-project views must be private lists, tables or calendars.")


async def view_access(db, user, view_id, *, write=False):
    view = await db.get(PmView, view_id)
    if not view:
        raise HTTPException(404, "View not found")
    project, role = (None, None)
    if view.project_id:
        project, role = await require_project(db, user, view.project_id, for_update=write)
    if write:
        view = await db.scalar(select(PmView).where(PmView.id == view_id).with_for_update().execution_options(populate_existing=True))
        if not view:
            raise HTTPException(404, "View not found")
    if view.visibility == "private" and view.owner_id != user.id:
        raise HTTPException(404, "View not found")
    if write:
        if project:
            ensure_writable(project)
        if (view.visibility == "team" and role != "admin") or (view.visibility == "private" and view.owner_id != user.id):
            raise HTTPException(403, "You cannot manage this view.")
    return view, project, role


def view_out(view, user, role=None):
    out = ViewOut.model_validate(view)
    out.can_manage = view.owner_id == user.id if view.visibility == "private" else role == "admin"
    return out


@router.get("/projects/{project_id}/views", response_model=list[ViewOut])
async def project_views(project_id: uuid.UUID, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    _, role = await require_project(db, user, project_id)
    rows = (await db.scalars(select(PmView).where(
        PmView.project_id == project_id, or_(PmView.visibility == "team", PmView.owner_id == user.id)
    ).order_by(PmView.created_at, PmView.id))).all()
    return [view_out(view, user, role) for view in rows]


@router.get("/views", response_model=list[ViewOut])
async def global_views(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    rows = (await db.scalars(select(PmView).where(PmView.project_id.is_(None), PmView.owner_id == user.id).order_by(PmView.name))).all()
    return [view_out(view, user) for view in rows]


@router.post("/views", response_model=ViewOut, status_code=201)
async def create_view(payload: ViewCreate, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    project, role = (None, None)
    if payload.project_id:
        project, role = await require_project(db, user, payload.project_id,
                                             "admin" if payload.visibility == "team" else "viewer", for_update=True)
        ensure_writable(project)
    await validate_view(db, user, project, payload)
    view = PmView(project_id=payload.project_id, owner_id=user.id, name=payload.name,
                  visibility=payload.visibility, settings=payload.settings.model_dump(mode="json"))
    db.add(view)
    await db.commit()
    await db.refresh(view)
    return view_out(view, user, role)


@router.patch("/views/{view_id}", response_model=ViewOut)
async def update_view(view_id: uuid.UUID, payload: ViewIn, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    view, project, role = await view_access(db, user, view_id, write=True)
    if payload.visibility != view.visibility:
        raise HTTPException(422, "Duplicate the view to change its visibility.")
    await validate_view(db, user, project, payload)
    view.name, view.settings = payload.name, payload.settings.model_dump(mode="json")
    await db.commit()
    await db.refresh(view)
    return view_out(view, user, role)


@router.delete("/views/{view_id}", status_code=204)
async def delete_view(view_id: uuid.UUID, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    view, _, _ = await view_access(db, user, view_id, write=True)
    await db.delete(view)
    await db.commit()


@router.get("/issues/page")
async def issue_page(
    project_id: uuid.UUID | None = None, q: str = Query("", max_length=255),
    issue_type: str = "", status: str = "", workflow_state: str = "", priority: str = "",
    assignee: str = "", parent_id: str = "", sprint: str = "", label: str = "",
    component: str = "", due_after: str = "", due_before: str = "",
    order_by: str = "rank", offset: int = Query(0, ge=0), limit: int = Query(50, ge=1, le=200),
    include_archived: bool = False, project_ids: list[uuid.UUID] = Query(default=[]),
    db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user),
):
    from app.api.pm import _issue_outs
    filters = ViewFilters(q=q, issue_type=issue_type, status=status, workflow_state=workflow_state,
                         priority=priority, assignee=assignee, parent_id=parent_id, sprint=sprint,
                         label=label, component=component, due_after=due_after, due_before=due_before,
                         project_ids=project_ids)
    stmt = filter_query(filters, user)
    if project_id:
        await require_project(db, user, project_id)
        stmt = stmt.where(PmIssue.project_id == project_id)
    else:
        ids = await visible_project_ids(db, user)
        if ids is not None:
            stmt = stmt.where(PmIssue.project_id.in_(ids))
    if not include_archived:
        stmt = stmt.where(PmProject.status == "active")
    order = {
        "rank": PmIssue.rank, "updated": PmIssue.updated_at.desc(), "created": PmIssue.created_at.desc(),
        "due": PmIssue.due_date.asc().nulls_last(),
        "priority": case(*[(PmIssue.priority == key, index) for index, key in enumerate(ISSUE_PRIORITIES)], else_=5),
    }.get(order_by)
    if order is None:
        raise HTTPException(422, "Invalid issue ordering.")
    total = await db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    offset = min(offset, max(0, (total - 1) // limit * limit))
    rows = (await db.scalars(stmt.order_by(order, PmIssue.id).offset(offset).limit(limit))).all()
    grouped = defaultdict(list)
    for row in rows:
        grouped[row.project_id].append(row)
    outs = {}
    for project, issues in grouped.items():
        item = await db.get(PmProject, project)
        for out in await _issue_outs(db, item, issues):
            outs[out.id] = out
    return {"items": [outs[row.id] for row in rows], "total": total, "offset": offset, "limit": limit}


@router.post("/issues/bulk")
async def bulk_update(payload: BulkUpdate, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    from app.api.pm import apply_issue_update
    # Lock all projects in a stable order before any mutation; one transaction
    # preserves all-or-nothing history, notifications and issue changes.
    rows = (await db.scalars(select(PmIssue).where(PmIssue.id.in_(payload.issue_ids)))).all()
    if len(rows) != len(payload.issue_ids):
        raise HTTPException(404, "Issue not found")
    for project_id in sorted({row.project_id for row in rows}, key=str):
        project, _ = await require_project(db, user, project_id, "member", for_update=True)
        ensure_writable(project)
    items = [await apply_issue_update(issue_id, payload.changes, db, user) for issue_id in payload.issue_ids]
    await db.commit()
    return {"items": items, "updated": len(items)}


@router.post("/issues/{issue_id}/duplicate", status_code=201)
async def duplicate_issue(issue_id: uuid.UUID, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    from app.api.pm import _load_issue, create_issue
    issue, project, _ = await _load_issue(db, user, str(issue_id), "member")
    ensure_writable(project)
    payload = PmIssueCreate(
        summary=f"Copy of {issue.summary}"[:255], description=issue.description, issue_type=issue.issue_type,
        priority=issue.priority, story_points=issue.story_points, labels=issue.labels or [],
        parent_id=issue.parent_id, component=issue.component, custom_fields=issue.custom_fields or {},
    )
    # New work starts in To Do/backlog and has no imported key, attachments,
    # watchers, comments or history copied from another person's work.
    return await create_issue(project.id, payload, db, user)
