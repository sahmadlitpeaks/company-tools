"""Move issues between projects (BRD section 8, MOV-01..10).

``POST /pm/issues/move/preview`` returns every change a move would make without
touching anything; ``POST /pm/issues/move`` makes it. Both take one issue or a
bulk selection of up to 100 (all-or-nothing).

An issue keeps its identity (id, comments, attachments, history, links,
watchers that can still see it) and gets the next key from the target project.
The old key is stored in ``pm_issue_key_aliases`` and keeps resolving.

Rules:

* ``issue.move_out`` on every source project, ``issue.move_in`` on the target.
* Archived projects can't send or receive issues.
* Sub-tasks always move with their parent. An epic's issues move with it only
  when ``move_children`` is set; otherwise they stay and lose the epic link.
* Sprint is cleared (the issue lands in the target backlog). Closed sprints keep
  their recorded committed and completed points, so reports don't change.
* The workflow state, component and custom fields are kept when the target has
  the same key; otherwise the state falls back and the values are dropped, and
  each drop is written to the issue's history.
"""
import uuid
from dataclasses import dataclass, field
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.core.database import get_db
from app.models.pm import (
    PmIssue,
    PmIssueHistory,
    PmIssueKeyAlias,
    PmIssueWatcher,
    PmProject,
    PmProjectMember,
)
from app.models.user import User
from app.services.activity import record
from app.services.notify import notify_user
from app.services.people import user_names
from app.services.pm_access import (
    ProjectAccess,
    ensure_writable,
    member_access,
    project_access,
    require_project,
)
from app.services.pm_workspace import configuration

router = APIRouter(prefix="/pm", tags=["project-tracker"])

MAX_ISSUES = 100


class MoveRequest(BaseModel):
    issue_ids: list[uuid.UUID] = Field(min_length=1, max_length=MAX_ISSUES)
    target_project_id: uuid.UUID
    # Target workflow state for issues whose state key doesn't exist there.
    workflow_state: str | None = None
    # Epic in the target for moved stories, tasks and bugs (else the epic link is cleared).
    epic_id: uuid.UUID | None = None
    # When an epic moves: take its issues along, or leave them and clear their epic.
    move_children: bool = True
    # Assignees who aren't target members: unassign, or add them to the target.
    assignee_action: Literal["unassign", "add_member"] = "unassign"
    assignee_role: str = "member"


@dataclass
class _Item:
    issue: PmIssue
    source: PmProject
    old_key: str
    number: int = 0
    state: str = ""
    category: str = ""
    component: str | None = None
    custom_fields: dict = field(default_factory=dict)
    assignee_id: uuid.UUID | None = None
    parent_id: uuid.UUID | None = None
    clear_external_key: bool = False
    dropped: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)
    selected: bool = True


@dataclass
class _Plan:
    target: PmProject
    target_access: ProjectAccess
    items: list[_Item]
    stay_behind: list[PmIssue]
    add_members: set[uuid.UUID]
    losing_access: dict[uuid.UUID, str]


def _key(project: PmProject, number: int) -> str:
    return f"{project.key}-{number}"


