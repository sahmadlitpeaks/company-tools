"""Requirements-first project workflow. All mutations serialize on the project."""
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import String, case, cast, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.core.database import get_db
from app.models.pm import PmIssue, PmProject, PmProjectMember
from app.models.pm_decision import PmDecision
from app.models.pm_requirement import PmRequirement, PmRequirementDecisionLink, PmRequirementEvent, PmRequirementIssueLink
from app.models.user import User
from app.schemas.pm_requirement import RequirementContent, RequirementLinkInput, RequirementStatus, RequirementUpdate
from app.services.pm_access import ensure_writable, project_role, require_project, role_at_least, visible_project_ids
from app.services.pm_requirements import CONTENT_FIELDS, link_requirement, requirement_event
from app.services.people import user_names

router = APIRouter(prefix="/pm", tags=["project requirements"])


def _snapshot(row):
    return {field: str(value) if isinstance(value := getattr(row, field), uuid.UUID) else value for field in CONTENT_FIELDS}


def _summary(row, project, role, owner_name, task_count, task_done, decision_count):
    return {"id": row.id, "project_id": row.project_id, "project_key": project.key, "project_name": project.name,
            "project_status": project.status, "key": f"{project.key}-REQ-{row.number}", "title": row.title,
            "status": row.status, "owner_id": row.owner_id, "owner_name": owner_name, "my_role": role,
            "version": row.version, "created_at": row.created_at, "updated_at": row.updated_at,
            "task_count": task_count, "task_done": task_done, "decision_count": decision_count}


async def _summaries(db, rows, user, known_role=None):
    """List summaries use bounded aggregate queries, never one query per row."""
    if not rows:
        return []
    ids = [row.id for row, _ in rows]
    names = await user_names(db, {row.owner_id for row, _ in rows})
    counts = {rid: (total, done) for rid, total, done in (await db.execute(
        select(PmRequirementIssueLink.requirement_id, func.count(), func.sum(case((PmIssue.status == "done", 1), else_=0)))
        .join(PmIssue, PmIssue.id == PmRequirementIssueLink.issue_id)
        .where(PmRequirementIssueLink.requirement_id.in_(ids)).group_by(PmRequirementIssueLink.requirement_id))).all()}
    decisions = dict((await db.execute(select(PmRequirementDecisionLink.requirement_id, func.count())
                                      .where(PmRequirementDecisionLink.requirement_id.in_(ids))
                                      .group_by(PmRequirementDecisionLink.requirement_id))).all())
    roles = {} if user.is_admin or known_role else dict((await db.execute(
        select(PmProjectMember.project_id, PmProjectMember.role).where(PmProjectMember.user_id == user.id,
            PmProjectMember.project_id.in_({project.id for _, project in rows})))).all())
    return [_summary(row, project, "admin" if user.is_admin else known_role or roles[project.id], names.get(row.owner_id),
                     *counts.get(row.id, (0, 0)), decisions.get(row.id, 0)) for row, project in rows
            if user.is_admin or known_role or project.id in roles]


async def _out(db, row, project, role, *, detail=False):
    owner = await db.get(User, row.owner_id) if row.owner_id else None
    issues = list((await db.scalars(select(PmIssue).join(PmRequirementIssueLink, PmRequirementIssueLink.issue_id == PmIssue.id)
                                    .where(PmRequirementIssueLink.requirement_id == row.id).order_by(PmIssue.number))).all())
    decision_count = await db.scalar(select(func.count()).select_from(PmRequirementDecisionLink)
                                    .where(PmRequirementDecisionLink.requirement_id == row.id))
    result = _summary(row, project, role, (owner.display_name or owner.email) if owner else None,
                      len(issues), sum(issue.status == "done" for issue in issues), decision_count)
    if detail:
        result.update(_snapshot(row))
        decisions = (await db.scalars(select(PmDecision).join(PmRequirementDecisionLink, PmRequirementDecisionLink.decision_id == PmDecision.id)
                                     .where(PmRequirementDecisionLink.requirement_id == row.id).order_by(PmDecision.number))).all()
        events = (await db.scalars(select(PmRequirementEvent).where(PmRequirementEvent.requirement_id == row.id)
                                  .order_by(PmRequirementEvent.created_at, PmRequirementEvent.id))).all()
        result["issues"] = [{"id": issue.id, "key": f"{project.key}-{issue.number}", "summary": issue.summary,
                             "issue_type": issue.issue_type, "status": issue.status} for issue in issues]
        result["decisions"] = [{"id": decision.id, "key": f"{project.key}-DEC-{decision.number}", "title": decision.title,
                                "status": decision.status} for decision in decisions]
        result["events"] = [{"id": event.id, "actor_name": event.actor_name, "action": event.action,
                             "details": event.details, "created_at": event.created_at} for event in events]
    return result


