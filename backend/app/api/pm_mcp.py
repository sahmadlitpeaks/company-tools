"""MCP server exposing the project tracker to AI assistants (ChatGPT, Claude...).

Mounted at ``/api/mcp/`` using the Streamable HTTP transport in stateless JSON
mode. Clients authenticate with a personal access token
(``Authorization: Bearer pmt_...``, see app/api/pm_tokens.py) and act as the
token's owner: every tool calls the same handlers as the web app, so project
roles, validation, history and notifications apply unchanged. Write tools need
a write token and the ``projects_ai_write`` permission at the time of the call.
"""
import contextvars
import json
import uuid
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Annotated, Any, Literal

from fastapi import HTTPException
from mcp.server.fastmcp import FastMCP
from mcp.server.transport_security import TransportSecuritySettings
from mcp.types import ToolAnnotations
from pydantic import Field
from sqlalchemy import func, select

from app.api import pm as pm_api
from app.api.pm_tokens import may_write, token_state
from app.core.database import AsyncSessionLocal
from app.core.permissions import active_permissions
from app.models.pm import ISSUE_STATUSES, PmAccessToken, PmIssue, PmSprint
from app.models.user import User
from app.schemas.pm import PmCommentIn, PmIssueCreate, PmIssueUpdate
from app.services.pm_workspace import configuration as pm_workspace_configuration
from app.services import crypto


@dataclass(frozen=True)
class Caller:
    user_id: uuid.UUID
    can_write: bool


_caller: contextvars.ContextVar[Caller | None] = contextvars.ContextVar("pm_mcp_caller", default=None)

mcp = FastMCP(
    "company_tools_tracker_mcp",
    instructions=(
        "Project tracker for the company's development work (Jira-style). Projects have keys "
        "like LIMS; issues have keys like LIMS-12. Issue types: epic, story, task, bug, subtask. "
        "Statuses: todo, in_progress, in_review, done. You act as the person who created the "
        "access token and only see their projects. Use tracker_list_projects first, then "
        "tracker_search_issues or tracker_get_project_summary."
    ),
    stateless_http=True,
    json_response=True,
    streamable_http_path="/",
    # Requests arrive through the app's own proxy and are authenticated by token.
    transport_security=TransportSecuritySettings(enable_dns_rebinding_protection=False),
)

READ = ToolAnnotations(readOnlyHint=True, destructiveHint=False, idempotentHint=True, openWorldHint=False)
WRITE = ToolAnnotations(readOnlyHint=False, destructiveHint=False, idempotentHint=False, openWorldHint=False)
IDEMPOTENT_WRITE = ToolAnnotations(readOnlyHint=False, destructiveHint=False, idempotentHint=True, openWorldHint=False)

Status = Literal["todo", "in_progress", "in_review", "done"]
IssueType = Literal["epic", "story", "task", "bug", "subtask"]
Priority = Literal["highest", "high", "medium", "low", "lowest"]


class ToolFailure(Exception):
    """An error message the assistant can act on."""


class _Session:
    """A database session and the calling user for one tool call."""

    async def __aenter__(self):
        caller = _caller.get()
        if caller is None:
            raise ToolFailure("Not authenticated. Send a personal access token as a Bearer token.")
        self.db = AsyncSessionLocal()
        self.user = await self.db.get(User, caller.user_id)
        if not self.user or not self.user.is_active or self.user.status != "active":
            await self.db.close()
            raise ToolFailure("This token's account is no longer active.")
        if self.user.must_change_password:
            await self.db.close()
            raise ToolFailure("Change your password in the platform before using AI access.")
        self.caller = caller
        return self

    async def __aexit__(self, *exc):
        await self.db.close()

    async def require_write(self) -> None:
        if not self.caller.can_write:
            raise ToolFailure("This token is read-only. Create a read and write token under Projects > AI access.")
        if not await may_write(self.db, self.user):
            raise ToolFailure("Your account doesn't have Projects AI write access. Ask an administrator to grant it.")


def _fail(exc: HTTPException) -> ToolFailure:
    detail = exc.detail if isinstance(exc.detail, str) else json.dumps(exc.detail)
    if exc.status_code == 404:
        return ToolFailure(f"{detail}. Check the key, or call tracker_list_projects to see what you can access.")
    if exc.status_code == 403:
        return ToolFailure(f"{detail}. Your project role doesn't allow this (viewers can only read and comment).")
    return ToolFailure(detail)