async def _plan(db: AsyncSession, user: User, payload: MoveRequest, *, lock: bool) -> _Plan:
    ids = list(dict.fromkeys(payload.issue_ids))
    selected = list((await db.scalars(select(PmIssue).where(PmIssue.id.in_(ids)))).all())
    if len(selected) != len(ids):
        raise HTTPException(404, "Issue not found")
    target = await db.get(PmProject, payload.target_project_id)
    if not target:
        raise HTTPException(404, "Project not found")

    # Lock every project involved in a stable order (MOV-03): the target's key
    # sequence and each source's membership can't change underneath the move.
    project_ids = sorted({i.project_id for i in selected} | {target.id}, key=str)
    projects: dict[uuid.UUID, PmProject] = {}
    accesses: dict[uuid.UUID, ProjectAccess] = {}
    for pid in project_ids:
        needed = "issue.move_in" if pid == target.id else "issue.move_out"
        if pid == target.id and pid in {i.project_id for i in selected}:
            raise HTTPException(422, "Those issues are already in that project.")
        projects[pid], accesses[pid] = await require_project(db, user, pid, needed, for_update=lock)
        ensure_writable(projects[pid])
    target, target_access = projects[target.id], accesses[target.id]
    if lock:
        selected = list((await db.scalars(
            select(PmIssue).where(PmIssue.id.in_(ids)).execution_options(populate_existing=True)
        )).all())
        order = {issue_id: index for index, issue_id in enumerate(ids)}
        selected.sort(key=lambda issue: order[issue.id])

    chosen = {i.id for i in selected}
    for issue in selected:
        if issue.issue_type == "subtask" and issue.parent_id not in chosen:
            raise HTTPException(422, "Sub-tasks move with their parent. Select the parent issue instead.")

    # Expand: sub-tasks always follow; an epic's issues (and their sub-tasks) only when asked.
    moving: list[PmIssue] = list(selected)
    stay_behind: list[PmIssue] = []
    frontier = [i for i in selected]
    while frontier:
        parents = {i.id: i for i in frontier}
        children = list((await db.scalars(
            select(PmIssue).where(PmIssue.parent_id.in_(parents)).order_by(PmIssue.number)
        )).all())
        frontier = []
        for child in children:
            if child.id in chosen:
                continue
            parent = parents[child.parent_id]
            if parent.issue_type == "epic" and not payload.move_children:
                stay_behind.append(child)
                continue
            chosen.add(child.id)
            moving.append(child)
            frontier.append(child)

    config = configuration(target)
    states = {s.key: s for s in config.states}
    if payload.workflow_state and payload.workflow_state not in states:
        raise HTTPException(422, f"{target.key} has no workflow state '{payload.workflow_state}'.")
    components = {c.key for c in config.components}
    fields = {f.key: f for f in config.fields}
    epic = None
    if payload.epic_id:
        epic = await db.get(PmIssue, payload.epic_id)
        if not epic or epic.project_id != target.id or epic.issue_type != "epic":
            raise HTTPException(422, f"Choose an epic in {target.key}.")
    members = await member_access(db, target.id)
    taken = set((await db.scalars(select(PmIssue.external_key).where(
        PmIssue.project_id == target.id, PmIssue.external_key.is_not(None)
    ))).all())

    items: list[_Item] = []
    add_members: set[uuid.UUID] = set()
    next_number = target.issue_seq
    for issue in moving:
        source = projects.get(issue.project_id) or await db.get(PmProject, issue.project_id)
        item = _Item(issue=issue, source=source, old_key=_key(source, issue.number), selected=issue.id in {s.id for s in selected})
        next_number += 1
        item.number = next_number

        current = issue.workflow_state or issue.status
        if current in states:
            item.state = current
        else:
            fallback = payload.workflow_state or next(
                (s.key for s in config.states if s.category == issue.status), None
            ) or next(s.key for s in config.states if s.category == "todo")
            item.state = fallback
            item.notes.append(f"Status '{current}' doesn't exist in {target.key}; it becomes '{states[fallback].name}'.")
        item.category = states[item.state].category

        if issue.component and issue.component not in components:
            item.dropped.append(f"component {issue.component}")
        else:
            item.component = issue.component
        for key, value in (issue.custom_fields or {}).items():
            definition = fields.get(key)
            if definition is None or (definition.kind == "select" and value not in definition.options):
                item.dropped.append(f"field {key}={value}")
            else:
                item.custom_fields[key] = value

        item.assignee_id = issue.assignee_id
        if issue.assignee_id and not (issue.assignee_id in members and members[issue.assignee_id].assignable):
            if payload.assignee_action == "add_member":
                add_members.add(issue.assignee_id)
            else:
                item.assignee_id = None
                item.notes.append("Assignee isn't on the target project; the issue will be unassigned.")

        if issue.parent_id in chosen:
            item.parent_id = issue.parent_id
        elif issue.issue_type in ("story", "task", "bug") and epic is not None:
            item.parent_id = epic.id
        else:
            item.parent_id = None
            if issue.parent_id:
                item.notes.append("Its epic stays behind, so the epic link is cleared.")
        if issue.external_key and issue.external_key in taken:
            item.clear_external_key = True
            item.notes.append(f"Jira key {issue.external_key} is already used in {target.key}; it is cleared.")
        items.append(item)

    if add_members:
        from app.api.pm import _check_grant

        if not target_access.can("members.manage"):
            raise HTTPException(403, f"Adding assignees to {target.key} needs the members.manage permission there.")
        await _check_grant(db, target_access, payload.assignee_role, [], [])

    # People who watch or reported the issues but won't see the target (MOV-02).
    watcher_rows = (await db.execute(select(PmIssueWatcher.user_id).where(
        PmIssueWatcher.issue_id.in_([i.issue.id for i in items])
    ))).all()
    people = {uid for (uid,) in watcher_rows} | {i.issue.reporter_id for i in items if i.issue.reporter_id}
    losing: dict[uuid.UUID, str] = {}
    candidates = people - set(members) - add_members
    if candidates:
        names = await user_names(db, candidates)
        for uid in candidates:
            person = await db.get(User, uid)
            if person is None or await project_access(db, person, target.id) is None:
                losing[uid] = names.get(uid) or "A former member"
    return _Plan(target, target_access, items, stay_behind, add_members, losing)


