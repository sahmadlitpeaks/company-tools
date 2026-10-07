"""Import a Jira CSV export into a project (project administrators only).

Two steps: ``preview`` parses the file and proposes status and people
mappings without writing anything; the import call re-sends the same file
with the confirmed mappings.
"""
import json
import uuid

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.core.database import get_db
from app.models.pm import ISSUE_STATUSES, PmProject
from app.models.user import User
from app.services.activity import record
from app.services.jira_import import MAX_BYTES, JiraImportError, parse_export, preview, run_import
from app.services.pm_access import require_project

router = APIRouter(prefix="/pm", tags=["project-tracker-import"])


async def _read(file: UploadFile) -> bytes:
    raw = await file.read(MAX_BYTES + 1)
    if len(raw) > MAX_BYTES:
        raise HTTPException(413, "The file is larger than 10 MB. Export fewer issues at a time.")
    return raw


async def _admin_project(db: AsyncSession, user: User, project_id: uuid.UUID) -> PmProject:
    project, _ = await require_project(db, user, project_id, "admin")
    if project.status == "archived":
        raise HTTPException(409, "This project is archived. Restore it to import issues.")
    return project


@router.post("/projects/{project_id}/import/jira/preview")
async def preview_jira(
    project_id: uuid.UUID,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    project = await _admin_project(db, user, project_id)
    try:
        issues = parse_export(await _read(file))
    except JiraImportError as exc:
        raise HTTPException(422, str(exc))
    return await preview(db, project, issues)


@router.post("/projects/{project_id}/import/jira")
async def import_jira(
    project_id: uuid.UUID,
    file: UploadFile = File(...),
    mapping: str = Form("{}", description='JSON: {"statuses": {jira: status}, "people": {jira: user id | null}, "add_members": bool}'),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await _admin_project(db, user, project_id)
    try:
        options = json.loads(mapping or "{}")
        statuses = {str(k): str(v) for k, v in (options.get("statuses") or {}).items()}
        people = {str(k): (uuid.UUID(v) if v else None) for k, v in (options.get("people") or {}).items()}
        add_members = bool(options.get("add_members", True))
    except (ValueError, AttributeError, TypeError):
        raise HTTPException(422, "The mapping couldn't be read. Preview the file again.")
    bad = sorted({v for v in statuses.values() if v not in ISSUE_STATUSES})
    if bad:
        raise HTTPException(422, f"Unknown status: {', '.join(bad)}")
    raw = await _read(file)
    # Lock the project so issue numbers stay unique while importing.
    project = await db.scalar(
        select(PmProject).where(PmProject.id == project_id).with_for_update()
        .execution_options(populate_existing=True)
    )
    try:
        issues = parse_export(raw)
        result = await run_import(db, project, user, issues, statuses, people, add_members)
    except JiraImportError as exc:
        await db.rollback()
        raise HTTPException(422, str(exc))
    record(
        db, user=user, action="imported", entity_type="pm_project", entity_id=project.id,
        summary=(
            f"{user.display_name or user.email} imported {result['created']} Jira issue(s) into {project.key}"
            f" ({result['skipped']} already imported)"
        ),
    )
    await db.commit()
    return result