async def _project(s: _Session, project_key: str):
    project = await pm_api._project_by_ref(s.db, project_key.strip())
    if not project:
        raise ToolFailure(f"Project {project_key} not found. Call tracker_list_projects to see project keys.")
    try:
        await pm_api.require_project(s.db, s.user, project.id)
    except HTTPException as exc:
        raise _fail(exc)
    return project


async def _issue_id(s: _Session, issue_key: str) -> uuid.UUID:
    try:
        issue, _, _ = await pm_api._load_issue(s.db, s.user, issue_key.strip())
    except HTTPException as exc:
        raise _fail(exc)
    return issue.id


async def _person(s: _Session, email: str | None) -> uuid.UUID | None:
    if not email or email.strip().lower() in ("none", "unassigned"):
        return None
    if email.strip().lower() == "me":
        return s.user.id
    person = await s.db.scalar(select(User).where(func.lower(User.email) == email.strip().lower()))
    if not person:
        raise ToolFailure(f"No account with email {email}. Use an exact work email, 'me' or 'none'.")
    return person.id


def _brief(issue) -> dict[str, Any]:
    return {
        "key": issue.key, "type": issue.issue_type, "summary": issue.summary, "status": issue.status,
        "workflow_state": getattr(issue, "workflow_state", None), "workflow_name": getattr(issue, "workflow_name", None),
        "component": getattr(issue, "component", None), "custom_fields": getattr(issue, "custom_fields", None) or {},
        "priority": issue.priority, "story_points": issue.story_points, "assignee": issue.assignee_name,
        "epic_or_parent": issue.parent.key if issue.parent else None, "sprint": issue.sprint_name,
        "start_date": issue.start_date, "due_date": issue.due_date,
    }


def _jsonable(value):
    return json.loads(json.dumps(value, default=lambda v: v.isoformat() if isinstance(v, (date, datetime)) else str(v)))


async def _call(handler, *args, **kwargs):
    try:
        return await handler(*args, **kwargs)
    except HTTPException as exc:
        raise _fail(exc)


# ------------------------------------------------------------------- read
@mcp.tool(annotations=READ)
async def tracker_list_projects() -> dict[str, Any]:
    """List the active projects you can see, with your role, health and progress."""
    async with _Session() as s:
        projects = await pm_api.list_projects(status="active", db=s.db, user=s.user)
        return _jsonable({"projects": [
            {
                "key": p.key, "name": p.name, "your_role": p.my_role, "health": p.health, "lead": p.lead_name,
                "issues": p.issue_count, "done": p.done_count, "overdue": p.overdue_count,
                "uses_sprints": p.sprints_enabled, "target_date": p.target_date,
            }
            for p in projects
        ]})


@mcp.tool(annotations=READ)
async def tracker_get_project_summary(
    project_key: Annotated[str, Field(description="Project key, e.g. LIMS")],
) -> dict[str, Any]:
    """Status of one project: health, issue counts by status, the active sprint, overdue issues and epic progress."""
    async with _Session() as s:
        project = await _project(s, project_key)
        [out] = await pm_api._project_outs(s.db, s.user, [project])
        issues = (await s.db.scalars(select(PmIssue).where(PmIssue.project_id == project.id))).all()
        work = [i for i in issues if i.issue_type != "epic"]
        counts = {status: sum(1 for i in work if i.status == status) for status in ISSUE_STATUSES}
        today = date.today()
        overdue = sorted((i for i in work if i.status != "done" and i.due_date and i.due_date < today), key=lambda i: i.due_date)
        sprint = await s.db.scalar(select(PmSprint).where(PmSprint.project_id == project.id, PmSprint.status == "active"))
        epics = []
        for epic in sorted((i for i in issues if i.issue_type == "epic"), key=lambda e: (e.rank, e.number)):
            children = [i for i in work if i.parent_id == epic.id]
            epics.append({"key": f"{project.key}-{epic.number}", "summary": epic.summary, "status": epic.status,
                          "done": sum(1 for c in children if c.status == "done"), "issues": len(children)})
        sprint_out = None
        if sprint:
            in_sprint = [i for i in work if i.sprint_id == sprint.id]
            sprint_out = {
                "name": sprint.name, "goal": sprint.goal, "start_date": sprint.start_date, "end_date": sprint.end_date,
                "points": sum(i.story_points or 0 for i in in_sprint),
                "done_points": sum(i.story_points or 0 for i in in_sprint if i.status == "done"),
                "issues": len(in_sprint), "done": sum(1 for i in in_sprint if i.status == "done"),
            }
        return _jsonable({
            "project": {"key": project.key, "name": project.name, "health": out.health, "lead": out.lead_name,
                        "start_date": project.start_date, "target_date": project.target_date},
            "workspace_configuration": pm_workspace_configuration(project).model_dump(mode="json"),
            "issues_by_status": counts,
            "active_sprint": sprint_out,
            "overdue": [{"key": f"{project.key}-{i.number}", "summary": i.summary, "due_date": i.due_date} for i in overdue[:10]],
            "overdue_total": len(overdue),
            "epics": epics,
        })


