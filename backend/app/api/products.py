import uuid

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Request,
    UploadFile,
)
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth.deps import get_current_user
from app.core.database import get_db
from app.models.crm import CrmLead
from app.models.product import Brochure, Product
from app.models.user import User
from app.schemas.common import (
    BrochureOut,
    DocVersionOut,
    LeadCapture,
    ProductCreate,
    ProductOut,
    PublicDocMeta,
    ShareInfo,
    ShareSettings,
)
from app.services import sharing, versioning
from app.services.activity import record
from app.services.notify import notify_user
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
    user: User = Depends(get_current_user),
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
        created_by_id=user.id,
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
    settings_in: ShareSettings | None = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Make a brochure public (optionally with expiry / passcode / lead gate)."""
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
        share_settings=settings_in,
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
    return ShareInfo(
        is_public=True,
        share_code=link.code,
        share_url=sharing.share_url(link.code),
        expires_at=link.expires_at,
        require_lead=link.require_lead,
        has_passcode=bool(link.passcode_hash),
    )


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


@router.post("/brochures/{brochure_id}/version", response_model=BrochureOut)
async def replace_brochure(
    brochure_id: uuid.UUID,
    file: UploadFile = File(...),
    note: str | None = Form(None),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Upload a new version of the file, keeping the share link/QR live."""
    brochure = await db.get(
        Brochure, brochure_id, options=[selectinload(Brochure.short_link)]
    )
    if not brochure:
        raise HTTPException(status_code=404, detail="Brochure not found")
    new_path, new_size = await versioning.replace_file(
        db,
        doc=brochure,
        doc_type="brochure",
        current_path=brochure.file_path,
        current_content_type=brochure.content_type,
        current_size=brochure.size_bytes,
        file=file,
        note=note,
        user=user,
        subdir="brochures",
    )
    brochure.file_path = new_path
    brochure.size_bytes = new_size
    brochure.content_type = file.content_type
    record(
        db,
        user=user,
        action="updated",
        entity_type="brochure",
        entity_id=brochure.id,
        summary=f"Uploaded v{brochure.version} of '{brochure.title}'",
    )
    await db.commit()
    await db.refresh(brochure, ["short_link"])
    return brochure


@router.get("/brochures/{brochure_id}/versions", response_model=list[DocVersionOut])
async def brochure_versions(
    brochure_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    return await versioning.list_versions(
        db, doc_type="brochure", doc_id=brochure_id
    )


@router.get("/brochures/{brochure_id}/versions/{version}/download")
async def download_brochure_version(
    brochure_id: uuid.UUID,
    version: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    v = await versioning.get_version(
        db, doc_type="brochure", doc_id=brochure_id, version=version
    )
    if not v:
        raise HTTPException(status_code=404, detail="Version not found")
    return FileResponse(
        absolute_path(v.file_path),
        media_type=v.content_type or "application/pdf",
        filename=f"v{v.version}",
    )


# Public brochure endpoints — only reachable once a brochure is shared.
public_router = APIRouter(prefix="/public/brochures", tags=["products-brochures"])


@public_router.get("/{brochure_id}/meta", response_model=PublicDocMeta)
async def public_brochure_meta(
    brochure_id: uuid.UUID, db: AsyncSession = Depends(get_db)
):
    brochure = await db.get(
        Brochure, brochure_id, options=[selectinload(Brochure.short_link)]
    )
    if not brochure or not brochure.is_public:
        raise HTTPException(status_code=404, detail="Brochure not found")
    link = brochure.short_link
    return PublicDocMeta(
        id=brochure.id,
        kind="brochure",
        title=brochure.title,
        content_type=brochure.content_type,
        size_bytes=brochure.size_bytes,
        requires_passcode=bool(link and link.passcode_hash),
        requires_lead=bool(link and link.require_lead),
        brand=await sharing.default_brand_brief(db),
    )


@public_router.get("/{brochure_id}/check")
async def check_brochure_access(
    brochure_id: uuid.UUID,
    passcode: str | None = None,
    lead: uuid.UUID | None = None,
    db: AsyncSession = Depends(get_db),
):
    """Validate a passcode / lead without side effects (gate the viewer)."""
    brochure = await db.get(
        Brochure, brochure_id, options=[selectinload(Brochure.short_link)]
    )
    if not brochure or not brochure.is_public:
        raise HTTPException(status_code=404, detail="Brochure not found")
    link = brochure.short_link
    lead_ok = not (link and link.require_lead) or await sharing.lead_is_valid(
        db, origin_type="brochure_share", origin_id=str(brochure.id), lead_id=lead
    )
    sharing.enforce_access(link, passcode=passcode, lead_ok=lead_ok)
    return {"ok": True}


@public_router.post("/{brochure_id}/lead")
async def capture_brochure_lead(
    brochure_id: uuid.UUID,
    payload: LeadCapture,
    db: AsyncSession = Depends(get_db),
):
    brochure = await db.get(Brochure, brochure_id)
    if not brochure or not brochure.is_public:
        raise HTTPException(status_code=404, detail="Brochure not found")
    lead = CrmLead(
        name=payload.name,
        email=payload.email,
        phone=payload.phone,
        company=payload.company,
        source="brochure",
        source_detail=brochure.title,
        origin_type="brochure_share",
        origin_id=str(brochure.id),
    )
    db.add(lead)
    if brochure.created_by_id:
        await notify_user(
            db,
            user_id=brochure.created_by_id,
            title="New lead from a shared brochure",
            body=f"{payload.name or payload.email or 'Someone'} requested '{brochure.title}'.",
            link="/crm",
            category="lead",
        )
    await db.commit()
    return {"id": lead.id}


@public_router.get("/{brochure_id}/download")
async def download_brochure(
    brochure_id: uuid.UUID,
    request: Request,
    passcode: str | None = None,
    lead: uuid.UUID | None = None,
    db: AsyncSession = Depends(get_db),
):
    brochure = await db.get(
        Brochure, brochure_id, options=[selectinload(Brochure.short_link)]
    )
    if not brochure or not brochure.is_public:
        raise HTTPException(status_code=404, detail="Brochure not found")
    link = brochure.short_link
    lead_ok = not (link and link.require_lead) or await sharing.lead_is_valid(
        db, origin_type="brochure_share", origin_id=str(brochure.id), lead_id=lead
    )
    sharing.enforce_access(link, passcode=passcode, lead_ok=lead_ok)

    first_open = brochure.download_count == 0
    brochure.download_count += 1
    await sharing.record_open(
        db,
        link,
        ip=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    if first_open and brochure.created_by_id:
        await notify_user(
            db,
            user_id=brochure.created_by_id,
            title="Your shared brochure was opened",
            body=f"'{brochure.title}' was opened for the first time.",
            link="/shared",
            category="share",
            dedup_key=f"share-open:brochure:{brochure.id}",
        )
    await db.commit()
    return FileResponse(
        absolute_path(brochure.file_path),
        media_type=brochure.content_type or "application/pdf",
        filename=brochure.title,
    )
