import uuid

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth.deps import get_current_user
from app.core.database import get_db
from app.models.product import Brochure, Product
from app.models.user import User
from app.schemas.common import (
    BrochureOut,
    ProductCreate,
    ProductOut,
    PublicDocMeta,
    ShareInfo,
)
from app.services.activity import record
from app.services.sharing import get_or_create_share_link
from app.services.storage import absolute_path, save_upload

router = APIRouter(prefix="/products", tags=["products-brochures"])


@router.get("", response_model=list[ProductOut])
async def list_products(
    db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)
):
    return (
        await db.execute(select(Product).order_by(Product.name))
    ).scalars().all()


@router.post("", response_model=ProductOut, status_code=201)
async def create_product(
    payload: ProductCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    product = Product(**payload.model_dump())
    db.add(product)
    await db.commit()
    await db.refresh(product)
    return product


@router.get("/{product_id}/brochures", response_model=list[BrochureOut])
async def list_brochures(
    product_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    return (
        await db.execute(
            select(Brochure)
            .where(Brochure.product_id == product_id)
            .options(selectinload(Brochure.short_link))
            .order_by(Brochure.created_at.desc())
        )
    ).scalars().all()


@router.post("/{product_id}/brochures", response_model=BrochureOut, status_code=201)
async def upload_brochure(
    product_id: uuid.UUID,
    file: UploadFile = File(...),
    title: str = Form(...),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    product = await db.get(Product, product_id)
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    rel_path, size = await save_upload(file, subdir="brochures")
    brochure = Brochure(
        product_id=product_id,
        title=title,
        file_path=rel_path,
        content_type=file.content_type,
        size_bytes=size,
    )
    db.add(brochure)
    await db.commit()
    await db.refresh(brochure)
    return brochure


@router.get("/brochures/{brochure_id}/download")
async def download_brochure_internal(
    brochure_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Authenticated download used by the in-app viewer (works for private ones)."""
    brochure = await db.get(Brochure, brochure_id)
    if not brochure:
        raise HTTPException(status_code=404, detail="Brochure not found")
    return FileResponse(
        absolute_path(brochure.file_path),
        media_type=brochure.content_type or "application/pdf",
        filename=brochure.title,
    )


@router.post("/brochures/{brochure_id}/share", response_model=ShareInfo)
async def share_brochure(
    brochure_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Make a brochure public and return a short, client-friendly URL."""
    brochure = await db.get(
        Brochure, brochure_id, options=[selectinload(Brochure.short_link)]
    )
    if not brochure:
        raise HTTPException(status_code=404, detail="Brochure not found")
    link = await get_or_create_share_link(
        db,
        existing=brochure.short_link,
        target_url=f"/b/{brochure.id}",
        title=f"Brochure: {brochure.title}",
        user=user,
    )
    await db.flush()
    brochure.short_link_id = link.id
    brochure.is_public = True
    record(
        db,
        user=user,
        action="shared",
        entity_type="brochure",
        entity_id=brochure.id,
        summary=f"Shared brochure '{brochure.title}' at /s/{link.code}",
    )
    await db.commit()
    return ShareInfo(is_public=True, share_code=link.code)


@router.post("/brochures/{brochure_id}/unshare", response_model=ShareInfo)
async def unshare_brochure(
    brochure_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Revoke public access (and disable the short link)."""
    brochure = await db.get(
        Brochure, brochure_id, options=[selectinload(Brochure.short_link)]
    )
    if not brochure:
        raise HTTPException(status_code=404, detail="Brochure not found")
    brochure.is_public = False
    if brochure.short_link:
        brochure.short_link.is_active = False
    record(
        db,
        user=user,
        action="unshared",
        entity_type="brochure",
        entity_id=brochure.id,
        summary=f"Made brochure '{brochure.title}' private",
    )
    await db.commit()
    return ShareInfo(is_public=False, share_code=None)


# Public brochure endpoints — only reachable once a brochure is shared.
public_router = APIRouter(prefix="/public/brochures", tags=["products-brochures"])


@public_router.get("/{brochure_id}/meta", response_model=PublicDocMeta)
async def public_brochure_meta(
    brochure_id: uuid.UUID, db: AsyncSession = Depends(get_db)
):
    brochure = await db.get(Brochure, brochure_id)
    if not brochure or not brochure.is_public:
        raise HTTPException(status_code=404, detail="Brochure not found")
    return PublicDocMeta(
        id=brochure.id,
        title=brochure.title,
        content_type=brochure.content_type,
        size_bytes=brochure.size_bytes,
    )


@public_router.get("/{brochure_id}/download")
async def download_brochure(
    brochure_id: uuid.UUID, db: AsyncSession = Depends(get_db)
):
    brochure = await db.get(Brochure, brochure_id)
    if not brochure or not brochure.is_public:
        raise HTTPException(status_code=404, detail="Brochure not found")
    brochure.download_count += 1
    await db.commit()
    return FileResponse(
        absolute_path(brochure.file_path),
        media_type=brochure.content_type or "application/pdf",
        filename=brochure.title,
    )
