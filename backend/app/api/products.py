import uuid

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.core.database import get_db
from app.models.product import Brochure, Product
from app.models.user import User
from app.schemas.common import BrochureOut, ProductCreate, ProductOut
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
            select(Brochure).where(Brochure.product_id == product_id)
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


# Public brochure download (feature #5 — people can download from the QR/landing).
public_router = APIRouter(prefix="/public/brochures", tags=["products-brochures"])


@public_router.get("/{brochure_id}/download")
async def download_brochure(
    brochure_id: uuid.UUID, db: AsyncSession = Depends(get_db)
):
    brochure = await db.get(Brochure, brochure_id)
    if not brochure:
        raise HTTPException(status_code=404, detail="Brochure not found")
    brochure.download_count += 1
    await db.commit()
    return FileResponse(
        absolute_path(brochure.file_path),
        media_type=brochure.content_type or "application/pdf",
        filename=brochure.title,
    )
