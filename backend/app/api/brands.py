import uuid

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, ConfigDict
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import can_manage_brand, get_current_admin, get_current_user
from app.core.database import get_db
from app.models.brand import Brand
from app.models.brand_document import BrandDocument, BrandDocumentVersion
from app.models.user import User
from app.schemas.brand import BrandCreate, BrandOut, BrandUpdate
from app.services.activity import record
from app.services.storage import absolute_path, media_url, save_upload
from app.services.utils import slugify

router = APIRouter(prefix="/brands", tags=["brands"])


def _require_manage(user: User, brand: Brand) -> None:
    if not can_manage_brand(user, brand.id):
        raise HTTPException(status_code=403, detail="You can't manage this brand")


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
    user: User = Depends(get_current_user),
):
    brand = await db.get(Brand, brand_id)
    if not brand:
        raise HTTPException(status_code=404, detail="Brand not found")
    _require_manage(user, brand)
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
    user: User = Depends(get_current_user),
):
    brand = await db.get(Brand, brand_id)
    if not brand:
        raise HTTPException(status_code=404, detail="Brand not found")
    _require_manage(user, brand)
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


# ---- Versioned brand documents (logos, guidelines, fonts…) ----
class DocumentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    brand_id: uuid.UUID
    name: str
    category: str
    current_version: int
    version_count: int = 0
    latest_size: int | None = None
    updated_at: object


class VersionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    version: int
    content_type: str | None = None
    size_bytes: int
    created_at: object


@router.get("/{brand_id}/documents", response_model=list[DocumentOut])
async def list_documents(
    brand_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    docs = (
        await db.execute(
            select(BrandDocument)
            .where(BrandDocument.brand_id == brand_id)
            .order_by(BrandDocument.name)
        )
    ).scalars().all()
    result = []
    for d in docs:
        count = (
            await db.execute(
                select(func.count())
                .select_from(BrandDocumentVersion)
                .where(BrandDocumentVersion.document_id == d.id)
            )
        ).scalar_one()
        latest = (
            await db.execute(
                select(BrandDocumentVersion)
                .where(BrandDocumentVersion.document_id == d.id)
                .order_by(BrandDocumentVersion.version.desc())
                .limit(1)
            )
        ).scalar_one_or_none()
        out = DocumentOut.model_validate(d)
        out.version_count = count
        out.latest_size = latest.size_bytes if latest else None
        result.append(out)
    return result


@router.post("/{brand_id}/documents", response_model=DocumentOut, status_code=201)
async def upload_document(
    brand_id: uuid.UUID,
    file: UploadFile = File(...),
    name: str = Form(...),
    category: str = Form("document"),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Upload a brand document. Re-uploading the same name adds a new version."""
    brand = await db.get(Brand, brand_id)
    if not brand:
        raise HTTPException(status_code=404, detail="Brand not found")
    _require_manage(user, brand)

    doc = (
        await db.execute(
            select(BrandDocument).where(
                BrandDocument.brand_id == brand_id, BrandDocument.name == name
            )
        )
    ).scalar_one_or_none()
    if doc is None:
        doc = BrandDocument(brand_id=brand_id, name=name, category=category, current_version=0)
        db.add(doc)
        await db.flush()

    rel_path, size = await save_upload(file, subdir="brand-docs")
    doc.current_version += 1
    doc.category = category or doc.category
    db.add(
        BrandDocumentVersion(
            document_id=doc.id,
            version=doc.current_version,
            file_path=rel_path,
            content_type=file.content_type,
            size_bytes=size,
            uploaded_by_id=user.id,
        )
    )
    await db.commit()
    await db.refresh(doc)
    out = DocumentOut.model_validate(doc)
    out.version_count = doc.current_version
    out.latest_size = size
    return out


@router.get("/documents/{document_id}/versions", response_model=list[VersionOut])
async def list_versions(
    document_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    return (
        await db.execute(
            select(BrandDocumentVersion)
            .where(BrandDocumentVersion.document_id == document_id)
            .order_by(BrandDocumentVersion.version.desc())
        )
    ).scalars().all()


@router.get("/document-versions/{version_id}/download")
async def download_version(
    version_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    v = await db.get(BrandDocumentVersion, version_id)
    if not v:
        raise HTTPException(status_code=404, detail="Version not found")
    doc = await db.get(BrandDocument, v.document_id)
    filename = f"{doc.name} v{v.version}" if doc else f"document-v{v.version}"
    return FileResponse(
        absolute_path(v.file_path),
        media_type=v.content_type or "application/octet-stream",
        filename=filename,
    )


@router.delete("/documents/{document_id}", status_code=204)
async def delete_document(
    document_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    doc = await db.get(BrandDocument, document_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    brand = await db.get(Brand, doc.brand_id)
    if brand:
        _require_manage(user, brand)
    await db.delete(doc)
    await db.commit()
