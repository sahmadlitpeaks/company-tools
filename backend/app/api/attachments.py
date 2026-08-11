"""Generic file attachments for office-ops entities (approvals, tickets, tasks).

Not mounted behind a single module guard — instead each entity type maps to its
owning module, and access is checked per request against the caller's effective
permissions.
"""
import uuid

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.core.database import get_db
from app.models.operations import Idea, LostFoundReport
from app.models.user import User
from app.models.workplace import ApprovalRequest, Attachment, Task, TaskItem, Ticket
from app.schemas.workplace import AttachmentOut
from app.services.storage import absolute_path, save_upload

router = APIRouter(prefix="/attachments", tags=["attachments"])

# entity_type -> (model, modules that grant access to it)
ENTITY: dict[str, tuple[type, tuple[str, ...]]] = {
    "approval": (ApprovalRequest, ("approvals",)),
    "ticket": (Ticket, ("service_desk",)),
    "task": (Task, ("tasks", "routine_checks")),
    # Photo evidence against a single checklist item.
    "task_item": (TaskItem, ("tasks", "routine_checks")),
    "idea": (Idea, ("ideas",)),
    "lost_found": (LostFoundReport, ("lost_found",)),
}


def _require(user: User, entity_type: str) -> str:
    info = ENTITY.get(entity_type)
    if not info:
        raise HTTPException(status_code=404, detail="Unknown entity type")
    modules = info[1]
    # ``effective_permissions`` (unlike a bare resolve_permissions call) folds in
    # the user's access department, which is how the routine-checks module is
    # granted to the IT / Facilities teams.
    allowed = user.effective_permissions
    granted = next((m for m in modules if m in allowed), None)
    if granted is None:
        raise HTTPException(status_code=403, detail="You don't have access")
    return granted


async def _ensure_entity(db: AsyncSession, entity_type: str, entity_id: uuid.UUID):
    model = ENTITY[entity_type][0]
    obj = await db.get(model, entity_id)
    if not obj:
        raise HTTPException(status_code=404, detail="Not found")
    return obj


# Entity types whose attachments are community-shared by design: any holder of
# the module may see them (the ideas board, lost & found). Everything else is
# restricted to the people actually involved in the specific record.
_SHARED_ENTITY_TYPES = {"idea", "lost_found"}


async def _authorize_entity(
    db: AsyncSession, user: User, entity_type: str, obj
) -> None:
    """Holding the entity's module is necessary but not sufficient — the caller
    must also be a party to THIS record (or an admin/manager).

    Without this, module access alone (every member holds ``approvals``,
    ``service_desk`` and ``tasks`` by default) let anyone read or download the
    attachments on another employee's approval, ticket or task by id.
    """
    if entity_type in _SHARED_ENTITY_TYPES:
        return
    if user.is_admin or user.role == "manager":
        return
    if entity_type in ("task", "task_item"):
        task = obj if entity_type == "task" else await db.get(Task, obj.task_id)
        if task is None:
            return
        if task.template_id:
            # Routine-checks run: worked by a whole team as a group (unassigned
            # department rota — one colleague starts it, another continues), so
            # access follows the run's own department-aware rule, not just
            # creator/assignee. Otherwise a teammate couldn't add/see photos.
            from app.api.checklists import _can_view

            if await _can_view(db, user, task):
                return
            raise HTTPException(
                status_code=403, detail="You don't have access to this item"
            )
        involved = {task.created_by_id, task.assignee_id, task.reviewer_id}
    elif entity_type == "approval":
        involved = {obj.requester_id, obj.approver_id}
    elif entity_type == "ticket":
        involved = {obj.requester_id, obj.assignee_id}
    else:
        involved = set()
    if user.id not in involved:
        raise HTTPException(
            status_code=403, detail="You don't have access to this item"
        )


@router.get("/by/{entity_type}/{entity_id}", response_model=list[AttachmentOut])
async def list_attachments(
    entity_type: str,
    entity_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _require(user, entity_type)
    obj = await _ensure_entity(db, entity_type, entity_id)
    await _authorize_entity(db, user, entity_type, obj)
    return (
        await db.execute(
            select(Attachment)
            .where(
                Attachment.entity_type == entity_type,
                Attachment.entity_id == entity_id,
            )
            .order_by(Attachment.created_at.desc())
        )
    ).scalars().all()


@router.post("/by/{entity_type}/{entity_id}", response_model=AttachmentOut, status_code=201)
async def upload_attachment(
    entity_type: str,
    entity_id: uuid.UUID,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _require(user, entity_type)
    obj = await _ensure_entity(db, entity_type, entity_id)
    await _authorize_entity(db, user, entity_type, obj)
    rel_path, size = await save_upload(file, subdir="attachments")
    att = Attachment(
        entity_type=entity_type,
        entity_id=entity_id,
        name=file.filename or rel_path,
        file_path=rel_path,
        content_type=file.content_type,
        size_bytes=size,
        uploaded_by_id=user.id,
    )
    db.add(att)
    await db.commit()
    await db.refresh(att)
    return att


@router.get("/{att_id}/download")
async def download_attachment(
    att_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    att = await db.get(Attachment, att_id)
    if not att:
        raise HTTPException(status_code=404, detail="Attachment not found")
    _require(user, att.entity_type)
    obj = await _ensure_entity(db, att.entity_type, att.entity_id)
    await _authorize_entity(db, user, att.entity_type, obj)
    return FileResponse(
        absolute_path(att.file_path),
        media_type=att.content_type or "application/octet-stream",
        filename=att.name,
    )


@router.delete("/{att_id}", status_code=204)
async def delete_attachment(
    att_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    att = await db.get(Attachment, att_id)
    if not att:
        return
    _require(user, att.entity_type)
    if att.uploaded_by_id != user.id and not (
        user.is_admin or user.role == "manager"
    ):
        raise HTTPException(status_code=403, detail="Not allowed")
    await db.delete(att)
    await db.commit()
