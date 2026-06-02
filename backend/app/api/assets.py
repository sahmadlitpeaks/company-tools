import uuid

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.core.database import get_db
from app.models.asset import Asset, Folder
from app.models.user import User
from app.schemas.common import AssetOut, FolderCreate, FolderOut
from app.services.storage import absolute_path, save_upload

router = APIRouter(prefix="/assets", tags=["marketing-assets"])


@router.get("/folders", response_model=list[FolderOut])
async def list_folders(
    parent_id: uuid.UUID | None = None,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    stmt = select(Folder).order_by(Folder.name)
    stmt = stmt.where(
        Folder.parent_id == parent_id
        if parent_id is not None
        else Folder.parent_id.is_(None)
    )
    return (await db.execute(stmt)).scalars().all()


@router.post("/folders", response_model=FolderOut, status_code=201)
async def create_folder(
    payload: FolderCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    folder = Folder(
        name=payload.name, parent_id=payload.parent_id, created_by_id=user.id
    )
    db.add(folder)
    await db.commit()
    await db.refresh(folder)
    return folder


@router.delete("/folders/{folder_id}", status_code=204)
async def delete_folder(
    folder_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    folder = await db.get(Folder, folder_id)
    if not folder:
        raise HTTPException(status_code=404, detail="Folder not found")
    await db.delete(folder)
    await db.commit()


@router.get("", response_model=list[AssetOut])
async def list_assets(
    folder_id: uuid.UUID | None = None,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    stmt = select(Asset).order_by(Asset.created_at.desc())
    stmt = stmt.where(
        Asset.folder_id == folder_id
        if folder_id is not None
        else Asset.folder_id.is_(None)
    )
    return (await db.execute(stmt)).scalars().all()


@router.post("", response_model=AssetOut, status_code=201)
async def upload_asset(
    file: UploadFile = File(...),
    folder_id: uuid.UUID | None = Form(None),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    rel_path, size = await save_upload(file, subdir="assets")
    asset = Asset(
        folder_id=folder_id,
        name=file.filename or rel_path,
        file_path=rel_path,
        content_type=file.content_type,
        size_bytes=size,
        uploaded_by_id=user.id,
    )
    db.add(asset)
    await db.commit()
    await db.refresh(asset)
    return asset


@router.get("/{asset_id}/download")
async def download_asset(
    asset_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    asset = await db.get(Asset, asset_id)
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")
    return FileResponse(
        absolute_path(asset.file_path),
        media_type=asset.content_type or "application/octet-stream",
        filename=asset.name,
    )


@router.delete("/{asset_id}", status_code=204)
async def delete_asset(
    asset_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    asset = await db.get(Asset, asset_id)
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")
    await db.delete(asset)
    await db.commit()
