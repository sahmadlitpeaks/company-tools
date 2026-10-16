"""Project-scoped decisions. Every write locks the project before the decision.

Submitted snapshots and events are append-only through application APIs. Formal
approval deliberately avoids the generic approval routes and outbound fan-out.
"""
import uuid
from datetime import date, datetime, time, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import String, cast, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.core.database import get_db
from app.models.pm import PmIssue, PmProject, PmProjectMember
from app.models.pm_decision import PmDecision, PmDecisionEvent, PmDecisionIssueLink, PmDecisionRevision
from app.models.user import User
from app.schemas.pm_decision import (
    ApprovalInput, Category, DecisionContent, DecisionCreate, DecisionUpdate, IssueLinkInput, ReasonInput, Status, SubmitInput, SupersedeInput,
)
from app.services.notify import notify_user
from app.services.people import user_names
from app.services.pm_access import ensure_writable, project_role, require_project, role_at_least
from app.services.pm_requirements import link_requirement, writable_requirement

router = APIRouter(prefix="/pm", tags=["project decisions"])
CONTENT_FIELDS = ("title", "category", "context", "approach", "rationale", "alternatives", "owner_id", "approver_id", "effective_date")


def _name(user: User) -> str:
    return user.display_name or user.email


def _key(project: PmProject, row: PmDecision) -> str:
    return f"{project.key}-DEC-{row.number}"


async def _load(db, user, decision_id, *, write=False, minimum="member"):
    row = await db.get(PmDecision, decision_id)
    if not row:
        raise HTTPException(404, "Decision not found")
    project, role = await require_project(db, user, row.project_id, minimum if write else "viewer", for_update=write)
    if write:
        ensure_writable(project)
        row = await db.scalar(select(PmDecision).where(PmDecision.id == decision_id).with_for_update().execution_options(populate_existing=True))
    return row, project, role


def _version(row, expected):
    if row.version != expected:
        raise HTTPException(409, "This decision changed. Reload it before trying again.")


def _event(db, row, user, action, note="", details=None):
    db.add(PmDecisionEvent(decision_id=row.id, revision_number=row.revision_number or None,
                           actor_id=user.id, actor_name=_name(user), action=action, note=note, details=details or {},
                           created_at=datetime.now(timezone.utc)))


async def _validate_content(db, user, project, payload):
    owner = await db.get(User, payload.owner_id)
    if not owner or owner.status != "active" or not role_at_least(await project_role(db, owner, project.id), "member"):
        raise HTTPException(422, "Owner must be an active project member or administrator")
    if payload.approver_id:
        approver = await db.get(User, payload.approver_id)
        # Explicit project membership is required even for a platform admin approver.
        membership = await db.scalar(select(PmProjectMember.id).where(PmProjectMember.project_id == project.id,
                                                                     PmProjectMember.user_id == payload.approver_id))
        if not approver or approver.status != "active" or not membership:
            raise HTTPException(422, "Approver must be an active project participant")
    ids = set(payload.issue_ids)
    issues = list((await db.scalars(select(PmIssue).where(PmIssue.id.in_(ids), PmIssue.project_id == project.id))).all()) if ids else []
    if len(issues) != len(ids):
        raise HTTPException(422, "Linked issues must belong to this project")
    return issues


async def _apply_content(db, row, payload, user):
    for field in CONTENT_FIELDS:
        setattr(row, field, getattr(payload, field))
    old = {(item["type"], item["label"], item["url"]): item for item in (row.evidence or [])}
    evidence = []
    seen = set()
    for entry in payload.evidence:
        item = entry.model_dump(mode="json")
        key = (item["type"], item["label"], item["url"])
        if key in seen:
            continue
        seen.add(key)
        evidence.append(old.get(key) or {**item, "added_by_id": str(user.id), "added_by_name": _name(user),
                                         "added_at": datetime.now(timezone.utc).isoformat()})
    row.evidence = evidence
    # Keep attribution and relationship types for retained links during draft edits.
    links = (await db.scalars(select(PmDecisionIssueLink).where(PmDecisionIssueLink.decision_id == row.id))).all()
    selected = set(payload.issue_ids)
    for link in links:
        if link.issue_id not in selected:
            await db.delete(link)
    db.add_all(_new_link(row, issue_id, user) for issue_id in selected - {link.issue_id for link in links})
    await db.flush()


def _new_link(row, issue_id, user, relationship="relates_to"):
    return PmDecisionIssueLink(decision_id=row.id, issue_id=issue_id, relationship=relationship,
                               added_by_id=user.id, added_by_name=_name(user), added_at=datetime.now(timezone.utc))


