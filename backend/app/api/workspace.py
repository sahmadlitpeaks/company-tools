import uuid

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.core.database import get_db
from app.models.user import User
from app.models.workspace import WorkspaceItem
from app.schemas.worklog import WorkspaceCreate, WorkspaceItemOut, WorkspaceUpdate
from app.services.people import user_names
from app.services.storage import absolute_path, save_upload

router = APIRouter(prefix="/workspace", tags=["my-docs"])

KINDS = {"note", "link", "file"}


def _serialize(it: WorkspaceItem, names: dict) -> WorkspaceItemOut:
    o = WorkspaceItemOut.model_validate(it)
    o.owner_name = names.get(it.owner_id)
    return o


@router.get("", response_model=list[WorkspaceItemOut])
async def list_items(
    q: str | None = None,
    kind: str | None = None,
    pinned: bool | None = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    # My items + anything teammates marked as shared.
    stmt = (
        select(WorkspaceItem)
        .where(
            or_(
                WorkspaceItem.owner_id == user.id,
                WorkspaceItem.shared.is_(True),
            )
        )
        .order_by(WorkspaceItem.pinned.desc(), WorkspaceItem.updated_at.desc())
    )
    if kind:
        stmt = stmt.where(WorkspaceItem.kind == kind)
    if pinned is not None:
        stmt = stmt.where(WorkspaceItem.pinned.is_(pinned))
    if q:
        like = f"%{q}%"
        stmt = stmt.where(
            WorkspaceItem.title.ilike(like)
            | WorkspaceItem.body.ilike(like)
            | WorkspaceItem.tags.ilike(like)
        )
    items = (await db.execute(stmt.limit(500))).scalars().all()
    names = await user_names(db, {i.owner_id for i in items})
    return [_serialize(i, names) for i in items]


@router.post("", response_model=WorkspaceItemOut, status_code=201)
async def create_item(
    payload: WorkspaceCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if payload.kind not in {"note", "link"}:
        raise HTTPException(status_code=422, detail="Use the upload endpoint for files")
    item = WorkspaceItem(owner_id=user.id, **payload.model_dump())
    db.add(item)
    await db.commit()
    await db.refresh(item)
    names = await user_names(db, {item.owner_id})
    return _serialize(item, names)


@router.post("/upload", response_model=WorkspaceItemOut, status_code=201)
async def upload_item(
    file: UploadFile = File(...),
    title: str = Form(""),
    tags: str = Form(""),
    shared: bool = Form(False),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    rel_path, size = await save_upload(file, subdir="workspace")
    item = WorkspaceItem(
        owner_id=user.id,
        kind="file",
        title=title.strip() or file.filename or "Untitled",
        file_path=rel_path,
        content_type=file.content_type,
        size_bytes=size,
        tags=tags.strip() or None,
        shared=shared,
    )
    db.add(item)
    await db.commit()
    await db.refresh(item)
    names = await user_names(db, {item.owner_id})
    return _serialize(item, names)


@router.get("/{item_id}/download")
async def download_item(
    item_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    item = await db.get(WorkspaceItem, item_id)
    if not item or item.kind != "file":
        raise HTTPException(status_code=404, detail="Not found")
    if item.owner_id != user.id and not item.shared:
        raise HTTPException(status_code=403, detail="Not allowed")
    return FileResponse(
        absolute_path(item.file_path),
        media_type=item.content_type or "application/octet-stream",
        filename=item.title,
    )


@router.patch("/{item_id}", response_model=WorkspaceItemOut)
async def update_item(
    item_id: uuid.UUID,
    payload: WorkspaceUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    item = await db.get(WorkspaceItem, item_id)
    if not item or item.owner_id != user.id:
        raise HTTPException(status_code=404, detail="Not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(item, field, value)
    await db.commit()
    await db.refresh(item)
    names = await user_names(db, {item.owner_id})
    return _serialize(item, names)


@router.delete("/{item_id}", status_code=204)
async def delete_item(
    item_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    item = await db.get(WorkspaceItem, item_id)
    if not item:
        return
    if item.owner_id != user.id and not user.is_admin:
        raise HTTPException(status_code=403, detail="Not allowed")
    await db.delete(item)
    await db.commit()
