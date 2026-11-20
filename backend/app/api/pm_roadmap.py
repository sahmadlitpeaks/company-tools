"""Product roadmap (BRD section 9A, RMP-01..07).

Features are requirements with roadmap fields: module, priority (how
important), horizon (when: now/next/later/future), roadmap status and target
quarter. An approved feature is *started* as an epic on a team board; progress
rolls up from that epic's child issues.

Permissions (project scope): ``roadmap.view`` reads, ``roadmap.edit`` changes
modules and feature details, ``roadmap.decide`` changes horizon and status and
starts features. ``roadmap.view_all`` (platform) reads every project's roadmap.
"""
import uuid
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.core.database import get_db
from app.models.pm import PmIssue, PmProject
from app.models.pm_requirement import PmModule, PmRequirement, PmRequirementIssueLink
from app.models.user import User
from app.schemas.pm import PmIssueCreate
from app.services.access import platform_actions
from app.services.activity import record
from app.services.people import user_names
from app.services.pm_access import ensure_writable, project_access_map, require, require_project
from app.services.pm_requirements import requirement_event

router = APIRouter(prefix="/pm", tags=["project-roadmap"])

Priority = Literal["high", "medium", "low"]
Horizon = Literal["now", "next", "later", "future"]
RoadmapStatus = Literal["proposed", "approved", "in_progress", "done", "parked"]
QUARTER = r"^\d{4}-Q[1-4]$"


class ModuleIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    description: str | None = Field(default=None, max_length=2000)


class ModuleUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    description: str | None = Field(default=None, max_length=2000)
    position: int | None = Field(default=None, ge=0, le=10_000)
    archived: bool | None = None


class FeatureUpdate(BaseModel):
    module_id: uuid.UUID | None = None
    priority: Priority | None = None
    target_quarter: str | None = Field(default=None, pattern=QUARTER)
    horizon: Horizon | None = None
    status: RoadmapStatus | None = None


class StartIn(BaseModel):
    # Project for the epic; defaults to the feature's own project.
    project_id: uuid.UUID | None = None


def _name(user: User) -> str:
    return user.display_name or user.email or str(user.id)


# ----------------------------------------------------------------- access
async def _roadmap_access(db: AsyncSession, user: User, project_ids) -> dict[uuid.UUID, frozenset[str]]:
    """Roadmap permissions per visible project."""
    ids = list(project_ids)
    out = {pid: a.permissions for pid, a in (await project_access_map(db, user, ids)).items() if a.can("roadmap.view")}
    if "roadmap.view_all" in platform_actions(user):
        for pid in ids:
            out.setdefault(pid, frozenset({"roadmap.view"}))
    return out


async def _project(db: AsyncSession, user: User, project_id: uuid.UUID, permission: str, *, lock: bool = False):
    project = await db.get(PmProject, project_id)
    if not project:
        raise HTTPException(404, "Project not found")
    access = (await _roadmap_access(db, user, [project_id])).get(project_id)
    if access is None:
        raise HTTPException(404, "Project not found")
    if permission != "roadmap.view":
        project, project_access = await require_project(db, user, project_id, permission, for_update=lock)
        ensure_writable(project)
    return project


# ----------------------------------------------------------------- modules
async def _module_out(db: AsyncSession, module: PmModule) -> dict:
    count = await db.scalar(select(func.count()).select_from(PmRequirement).where(PmRequirement.module_id == module.id))
    return {"id": str(module.id), "project_id": str(module.project_id), "name": module.name,
            "description": module.description, "position": module.position, "archived": module.archived,
            "feature_count": int(count or 0)}


@router.get("/projects/{project_id}/modules")
async def list_modules(project_id: uuid.UUID, db: AsyncSession = Depends(get_db),
                       user: User = Depends(get_current_user)):
    await _project(db, user, project_id, "roadmap.view")
    rows = (await db.scalars(select(PmModule).where(PmModule.project_id == project_id)
                             .order_by(PmModule.archived, PmModule.position, PmModule.name))).all()
    return [await _module_out(db, m) for m in rows]