async def _load(db, user, requirement_id, *, write=False, restore=False):
    row = await db.get(PmRequirement, requirement_id)
    if not row:
        raise HTTPException(404, "Requirement not found")
    project, role = await require_project(db, user, row.project_id, "member" if write else "viewer", for_update=write)
    if write:
        ensure_writable(project)
        row = await db.scalar(select(PmRequirement).where(PmRequirement.id == requirement_id)
                              .with_for_update().execution_options(populate_existing=True))
        if row.status == "archived" and not restore:
            raise HTTPException(409, "This requirement is archived. Restore it before making changes.")
    return row, project, role


async def _validate(db, project, payload):
    if payload.owner_id:
        owner = await db.get(User, payload.owner_id)
        if not owner or owner.status != "active" or not role_at_least(await project_role(db, owner, project.id), "member"):
            raise HTTPException(422, "Owner must be an active project member or administrator")
    if payload.status in ("ready", "in_progress", "delivered"):
        missing = [field.replace("_", " ") for field in ("original_request", "context", "functional_requirements", "scope", "expected_outcome", "acceptance_criteria")
                   if not getattr(payload, field).strip()]
        if missing:
            raise HTTPException(422, f"Complete these fields before marking the requirement ready: {', '.join(missing)}")


@router.get("/requirements")
async def list_requirements(project_id: uuid.UUID | None = None, status: RequirementStatus | None = None,
                            q: str = Query(default="", max_length=200), offset: int = Query(default=0, ge=0),
                            limit: int = Query(default=50, ge=1, le=100), db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    visible = await visible_project_ids(db, user)
    query = select(PmRequirement, PmProject).join(PmProject, PmProject.id == PmRequirement.project_id)
    if project_id:
        await require_project(db, user, project_id)
        query = query.where(PmRequirement.project_id == project_id)
    if visible is not None:
        query = query.where(PmRequirement.project_id.in_(visible))
    if status:
        query = query.where(PmRequirement.status == status)
    else:
        query = query.where(PmRequirement.status != "archived")
        if not project_id:
            query = query.where(PmProject.status == "active")
    if q.strip():
        # Literal substring search; do not turn user input into LIKE wildcards.
        term = q.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        key = PmProject.key + "-REQ-" + cast(PmRequirement.number, String)
        query = query.where(or_(key.ilike(f"%{term}%", escape="\\"), PmRequirement.title.ilike(f"%{term}%", escape="\\"),
                                PmRequirement.original_request.ilike(f"%{term}%", escape="\\")))
    total = await db.scalar(select(func.count()).select_from(query.subquery()))
    rows = (await db.execute(query.order_by(PmRequirement.updated_at.desc(), PmRequirement.id).offset(offset).limit(limit))).all()
    return {"items": await _summaries(db, rows, user), "total": total}


@router.post("/projects/{project_id}/requirements", status_code=201)
async def create_requirement(project_id: uuid.UUID, payload: RequirementContent, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    project, role = await require_project(db, user, project_id, "member", for_update=True)
    ensure_writable(project)
    await _validate(db, project, payload)
    project.requirement_seq = (project.requirement_seq or 0) + 1
    row = PmRequirement(project_id=project.id, number=project.requirement_seq, created_by_id=user.id, version=1, **payload.model_dump())
    db.add(row)
    await db.flush()
    requirement_event(db, row, user, "created", {"content": _snapshot(row)})
    await db.commit()
    await db.refresh(row)
    return await _out(db, row, project, role, detail=True)


@router.get("/requirements/{requirement_id}")
async def get_requirement(requirement_id: uuid.UUID, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    row, project, role = await _load(db, user, requirement_id)
    return await _out(db, row, project, role, detail=True)


@router.patch("/requirements/{requirement_id}")
async def update_requirement(requirement_id: uuid.UUID, payload: RequirementUpdate, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    row, project, role = await _load(db, user, requirement_id, write=True, restore=True)
    if payload.version != row.version:
        raise HTTPException(409, "This requirement changed. Reload it before saving.")
    before = _snapshot(row)
    changes = payload.model_dump(exclude_unset=True, exclude={"version"})
    if "title" in changes and changes["title"] is None:
        raise HTTPException(422, "Title cannot be empty")
    content = RequirementContent(**{**before, **changes})
    if row.status == "archived" and content.status == "archived":
        raise HTTPException(409, "Restore this requirement before editing it.")
    await _validate(db, project, content)
    for field in CONTENT_FIELDS:
        setattr(row, field, getattr(content, field))
    after = _snapshot(row)
    if before != after:
        row.version += 1
        requirement_event(db, row, user, "updated", {"before": before, "after": after})
    await db.commit()
    await db.refresh(row)
    return await _out(db, row, project, role, detail=True)


@router.post("/requirements/{requirement_id}/links/{kind}", status_code=201)
async def add_link(requirement_id: uuid.UUID, kind: str, payload: RequirementLinkInput,
                   db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    row, project, role = await _load(db, user, requirement_id, write=True)
    model = {"issues": PmIssue, "decisions": PmDecision}.get(kind)
    if model is None:
        raise HTTPException(404, "Unknown link type")
    target = await db.get(model, payload.target_id)
    if not target or target.project_id != project.id:
        raise HTTPException(422, "Linked records must belong to this project")
    await link_requirement(db, row, target, "issue" if kind == "issues" else "decision", user)
    await db.commit()
    await db.refresh(row)
    return await _out(db, row, project, role, detail=True)


@router.delete("/requirements/{requirement_id}/links/{kind}/{target_id}", status_code=204)
async def remove_link(requirement_id: uuid.UUID, kind: str, target_id: uuid.UUID,
                      db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    row, _, _ = await _load(db, user, requirement_id, write=True)
    model = {"issues": PmRequirementIssueLink, "decisions": PmRequirementDecisionLink}.get(kind)
    if model is None:
        raise HTTPException(404, "Unknown link type")
    column = model.issue_id if kind == "issues" else model.decision_id
    link = await db.scalar(select(model).where(model.requirement_id == row.id, column == target_id))
    if link:
        target = await db.get(PmIssue if kind == "issues" else PmDecision, target_id)
        await db.delete(link)
        row.version += 1
        details = {"id": str(target_id), "number": target.number,
                   "title": target.summary if kind == "issues" else target.title}
        requirement_event(db, row, user, "issue_unlinked" if kind == "issues" else "decision_unlinked", details)
    await db.commit()


async def _reverse(db, user, target_id, kind):
    model = PmIssue if kind == "issue" else PmDecision
    target = await db.get(model, target_id)
    if not target:
        raise HTTPException(404, "Record not found")
    project, role = await require_project(db, user, target.project_id)
    link = PmRequirementIssueLink if kind == "issue" else PmRequirementDecisionLink
    column = link.issue_id if kind == "issue" else link.decision_id
    rows = (await db.scalars(select(PmRequirement).join(link, link.requirement_id == PmRequirement.id)
                            .where(column == target_id).order_by(PmRequirement.number))).all()
    return await _summaries(db, [(row, project) for row in rows], user, known_role=role)


@router.get("/issues/{issue_id}/requirements")
async def issue_requirements(issue_id: uuid.UUID, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    return await _reverse(db, user, issue_id, "issue")


@router.get("/decisions/{decision_id}/requirements")
async def decision_requirements(decision_id: uuid.UUID, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    return await _reverse(db, user, decision_id, "decision")
