import uuid

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_admin, get_current_user
from app.core.database import get_db
from app.models.brand import Brand
from app.models.user import User
from app.schemas.brand import BrandCreate, BrandOut, BrandUpdate
from app.services.activity import record
from app.services.storage import media_url, save_upload
from app.services.utils import slugify

router = APIRouter(prefix="/brands", tags=["brands"])


async def _unique_slug(db: AsyncSession, base: str) -> str:
    base = slugify(base) or "brand"
    slug = base
    i = 1
    while (
        await db.execute(select(Brand).where(Brand.slug == slug))
    ).scalar_one_or_none() is not None:
        i += 1
        slug = f"{base}-{i}"
    return slug


@router.get("", response_model=list[BrandOut])
async def list_brands(
    db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)
):
    return (
        await db.execute(
            select(Brand).where(Brand.is_active.is_(True)).order_by(Brand.name)
        )
    ).scalars().all()


@router.post("", response_model=BrandOut, status_code=201)
async def create_brand(
    payload: BrandCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_admin),
):
    data = payload.model_dump()
    data["slug"] = await _unique_slug(db, payload.slug or payload.name)
    brand = Brand(**data)
    db.add(brand)
    record(
        db,
        user=user,
        action="created",
        entity_type="brand",
        entity_id=brand.id,
        summary=f"Created brand {brand.name}",
    )
    await db.commit()
    await db.refresh(brand)
    return brand


@router.get("/{brand_id}", response_model=BrandOut)
async def get_brand(
    brand_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    brand = await db.get(Brand, brand_id)
    if not brand:
        raise HTTPException(status_code=404, detail="Brand not found")
    return brand


@router.patch("/{brand_id}", response_model=BrandOut)
async def update_brand(
    brand_id: uuid.UUID,
    payload: BrandUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    brand = await db.get(Brand, brand_id)
    if not brand:
        raise HTTPException(status_code=404, detail="Brand not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(brand, field, value)
    await db.commit()
    await db.refresh(brand)
    return brand


@router.post("/{brand_id}/logo", response_model=BrandOut)
async def upload_logo(
    brand_id: uuid.UUID,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    brand = await db.get(Brand, brand_id)
    if not brand:
        raise HTTPException(status_code=404, detail="Brand not found")
    rel_path, _size = await save_upload(file, subdir="brands")
    brand.logo_url = media_url(rel_path)
    await db.commit()
    await db.refresh(brand)
    return brand


@router.delete("/{brand_id}", status_code=204)
async def delete_brand(
    brand_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    brand = await db.get(Brand, brand_id)
    if not brand:
        raise HTTPException(status_code=404, detail="Brand not found")
    if brand.is_default:
        raise HTTPException(status_code=409, detail="Cannot delete the default brand")
    await db.delete(brand)
    await db.commit()