@router.post("/projects/{project_id}/modules", status_code=201)
async def create_module(project_id: uuid.UUID, payload: ModuleIn, db: AsyncSession = Depends(get_db),
                        user: User = Depends(get_current_user)):
    project = await _project(db, user, project_id, "roadmap.edit", lock=True)
    name = payload.name.strip()
    if await db.scalar(select(PmModule.id).where(PmModule.project_id == project_id, func.lower(PmModule.name) == name.lower())):
        raise HTTPException(409, f"{project.key} already has a module called {name}.")
    last = await db.scalar(select(func.max(PmModule.position)).where(PmModule.project_id == project_id))
    module = PmModule(project_id=project_id, name=name, description=payload.description, position=(last or 0) + 1)
    db.add(module)
    record(db, user=user, action="created", entity_type="pm_project", entity_id=project_id,
           summary=f"{_name(user)} added roadmap module '{name}' to {project.key}")
    await db.commit()
    await db.refresh(module)
    return await _module_out(db, module)


async def _module(db, user, module_id, *, lock=True):
    module = await db.get(PmModule, module_id)
    if not module:
        raise HTTPException(404, "Module not found")
    project = await _project(db, user, module.project_id, "roadmap.edit", lock=lock)
    return module, project


@router.patch("/modules/{module_id}")
async def update_module(module_id: uuid.UUID, payload: ModuleUpdate, db: AsyncSession = Depends(get_db),
                        user: User = Depends(get_current_user)):
    module, project = await _module(db, user, module_id)
    data = payload.model_dump(exclude_unset=True)
    if data.get("name"):
        name = data["name"].strip()
        clash = await db.scalar(select(PmModule.id).where(PmModule.project_id == module.project_id,
                                                          func.lower(PmModule.name) == name.lower(), PmModule.id != module.id))
        if clash:
            raise HTTPException(409, f"{project.key} already has a module called {name}.")
        data["name"] = name
    for field, value in data.items():
        if value is not None or field == "description":
            setattr(module, field, value)
    record(db, user=user, action="updated", entity_type="pm_project", entity_id=project.id,
           summary=f"{_name(user)} updated roadmap module '{module.name}' in {project.key}: {', '.join(sorted(data))}")
    await db.commit()
    await db.refresh(module)
    return await _module_out(db, module)


@router.delete("/modules/{module_id}", status_code=204)
async def delete_module(module_id: uuid.UUID, db: AsyncSession = Depends(get_db),
                        user: User = Depends(get_current_user)):
    module, project = await _module(db, user, module_id)
    if await db.scalar(select(PmRequirement.id).where(PmRequirement.module_id == module.id).limit(1)):
        raise HTTPException(409, "This module has features. Move them or archive the module instead.")
    record(db, user=user, action="deleted", entity_type="pm_project", entity_id=project.id,
           summary=f"{_name(user)} deleted roadmap module '{module.name}' from {project.key}")
    await db.delete(module)
    await db.commit()


# ----------------------------------------------------------------- features
async def _features(db: AsyncSession, rows: list[tuple[PmRequirement, PmProject]],
                    access: dict[uuid.UUID, frozenset[str]]) -> list[dict]:
    if not rows:
        return []
    ids = [row.id for row, _ in rows]
    epics = (await db.execute(
        select(PmRequirementIssueLink.requirement_id, PmIssue)
        .join(PmIssue, PmIssue.id == PmRequirementIssueLink.issue_id)
        .where(PmRequirementIssueLink.requirement_id.in_(ids), PmIssue.issue_type == "epic")
    )).all()
    by_feature: dict[uuid.UUID, list[PmIssue]] = {}
    for requirement_id, epic in epics:
        by_feature.setdefault(requirement_id, []).append(epic)
    epic_ids = [epic.id for _, epic in epics]
    children = {
        parent: (int(total), int(done or 0)) for parent, total, done in (await db.execute(
            select(PmIssue.parent_id, func.count(), func.sum(case((PmIssue.status == "done", 1), else_=0)))
            .where(PmIssue.parent_id.in_(epic_ids)).group_by(PmIssue.parent_id)
        )).all()
    } if epic_ids else {}
    project_keys = dict((await db.execute(
        select(PmProject.id, PmProject.key).where(PmProject.id.in_({e.project_id for _, e in epics}))
    )).all()) if epics else {}
    modules = dict((await db.execute(
        select(PmModule.id, PmModule.name).where(PmModule.id.in_({r.module_id for r, _ in rows if r.module_id}))
    )).all())
    owners = await user_names(db, {r.owner_id for r, _ in rows if r.owner_id})
    out = []
    for row, project in rows:
        linked = by_feature.get(row.id, [])
        total = sum(children.get(e.id, (0, 0))[0] for e in linked)
        done = sum(children.get(e.id, (0, 0))[1] for e in linked)
        all_done = bool(linked) and all(e.status == "done" for e in linked)
        percent = round(100 * done / total) if total else (100 if all_done else 0)
        status = "done" if row.roadmap_status == "in_progress" and all_done else row.roadmap_status
        perms = access.get(project.id, frozenset())
        out.append({
            "id": str(row.id), "key": f"{project.key}-REQ-{row.number}", "title": row.title,
            "project_id": str(project.id), "project_key": project.key, "project_name": project.name,
            "module_id": str(row.module_id) if row.module_id else None, "module_name": modules.get(row.module_id),
            "priority": row.priority, "horizon": row.horizon, "status": status, "target_quarter": row.target_quarter,
            "owner_id": str(row.owner_id) if row.owner_id else None, "owner_name": owners.get(row.owner_id),
            "epics": [{"id": str(e.id), "key": f"{project_keys[e.project_id]}-{e.number}", "status": e.status,
                       "project_key": project_keys[e.project_id]} for e in linked],
            "progress": {"done": done, "total": total, "percent": percent},
            "can_edit": "roadmap.edit" in perms and project.status == "active",
            "can_decide": "roadmap.decide" in perms and project.status == "active",
        })
    return out


