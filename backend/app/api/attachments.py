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
from app.core.permissions import resolve_permissions
from app.models.user import User
from app.models.workplace import ApprovalRequest, Attachment, Task, Ticket
from app.schemas.workplace import AttachmentOut
from app.services.storage import absolute_path, save_upload

router = APIRouter(prefix="/attachments", tags=["attachments"])

ENTITY = {
    "approval": (ApprovalRequest, "approvals"),
    "ticket": (Ticket, "service_desk"),
    "task": (Task, "tasks"),
}


def _require(user: User, entity_type: str) -> str:
    info = ENTITY.get(entity_type)
    if not info:
        raise HTTPException(status_code=404, detail="Unknown entity type")
    module = info[1]
    allowed = resolve_permissions(
        role=user.role, is_admin=user.is_admin, permissions=user.permissions
    )
    if module not in allowed:
        raise HTTPException(status_code=403, detail="You don't have access")
    return module


async def _ensure_entity(db: AsyncSession, entity_type: str, entity_id: uuid.UUID):
    model = ENTITY[entity_type][0]
    obj = await db.get(model, entity_id)
    if not obj:
        raise HTTPException(status_code=404, detail="Not found")
    return obj


@router.get("/by/{entity_type}/{entity_id}", response_model=list[AttachmentOut])
async def list_attachments(
    entity_type: str,
    entity_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _require(user, entity_type)
    await _ensure_entity(db, entity_type, entity_id)
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
    await _ensure_entity(db, entity_type, entity_id)
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