async def _issues(db, row, project):
    pairs = (await db.execute(select(PmIssue, PmDecisionIssueLink).join(PmDecisionIssueLink, PmDecisionIssueLink.issue_id == PmIssue.id)
                              .where(PmDecisionIssueLink.decision_id == row.id).order_by(PmIssue.number))).all()
    issues = [issue for issue, _ in pairs]
    names = await user_names(db, {i.reporter_id for i in issues} | {i.assignee_id for i in issues})
    return [{"id": str(i.id), "key": f"{project.key}-{i.number}", "summary": i.summary,
             "issue_type": i.issue_type, "status": i.status, "reporter_name": names.get(i.reporter_id),
             "assignee_name": names.get(i.assignee_id), "relationship": link.relationship,
             "added_by_id": str(link.added_by_id) if link.added_by_id else None, "added_by_name": link.added_by_name,
             "added_at": link.added_at.isoformat() if link.added_at else None} for i, link in pairs]


async def _snapshot(db, row, project):
    names = await user_names(db, {row.owner_id, row.approver_id, row.proposed_by_id})
    return {**{field: str(getattr(row, field)) if getattr(row, field) is not None else None for field in CONTENT_FIELDS},
            "key": _key(project, row), "owner_name": names.get(row.owner_id), "approver_name": names.get(row.approver_id),
            "proposed_by_name": names.get(row.proposed_by_id), "evidence": row.evidence,
            "issues": await _issues(db, row, project)}


async def _out(db, row, project, role, user, *, detail=False, names=None):
    if names is None:
        names = await user_names(db, {row.owner_id, row.approver_id, row.proposed_by_id})
    editable = role_at_least(role, "member") and project.status != "archived"
    assigned = project.status != "archived" and row.status == "pending_approval" and row.approver_id == user.id
    if assigned:
        assigned = bool(await db.scalar(select(PmProjectMember.id).where(PmProjectMember.project_id == project.id,
                                                                        PmProjectMember.user_id == user.id)))
    result = {field: getattr(row, field) for field in CONTENT_FIELDS}
    result.update(id=row.id, project_id=row.project_id, key=_key(project, row), status=row.status,
                  proposed_by_id=row.proposed_by_id, owner_name=names.get(row.owner_id), approver_name=names.get(row.approver_id),
                  proposed_by_name=names.get(row.proposed_by_id), version=row.version, revision_number=row.revision_number,
                  approved_revision_number=row.approved_revision_number, approved_at=row.approved_at,
                  created_at=row.created_at, updated_at=row.updated_at, superseded_by_id=row.superseded_by_id,
                  superseded_by_revision_number=row.superseded_by_revision_number,
                  can_edit=editable and row.status == "draft", can_revise=editable and row.status in {"approved", "rejected", "pending_approval"},
                  can_manage_links=editable and row.status not in {"archived", "superseded"},
                  can_submit=editable and row.status == "draft", can_decide=assigned,
                  can_archive=role == "admin" and project.status != "archived" and row.status in {"approved", "rejected", "superseded"},
                  can_supersede=editable and row.status == "approved")
    if detail:
        result["evidence"] = row.evidence
        result["issues"] = await _issues(db, row, project)
        revisions = (await db.scalars(select(PmDecisionRevision).where(PmDecisionRevision.decision_id == row.id).order_by(PmDecisionRevision.number.desc()))).all()
        result["revisions"] = [{"number": r.number, "snapshot": r.snapshot, "change_summary": r.change_summary,
                                "submitted_by_name": r.submitted_by_name, "created_at": r.created_at} for r in revisions]
        events = (await db.scalars(select(PmDecisionEvent).where(PmDecisionEvent.decision_id == row.id)
                                  .order_by(PmDecisionEvent.created_at, PmDecisionEvent.id))).all()
        result["events"] = [{"id": e.id, "action": e.action, "note": e.note, "actor_name": e.actor_name,
                             "revision_number": e.revision_number, "created_at": e.created_at} for e in events]
        related = (await db.scalars(select(PmDecision).where(or_(PmDecision.superseded_by_id == row.id,
                                                                               PmDecision.id == row.superseded_by_id)))).all()
        result["related_decisions"] = []
        for related_row in related:
            replaced_by = related_row.id == row.superseded_by_id
            number = row.superseded_by_revision_number if replaced_by else related_row.approved_revision_number
            revision = await db.scalar(select(PmDecisionRevision).where(PmDecisionRevision.decision_id == related_row.id,
                                                                        PmDecisionRevision.number == number)) if number else None
            result["related_decisions"].append({"id": related_row.id, "key": _key(project, related_row),
                "title": revision.snapshot["title"] if revision else related_row.title,
                "revision_number": number, "status": related_row.status,
                "relationship": "replaced_by" if replaced_by else "replaces"})
    return result