@mcp.tool(annotations=READ)
async def tracker_search_issues(
    project_key: Annotated[str, Field(description="Project key, e.g. LIMS")],
    query: Annotated[str | None, Field(description="Words from the summary, or an exact issue key")] = None,
    status: Annotated[Status | None, Field(description="Only this status")] = None,
    issue_type: Annotated[IssueType | None, Field(description="Only this type")] = None,
    assignee: Annotated[str | None, Field(description="'me', 'none' for unassigned, or a work email")] = None,
    sprint: Annotated[Literal["active", "backlog"] | None, Field(description="Only the active sprint or the backlog")] = None,
    limit: Annotated[int, Field(ge=1, le=100)] = 25,
    offset: Annotated[int, Field(ge=0)] = 0,
) -> dict[str, Any]:
    """Find issues in a project, in backlog order, with paging."""
    async with _Session() as s:
        project = await _project(s, project_key)
        # The web API takes "me", "none" or a user id.
        who = assignee.strip().lower() if assignee else None
        if who and who not in ("me", "none"):
            who = str(await _person(s, who))
        issues = await _call(
            pm_api.list_issues, project.id, issue_type=issue_type, status=status, assignee=who,
            parent_id=None, sprint=sprint, label=None, q=query, db=s.db, user=s.user,
        )
        page = issues[offset:offset + limit]
        return _jsonable({
            "total": len(issues), "count": len(page), "offset": offset,
            "has_more": offset + len(page) < len(issues),
            "next_offset": offset + len(page) if offset + len(page) < len(issues) else None,
            "issues": [_brief(i) for i in page],
        })


@mcp.tool(annotations=READ)
async def tracker_get_issue(
    issue_key: Annotated[str, Field(description="Issue key, e.g. LIMS-12")],
) -> dict[str, Any]:
    """Full details of one issue: description, people, dates, labels, sub-issues, links and recent comments."""
    async with _Session() as s:
        detail = await _call(pm_api.get_issue, issue_key.strip(), db=s.db, user=s.user)
        comments = await _call(pm_api.list_comments, detail.id, db=s.db, user=s.user)
        return _jsonable({
            **_brief(detail),
            "project": detail.project_key, "description": detail.description, "labels": detail.labels or [],
            "reporter": detail.reporter_name, "created_at": detail.created_at, "resolved_at": detail.resolved_at,
            "jira_key": detail.external_key, "your_role": detail.my_role,
            "children": [_brief(c) for c in detail.children],
            "links": [{"relation": l.relation, "key": l.issue.key, "summary": l.issue.summary, "status": l.issue.status} for l in detail.links],
            "watchers": [w.name for w in detail.watchers],
            "comments": [{"author": c.author_name, "at": c.created_at, "body": c.body} for c in comments[-20:]],
            "comment_total": len(comments),
        })