@router.get("/roadmap")
async def roadmap(
    project_id: uuid.UUID | None = None, module_id: uuid.UUID | None = None,
    priority: Priority | None = None, horizon: Horizon | Literal["none"] | None = None,
    status: RoadmapStatus | None = None, owner_id: uuid.UUID | None = None,
    db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user),
):
    """Every feature the caller can see, across projects (RMP-03)."""
    projects = list((await db.scalars(select(PmProject).where(PmProject.status == "active")
                                      .order_by(PmProject.name))).all())
    access = await _roadmap_access(db, user, [p.id for p in projects])
    projects = [p for p in projects if p.id in access]
    if project_id:
        projects = [p for p in projects if p.id == project_id]
    if not projects:
        return {"projects": [], "features": []}
    stmt = (select(PmRequirement, PmProject).join(PmProject, PmProject.id == PmRequirement.project_id)
            .where(PmRequirement.project_id.in_([p.id for p in projects]), PmRequirement.status != "archived"))
    if module_id:
        stmt = stmt.where(PmRequirement.module_id == module_id)
    if priority:
        stmt = stmt.where(PmRequirement.priority == priority)
    if horizon == "none":
        stmt = stmt.where(PmRequirement.horizon.is_(None))
    elif horizon:
        stmt = stmt.where(PmRequirement.horizon == horizon)
    if owner_id:
        stmt = stmt.where(PmRequirement.owner_id == owner_id)
    rows = list((await db.execute(stmt.order_by(PmProject.name, PmRequirement.number))).all())
    features = await _features(db, rows, access)
    if status:
        features = [f for f in features if f["status"] == status]
    modules = (await db.scalars(select(PmModule).where(PmModule.project_id.in_([p.id for p in projects]))
                                .order_by(PmModule.position, PmModule.name))).all()
    return {
        "projects": [{
            "id": str(p.id), "key": p.key, "name": p.name,
            "can_edit": "roadmap.edit" in access[p.id], "can_decide": "roadmap.decide" in access[p.id],
            "modules": [{"id": str(m.id), "name": m.name, "position": m.position, "archived": m.archived}
                        for m in modules if m.project_id == p.id],
        } for p in projects],
        "features": features,
    }


async def _feature(db: AsyncSession, user: User, requirement_id: uuid.UUID, permission: str):
    row = await db.get(PmRequirement, requirement_id)
    if not row:
        raise HTTPException(404, "Feature not found")
    project = await _project(db, user, row.project_id, permission, lock=True)
    row = await db.scalar(select(PmRequirement).where(PmRequirement.id == requirement_id)
                          .with_for_update().execution_options(populate_existing=True))
    if row.status == "archived":
        raise HTTPException(409, "This requirement is archived. Restore it before changing the roadmap.")
    return row, project