async def _notify(db, row, project, ids, title):
    for user_id in set(ids) - {None}:
        person = await db.get(User, user_id)
        if person and person.status == "active" and await project_role(db, person, project.id):
            await notify_user(db, user_id=user_id, title=title, body=f"{_key(project, row)}: {row.title}",
                              link=f"/projects/{project.key}?tab=decisions&decision={row.id}", category="approval", in_app_only=True)


@router.get("/projects/{project_id}/decisions")
async def list_decisions(project_id: uuid.UUID, q: str = Query("", max_length=255), status: Status | None = None,
                         category: Category | None = None, owner_id: uuid.UUID | None = None,
                         approver_id: uuid.UUID | None = None, proposed_by_id: uuid.UUID | None = None,
                         after: date | None = None, before: date | None = None,
                         limit: int = Query(20, ge=1, le=100), offset: int = Query(0, ge=0),
                         db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    project, role = await require_project(db, user, project_id)
    if after and before and after > before:
        raise HTTPException(422, "From date must be before the end date")
    stmt = select(PmDecision).where(PmDecision.project_id == project_id)
    for field, value in (("status", status), ("category", category), ("owner_id", owner_id),
                         ("approver_id", approver_id), ("proposed_by_id", proposed_by_id)):
        if value is not None:
            stmt = stmt.where(getattr(PmDecision, field) == value)
    if after:
        stmt = stmt.where(PmDecision.created_at >= datetime.combine(after, time.min, timezone.utc))
    if before:
        stmt = stmt.where(PmDecision.created_at <= datetime.combine(before, time.max, timezone.utc))
    if q.strip():
        pattern = "%" + q.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
        issue_match = select(PmDecisionIssueLink.decision_id).join(PmIssue).where(
            PmIssue.project_id == project_id, (project.key + "-" + cast(PmIssue.number, String)).ilike(pattern, escape="\\"))
        stmt = stmt.where(or_(*[getattr(PmDecision, field).ilike(pattern, escape="\\") for field in
                               ("title", "context", "approach", "rationale", "alternatives")],
                             (project.key + "-DEC-" + cast(PmDecision.number, String)).ilike(pattern, escape="\\"),
                             PmDecision.id.in_(issue_match)))
    total = await db.scalar(select(func.count()).select_from(stmt.subquery()))
    rows = (await db.scalars(stmt.order_by(PmDecision.updated_at.desc(), PmDecision.id).limit(limit).offset(offset))).all()
    names = await user_names(db, {uid for row in rows for uid in (row.owner_id, row.approver_id, row.proposed_by_id)})
    return {"items": [await _out(db, row, project, role, user, names=names) for row in rows], "total": total}


@router.post("/projects/{project_id}/decisions", status_code=201)
async def create_decision(project_id: uuid.UUID, payload: DecisionCreate, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    project, role = await require_project(db, user, project_id, "member", for_update=True)
    ensure_writable(project)
    await _validate_content(db, user, project, payload)
    requirement_id = getattr(payload, "requirement_id", None)
    requirement = await writable_requirement(db, requirement_id, project.id) if requirement_id else None
    project.decision_seq += 1
    row = PmDecision(project_id=project.id, number=project.decision_seq, proposed_by_id=user.id,
                     **{field: getattr(payload, field) for field in CONTENT_FIELDS})
    db.add(row)
    await db.flush()
    await _apply_content(db, row, payload, user)
    _event(db, row, user, "created")
    if requirement:
        await link_requirement(db, requirement, row, "decision", user)
    await db.commit()
    await db.refresh(row)
    return await _out(db, row, project, role, user, detail=True)


@router.get("/decisions/{decision_id}")
async def get_decision(decision_id: uuid.UUID, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    row, project, role = await _load(db, user, decision_id)
    return await _out(db, row, project, role, user, detail=True)


@router.patch("/decisions/{decision_id}")
async def update_decision(decision_id: uuid.UUID, payload: DecisionUpdate, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    row, project, role = await _load(db, user, decision_id, write=True)
    _version(row, payload.version)
    if row.status != "draft":
        raise HTTPException(409, "Only drafts can be edited. Return to draft to propose a revision.")
    await _validate_content(db, user, project, payload)
    before = await _snapshot(db, row, project)
    await _apply_content(db, row, payload, user)
    row.version += 1
    _event(db, row, user, "draft_updated", details={"before": before, "after": await _snapshot(db, row, project)})
    await db.commit()
    await db.refresh(row)
    return await _out(db, row, project, role, user, detail=True)


@router.post("/decisions/{decision_id}/submit")
async def submit_decision(decision_id: uuid.UUID, payload: SubmitInput, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    row, project, role = await _load(db, user, decision_id, write=True)
    _version(row, payload.version)
    if row.status != "draft":
        raise HTTPException(409, "Only a draft can be submitted")
    if row.owner_id is None:
        raise HTTPException(422, "Choose an active project member as owner before submitting")
    await _validate_content(db, user, project, DecisionContent(**{field: getattr(row, field) for field in CONTENT_FIELDS}))
    if not row.approver_id or row.approver_id in {user.id, row.proposed_by_id}:
        raise HTTPException(422, "Choose another project participant as approver before submitting")
    row.revision_number += 1
    row.version += 1
    row.status = "pending_approval"
    db.add(PmDecisionRevision(decision_id=row.id, number=row.revision_number, snapshot=await _snapshot(db, row, project),
                              change_summary=payload.change_summary, submitted_by_id=user.id, submitted_by_name=_name(user)))
    _event(db, row, user, "submitted", payload.change_summary)
    await _notify(db, row, project, [row.approver_id], "A project decision needs your approval")
    await db.commit()
    await db.refresh(row)
    return await _out(db, row, project, role, user, detail=True)


def _links_writable(row, version):
    _version(row, version)
    if row.status in {"archived", "superseded"}:
        raise HTTPException(409, "Issue links on archived or superseded decisions are read-only")


@router.post("/decisions/{decision_id}/issues")
async def link_issue(decision_id: uuid.UUID, payload: IssueLinkInput, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    row, project, role = await _load(db, user, decision_id, write=True)
    _links_writable(row, payload.version)
    issue = await db.get(PmIssue, payload.issue_id)
    if not issue or issue.project_id != project.id:
        raise HTTPException(422, "Linked issues must belong to this project")
    link = await db.scalar(select(PmDecisionIssueLink).where(PmDecisionIssueLink.decision_id == row.id,
                                                           PmDecisionIssueLink.issue_id == issue.id))
    if not link or link.relationship != payload.relationship:
        before = link.relationship if link else None
        if link:
            link.relationship = payload.relationship
        else:
            count = await db.scalar(select(func.count()).select_from(PmDecisionIssueLink).where(PmDecisionIssueLink.decision_id == row.id))
            if count >= 100:
                raise HTTPException(422, "A decision can link up to 100 issues")
            db.add(_new_link(row, issue.id, user, payload.relationship))
        row.version += 1
        _event(db, row, user, "issue_link_updated" if before else "issue_linked",
               f"{project.key}-{issue.number}: {payload.relationship.replace('_', ' ')}",
               {"issue_id": str(issue.id), "issue_key": f"{project.key}-{issue.number}", "summary": issue.summary,
                "previous_relationship": before, "relationship": payload.relationship})
    await db.commit()
    await db.refresh(row)
    return await _out(db, row, project, role, user, detail=True)


@router.delete("/decisions/{decision_id}/issues/{issue_id}")
async def unlink_issue(decision_id: uuid.UUID, issue_id: uuid.UUID, version: int = Query(ge=1),
                       db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    row, project, role = await _load(db, user, decision_id, write=True)
    _links_writable(row, version)
    link = await db.scalar(select(PmDecisionIssueLink).where(PmDecisionIssueLink.decision_id == row.id,
                                                           PmDecisionIssueLink.issue_id == issue_id))
    if link:
        issue = await db.get(PmIssue, issue_id)
        row.version += 1
        _event(db, row, user, "issue_unlinked", f"{project.key}-{issue.number}: {link.relationship.replace('_', ' ')}",
               {"issue_id": str(issue_id), "issue_key": f"{project.key}-{issue.number}", "summary": issue.summary,
                "relationship": link.relationship, "added_by_name": link.added_by_name,
                "added_at": link.added_at.isoformat() if link.added_at else None})
        await db.delete(link)
    await db.commit()
    await db.refresh(row)
    return await _out(db, row, project, role, user, detail=True)


@router.post("/decisions/{decision_id}/approval")
async def approve_decision(decision_id: uuid.UUID, payload: ApprovalInput, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    row, project, role = await _load(db, user, decision_id, write=True, minimum="viewer")
    _version(row, payload.version)
    if row.status != "pending_approval" or row.revision_number != payload.revision_number:
        raise HTTPException(409, "This revision is no longer pending approval")
    if row.approver_id != user.id:
        raise HTTPException(403, "Only the assigned approver can decide this revision")
    if not await db.scalar(select(PmProjectMember.id).where(PmProjectMember.project_id == project.id,
                                                           PmProjectMember.user_id == user.id)):
        raise HTTPException(403, "The assigned approver must still belong to this project")
    revision = await db.scalar(select(PmDecisionRevision).where(PmDecisionRevision.decision_id == row.id,
                                                               PmDecisionRevision.number == row.revision_number))
    if revision.submitted_by_id == user.id or row.proposed_by_id == user.id:
        raise HTTPException(403, "You cannot approve your own proposal")
    if payload.outcome == "rejected" and not payload.note:
        raise HTTPException(422, "A rejection reason is required")
    row.status = payload.outcome
    row.version += 1
    if payload.outcome == "approved":
        row.approved_revision_number = row.revision_number
        row.approved_at = datetime.now(timezone.utc)
    _event(db, row, user, payload.outcome, payload.note)
    await _notify(db, row, project, [row.proposed_by_id, row.owner_id], f"A project decision was {payload.outcome}")
    await db.commit()
    await db.refresh(row)
    return await _out(db, row, project, role, user, detail=True)


@router.post("/decisions/{decision_id}/revise")
async def revise_decision(decision_id: uuid.UUID, payload: ReasonInput, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    row, project, role = await _load(db, user, decision_id, write=True)
    _version(row, payload.version)
    if row.status not in {"approved", "rejected", "pending_approval"}:
        raise HTTPException(409, "This decision cannot return to draft")
    previous = row.status
    row.status = "draft"
    row.version += 1
    _event(db, row, user, "returned_to_draft", payload.reason, {"previous_status": previous})
    if previous == "pending_approval":
        await _notify(db, row, project, [row.approver_id], "A decision submission was withdrawn")
    await db.commit()
    await db.refresh(row)
    return await _out(db, row, project, role, user, detail=True)


@router.post("/decisions/{decision_id}/supersede")
async def supersede_decision(decision_id: uuid.UUID, payload: SupersedeInput, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    row, project, role = await _load(db, user, decision_id, write=True)
    _version(row, payload.version)
    replacement = await db.get(PmDecision, payload.replacement_id)
    if row.status != "approved" or not replacement or replacement.project_id != project.id or replacement.id == row.id or replacement.status != "approved":
        raise HTTPException(422, "Choose a different approved decision in this project as the replacement")
    row.status = "superseded"
    row.superseded_by_id = replacement.id
    row.superseded_by_revision_number = replacement.approved_revision_number
    row.version += 1
    _event(db, row, user, "superseded", payload.reason, {"replacement_id": str(replacement.id), "replacement_key": _key(project, replacement),
                                                       "replacement_revision_number": replacement.approved_revision_number})
    _event(db, replacement, user, "replaces_decision", payload.reason, {"previous_id": str(row.id), "previous_key": _key(project, row)})
    await db.commit()
    await db.refresh(row)
    return await _out(db, row, project, role, user, detail=True)


@router.post("/decisions/{decision_id}/archive")
async def archive_decision(decision_id: uuid.UUID, payload: ReasonInput, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    row, project, role = await _load(db, user, decision_id, write=True, minimum="admin")
    _version(row, payload.version)
    if row.status not in {"approved", "rejected", "superseded"}:
        raise HTTPException(409, "Only approved, rejected or superseded decisions can be archived")
    row.status = "archived"
    row.version += 1
    _event(db, row, user, "archived", payload.reason)
    await db.commit()
    await db.refresh(row)
    return await _out(db, row, project, role, user, detail=True)


@router.get("/issues/{issue_id}/decisions")
async def issue_decisions(issue_id: uuid.UUID, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    issue = await db.get(PmIssue, issue_id)
    if not issue:
        raise HTTPException(404, "Issue not found")
    project, role = await require_project(db, user, issue.project_id)
    rows = (await db.scalars(select(PmDecision).join(PmDecisionIssueLink, PmDecisionIssueLink.decision_id == PmDecision.id)
                             .where(PmDecisionIssueLink.issue_id == issue.id).order_by(PmDecision.number))).all()
    names = await user_names(db, {uid for row in rows for uid in (row.owner_id, row.approver_id, row.proposed_by_id)})
    return [await _out(db, row, project, role, user, names=names) for row in rows]