# ------------------------------------------------------------------ write
@mcp.tool(annotations=WRITE)
async def tracker_create_issue(
    project_key: Annotated[str, Field(description="Project key, e.g. LIMS")],
    summary: Annotated[str, Field(min_length=1, max_length=255)],
    issue_type: IssueType = "task",
    description: str | None = None,
    priority: Priority = "medium",
    story_points: Annotated[float | None, Field(ge=0, le=1000)] = None,
    parent_key: Annotated[str | None, Field(description="Epic key for a story/task/bug, or the parent issue key for a subtask")] = None,
    assignee: Annotated[str | None, Field(description="'me' or a work email of a project member")] = None,
    labels: list[str] | None = None,
    start_date: Annotated[date | None, Field(description="YYYY-MM-DD")] = None,
    due_date: Annotated[date | None, Field(description="YYYY-MM-DD")] = None,
    in_active_sprint: Annotated[bool, Field(description="Put a story, task or bug straight into the active sprint")] = False,
    workflow_state: Annotated[str | None, Field(description="Named state key from the project summary's workspace configuration")] = None,
    component: Annotated[str | None, Field(description="Component key from the project summary")] = None,
    custom_fields: Annotated[dict[str, Any] | None, Field(description="Custom field keys and typed values from the project summary")] = None,
) -> dict[str, Any]:
    """Create an issue. Needs a read and write token and member access to the project. Returns the new key."""
    async with _Session() as s:
        await s.require_write()
        project = await _project(s, project_key)
        sprint_id = None
        if in_active_sprint:
            sprint = await s.db.scalar(select(PmSprint).where(PmSprint.project_id == project.id, PmSprint.status == "active"))
            if not sprint:
                raise ToolFailure("This project has no active sprint; leave in_active_sprint false to use the backlog.")
            sprint_id = sprint.id
        payload = PmIssueCreate(
            issue_type=issue_type, summary=summary, description=description, priority=priority,
            story_points=story_points, labels=labels or [], assignee_id=await _person(s, assignee),
            parent_id=await _issue_id(s, parent_key) if parent_key else None,
            start_date=start_date, due_date=due_date, sprint_id=sprint_id,
            workflow_state=workflow_state, component=component, custom_fields=custom_fields or {},
        )
        created = await _call(pm_api.create_issue, project.id, payload, db=s.db, user=s.user)
        return _jsonable({"created": _brief(created)})


@mcp.tool(annotations=IDEMPOTENT_WRITE)
async def tracker_update_issue(
    issue_key: Annotated[str, Field(description="Issue key, e.g. LIMS-12")],
    summary: Annotated[str | None, Field(max_length=255)] = None,
    description: str | None = None,
    priority: Priority | None = None,
    story_points: Annotated[float | None, Field(ge=0, le=1000)] = None,
    assignee: Annotated[str | None, Field(description="'me', 'none' to unassign, or a work email")] = None,
    labels: Annotated[list[str] | None, Field(description="Replaces all labels")] = None,
    start_date: Annotated[date | None, Field(description="YYYY-MM-DD")] = None,
    due_date: Annotated[date | None, Field(description="YYYY-MM-DD")] = None,
    workflow_state: Annotated[str | None, Field(description="Named state key; project transition rules apply")] = None,
    component: Annotated[str | None, Field(description="Component key, or 'none' to clear")] = None,
    custom_fields: Annotated[dict[str, Any] | None, Field(description="Replaces all custom field values; required fields must be included")] = None,
) -> dict[str, Any]:
    """Change fields on an issue; only the fields you pass change. Use tracker_move_issue for status."""
    async with _Session() as s:
        await s.require_write()
        issue_id = await _issue_id(s, issue_key)
        changes = {
            key: value for key, value in {
                "summary": summary, "description": description, "priority": priority, "story_points": story_points,
                "labels": labels, "start_date": start_date, "due_date": due_date,
                "workflow_state": workflow_state, "custom_fields": custom_fields,
            }.items() if value is not None
        }
        if assignee is not None:
            changes["assignee_id"] = await _person(s, assignee)
        if component is not None:
            changes["component"] = None if component == "none" else component
        if not changes:
            raise ToolFailure("Pass at least one field to change.")
        updated = await _call(pm_api.update_issue, issue_id, PmIssueUpdate(**changes), db=s.db, user=s.user)
        return _jsonable({"updated": _brief(updated), "changed": sorted(changes)})


@mcp.tool(annotations=IDEMPOTENT_WRITE)
async def tracker_move_issue(
    issue_key: Annotated[str, Field(description="Issue key, e.g. LIMS-12")],
    status: Status,
) -> dict[str, Any]:
    """Move an issue to another workflow status (todo, in_progress, in_review, done)."""
    async with _Session() as s:
        await s.require_write()
        issue_id = await _issue_id(s, issue_key)
        moved = await _call(pm_api.update_issue, issue_id, PmIssueUpdate(status=status), db=s.db, user=s.user)
        return _jsonable({"moved": _brief(moved)})