@router.patch("/requirements/{requirement_id}/roadmap")
async def update_feature(requirement_id: uuid.UUID, payload: FeatureUpdate, db: AsyncSession = Depends(get_db),
                         user: User = Depends(get_current_user)):
    """Edit roadmap fields; horizon and status need roadmap.decide (RMP-02, RMP-04)."""
    data = payload.model_dump(exclude_unset=True)
    deciding = bool({"horizon", "status"} & data.keys())
    row, project = await _feature(db, user, requirement_id, "roadmap.decide" if deciding else "roadmap.edit")
    access = (await project_access_map(db, user, [project.id]))[project.id]
    if {"module_id", "priority", "target_quarter"} & data.keys():
        require(access, "roadmap.edit")
    if data.get("module_id"):
        module = await db.get(PmModule, data["module_id"])
        if not module or module.project_id != project.id or module.archived:
            raise HTTPException(422, f"Choose an active module of {project.key}.")
    if data.get("status") == "in_progress" and row.roadmap_status != "in_progress":
        raise HTTPException(422, "Start the feature to put it in progress; that creates its epic.")
    field_map = {"status": "roadmap_status"}
    before = {k: getattr(row, field_map.get(k, k)) for k in data}
    for key, value in data.items():
        setattr(row, field_map.get(key, key), value)
    after = {k: getattr(row, field_map.get(k, k)) for k in data}
    changed = {k: (str(before[k]) if before[k] is not None else None, str(after[k]) if after[k] is not None else None)
               for k in data if before[k] != after[k]}
    if changed:
        row.version += 1
        requirement_event(db, row, user, "roadmap_updated", {"changes": changed})
        record(db, user=user, action="updated", entity_type="pm_requirement", entity_id=row.id,
               summary=f"{_name(user)} changed roadmap feature {project.key}-REQ-{row.number}: "
                       + "; ".join(f"{k} {old or '-'} → {new or '-'}" for k, (old, new) in changed.items()))
    await db.commit()
    access_all = await _roadmap_access(db, user, [project.id])
    return (await _features(db, [(row, project)], access_all))[0]


def _epic_description(row: PmRequirement, key: str) -> str:
    parts = [f"Roadmap feature {key}."]
    for title, text in (("Scope", row.scope), ("Functional requirements", row.functional_requirements),
                        ("Acceptance criteria", row.acceptance_criteria)):
        if (text or "").strip():
            parts.append(f"## {title}\n\n{text.strip()}")
    return "\n\n".join(parts)[:20000]


@router.post("/requirements/{requirement_id}/start", status_code=201)
async def start_feature(requirement_id: uuid.UUID, payload: StartIn, db: AsyncSession = Depends(get_db),
                        user: User = Depends(get_current_user)):
    """Create the feature's epic on a team board and link both ways (RMP-05)."""
    from app.api.pm import create_issue

    row, project = await _feature(db, user, requirement_id, "roadmap.decide")
    if row.roadmap_status != "approved":
        raise HTTPException(409, "Only approved features can be started.")
    target_id = payload.project_id or project.id
    target, _ = await require_project(db, user, target_id, "issue.create")
    ensure_writable(target)
    key = f"{project.key}-REQ-{row.number}"
    epic = await create_issue(target.id, PmIssueCreate(issue_type="epic", summary=row.title[:255],
                                                       description=_epic_description(row, key)), db=db, user=user)
    row = await db.scalar(select(PmRequirement).where(PmRequirement.id == requirement_id)
                          .with_for_update().execution_options(populate_existing=True))
    db.add(PmRequirementIssueLink(requirement_id=row.id, issue_id=epic.id, added_by_id=user.id))
    row.roadmap_status = "in_progress"
    row.version += 1
    requirement_event(db, row, user, "roadmap_started", {"epic": epic.key, "issue_id": str(epic.id)})
    record(db, user=user, action="updated", entity_type="pm_requirement", entity_id=row.id,
           summary=f"{_name(user)} started roadmap feature {key} as epic {epic.key}")
    await db.commit()
    access = await _roadmap_access(db, user, [project.id])
    return {"epic": {"id": str(epic.id), "key": epic.key, "project_key": target.key},
            "feature": (await _features(db, [(row, project)], access))[0]}