def _preview(plan: _Plan) -> dict:
    return {
        "target": {"id": str(plan.target.id), "key": plan.target.key, "name": plan.target.name},
        "issues": [{
            "id": str(i.issue.id), "old_key": i.old_key, "new_key": _key(plan.target, i.number),
            "summary": i.issue.summary, "issue_type": i.issue.issue_type, "selected": i.selected,
            "status_from": i.issue.workflow_state or i.issue.status, "status_to": i.state,
            "dropped": i.dropped, "notes": i.notes,
        } for i in plan.items],
        "left_behind": [{"id": str(i.id), "summary": i.summary} for i in plan.stay_behind],
        "people_losing_access": sorted(plan.losing_access.values()),
        "assignees_added": len(plan.add_members),
        "count": len(plan.items),
    }


@router.post("/issues/move/preview")
async def preview_move(
    payload: MoveRequest, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user),
):
    """Every change a move would make; nothing changes (MOV-02)."""
    return _preview(await _plan(db, user, payload, lock=False))


async def apply_move(db: AsyncSession, user: User, payload: MoveRequest) -> dict:
    plan = await _plan(db, user, payload, lock=True)
    target = plan.target
    actor = user.display_name or user.email
    for uid in plan.add_members:
        db.add(PmProjectMember(project_id=target.id, user_id=uid, role=payload.assignee_role))
    for stay in plan.stay_behind:
        stay.parent_id = None
    moved_ids = [i.issue.id for i in plan.items]
    # The old keys keep resolving (MOV-04).
    for item in plan.items:
        db.add(PmIssueKeyAlias(key=item.old_key, issue_id=item.issue.id))
    for item in plan.items:
        issue = item.issue
        new_key = _key(target, item.number)
        db.add(PmIssueHistory(issue_id=issue.id, actor_id=user.id, field="project",
                              old_value=f"{item.old_key} (project {item.source.key})", new_value=new_key))
        for dropped in item.dropped:
            db.add(PmIssueHistory(issue_id=issue.id, actor_id=user.id, field="dropped on move",
                                  old_value=dropped, new_value=None))
        issue.project_id = target.id
        issue.number = item.number
        issue.sprint_id = None
        issue.workflow_state = item.state
        if issue.status != item.category:
            issue.status = item.category
        issue.component = item.component
        issue.custom_fields = item.custom_fields
        issue.assignee_id = item.assignee_id
        issue.parent_id = item.parent_id
        if item.clear_external_key:
            issue.external_key = None
    target.issue_seq = max(i.number for i in plan.items)
    if plan.losing_access:
        await db.execute(delete(PmIssueWatcher).where(
            PmIssueWatcher.issue_id.in_(moved_ids), PmIssueWatcher.user_id.in_(plan.losing_access)
        ))
    pairs = [f"{i.old_key} → {_key(target, i.number)}" for i in plan.items]
    record(db, user=user, action="updated", entity_type="pm_project", entity_id=target.id,
           summary=f"{actor} moved {len(pairs)} issue(s) to {target.key}: {', '.join(pairs)}")

    # One notification per person per move (MOV-06).
    recipients: dict[uuid.UUID, list[str]] = {}
    watcher_rows = (await db.execute(select(PmIssueWatcher.issue_id, PmIssueWatcher.user_id)
                                     .where(PmIssueWatcher.issue_id.in_(moved_ids)))).all()
    watchers: dict[uuid.UUID, set[uuid.UUID]] = {}
    for issue_id, uid in watcher_rows:
        watchers.setdefault(issue_id, set()).add(uid)
    for item in plan.items:
        people = {item.issue.assignee_id, item.issue.reporter_id} | watchers.get(item.issue.id, set())
        for uid in people - {None, user.id} - set(plan.losing_access):
            recipients.setdefault(uid, []).append(f"{item.old_key} → {_key(target, item.number)}")
    for uid, moves in recipients.items():
        first = plan.items[0]
        await notify_user(
            db, user_id=uid, category="projects",
            title=f"{actor} moved {'an issue' if len(moves) == 1 else f'{len(moves)} issues'} to {target.key}",
            body=", ".join(moves[:10]) + (" and more" if len(moves) > 10 else ""),
            link=f"/projects/{target.key}?issue={_key(target, first.number)}",
        )
    return {
        "target": target.key,
        "moved": [{"id": str(i.issue.id), "old_key": i.old_key, "new_key": _key(target, i.number)} for i in plan.items],
    }


@router.post("/issues/move")
async def move_issues(
    payload: MoveRequest, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user),
):
    """Move the issues in one transaction: every issue moves, or none does (MOV-03, MOV-08)."""
    try:
        result = await apply_move(db, user, payload)
        await db.commit()
    except Exception:
        await db.rollback()
        raise
    return result