@mcp.tool(annotations=WRITE)
async def tracker_add_comment(
    issue_key: Annotated[str, Field(description="Issue key, e.g. LIMS-12")],
    body: Annotated[str, Field(min_length=1, max_length=20000)],
) -> dict[str, Any]:
    """Add a comment to an issue as yourself. Watchers are notified."""
    async with _Session() as s:
        await s.require_write()
        issue_id = await _issue_id(s, issue_key)
        comment = await _call(pm_api.add_comment, issue_id, PmCommentIn(body=body), db=s.db, user=s.user)
        return _jsonable({"comment_id": str(comment.id), "issue": issue_key.upper()})


# -------------------------------------------------------------- transport
class TokenAuth:
    """ASGI wrapper: resolve the Bearer token to a user before MCP sees the request."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        headers = dict(scope.get("headers") or [])
        auth = headers.get(b"authorization", b"").decode()
        secret = auth[7:].strip() if auth.lower().startswith("bearer ") else ""
        caller = await self._resolve(secret) if secret else None
        if caller is None:
            body = json.dumps({"error": "A valid personal access token is required (Authorization: Bearer pmt_...)."}).encode()
            await send({"type": "http.response.start", "status": 401, "headers": [
                (b"content-type", b"application/json"), (b"www-authenticate", b'Bearer realm="projects"'),
            ]})
            await send({"type": "http.response.body", "body": body})
            return
        reset = _caller.set(caller)
        try:
            await self.app(scope, receive, send)
        finally:
            _caller.reset(reset)

    @staticmethod
    async def _resolve(secret: str) -> Caller | None:
        async with AsyncSessionLocal() as db:
            token = await db.scalar(select(PmAccessToken).where(PmAccessToken.token_hash == crypto.token_hash(secret)))
            if not token or token_state(token) != "active":
                return None
            user = await db.get(User, token.user_id)
            if not user or not user.is_active or user.status != "active" or user.must_change_password:
                return None
            if "projects" not in await active_permissions(user, db):
                return None
            now = datetime.now(timezone.utc)
            last = token.last_used_at.replace(tzinfo=timezone.utc) if token.last_used_at and token.last_used_at.tzinfo is None else token.last_used_at
            if not last or now - last > timedelta(minutes=1):
                token.last_used_at = now
                await db.commit()
            return Caller(user_id=user.id, can_write=token.can_write)


class _Served:
    """The SDK's ASGI app, rebuilt for each run of the application.

    A session manager can only be started once, so every application lifespan
    (and every test) gets a fresh one.
    """

    app = None

    async def __call__(self, scope, receive, send):
        if self.app is None:
            body = b'{"error": "The AI endpoint is starting; try again shortly."}'
            await send({"type": "http.response.start", "status": 503, "headers": [(b"content-type", b"application/json")]})
            await send({"type": "http.response.body", "body": body})
            return
        await self.app(scope, receive, send)


_served = _Served()


@asynccontextmanager
async def running():
    """Run the MCP session manager for the lifetime of the application."""
    mcp._session_manager = None  # private in the SDK; reset so a new manager is built
    _served.app = mcp.streamable_http_app()
    try:
        async with mcp.session_manager.run():
            yield
    finally:
        _served.app = None


def mcp_asgi_app():
    """The authenticated ASGI app to mount at /api/mcp."""
    return TokenAuth(_served)


class _ExactPath:
    """Serve ``/api/mcp`` (no trailing slash) directly instead of redirecting:
    some clients drop the Authorization header when following a redirect.
    A class, so Starlette treats it as an ASGI app rather than a request handler."""

    def __init__(self, prefix: str):
        self.prefix = prefix
        self.inner = mcp_asgi_app()

    async def __call__(self, scope, receive, send):
        scope = {**scope, "path": "/", "raw_path": b"/", "root_path": scope.get("root_path", "") + self.prefix}
        await self.inner(scope, receive, send)


def mcp_exact_path_app(prefix: str) -> _ExactPath:
    return _ExactPath(prefix)
