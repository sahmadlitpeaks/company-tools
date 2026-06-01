import uuid

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.core.database import get_db
from app.models.branding import BrandAsset, BrandKit
from app.models.user import User
from app.schemas.common import BrandAssetOut, BrandKitCreate, BrandKitOut
from app.services.storage import absolute_path, save_upload

router = APIRouter(prefix="/branding", tags=["brand-center"])


@router.get("/kits", response_model=list[BrandKitOut])
async def list_kits(
    db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)
):
    return (
        await db.execute(select(BrandKit).order_by(BrandKit.name))
    ).scalars().all()


@router.post("/kits", response_model=BrandKitOut, status_code=201)
async def create_kit(
    payload: BrandKitCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    kit = BrandKit(**payload.model_dump())
    db.add(kit)
    await db.commit()
    await db.refresh(kit)
    return kit


@router.get("/kits/{kit_id}/assets", response_model=list[BrandAssetOut])
async def list_kit_assets(
    kit_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    return (
        await db.execute(
            select(BrandAsset).where(BrandAsset.brand_kit_id == kit_id)
        )
    ).scalars().all()


@router.post("/kits/{kit_id}/assets", response_model=BrandAssetOut, status_code=201)
async def upload_kit_asset(
    kit_id: uuid.UUID,
    file: UploadFile = File(...),
    category: str = Form("logo"),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    kit = await db.get(BrandKit, kit_id)
    if not kit:
        raise HTTPException(status_code=404, detail="Brand kit not found")
    rel_path, size = await save_upload(file, subdir="branding")
    asset = BrandAsset(
        brand_kit_id=kit_id,
        name=file.filename or rel_path,
        category=category,
        file_path=rel_path,
        content_type=file.content_type,
        size_bytes=size,
    )
    db.add(asset)
    await db.commit()
    await db.refresh(asset)
    return asset


@router.get("/assets/{asset_id}/download")
async def download_brand_asset(
    asset_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    asset = await db.get(BrandAsset, asset_id)
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")
    return FileResponse(
        absolute_path(asset.file_path),
        media_type=asset.content_type or "application/octet-stream",
        filename=asset.name,
    )
