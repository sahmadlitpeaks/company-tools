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
from app.models.asset import Asset, Folder
from app.models.crm import CrmLead
from app.models.user import User
from app.schemas.common import (
    AssetOut,
    BulkAssetAction,
    DocVersionOut,
    FolderCreate,
    FolderOut,
    LeadCapture,
    PublicDocMeta,
    ShareInfo,
    ShareSettings,
)
from app.services import sharing, versioning
from app.services.activity import record
from app.services.notify import notify_user
from app.services.sharing import get_or_create_share_link
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
    stmt = (
        select(Asset)
        .options(selectinload(Asset.short_link))
        .order_by(Asset.created_at.desc())
    )
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


@router.post("/bulk")
async def bulk_assets(
    payload: BulkAssetAction,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Apply an action to many assets at once (delete / move / share / unshare)."""
    assets = (
        await db.execute(
            select(Asset)
            .where(Asset.id.in_(payload.ids))
            .options(selectinload(Asset.short_link))
        )
    ).scalars().all()
    affected = 0
    for asset in assets:
        if payload.action == "delete":
            await db.delete(asset)
        elif payload.action == "move":
            asset.folder_id = payload.folder_id
        elif payload.action == "share":
            link = await get_or_create_share_link(
                db,
                existing=asset.short_link,
                target_url=f"/a/{asset.id}",
                title=f"Asset: {asset.name}",
                user=user,
            )
            await db.flush()
            asset.short_link_id = link.id
            asset.is_public = True
        elif payload.action == "unshare":
            asset.is_public = False
            if asset.short_link:
                asset.short_link.is_active = False
        else:
            raise HTTPException(status_code=400, detail="Unknown action")
        affected += 1
    record(
        db,
        user=user,
        action="updated",
        entity_type="asset",
        summary=f"Bulk {payload.action} on {affected} asset(s)",
    )
    await db.commit()
    return {"affected": affected}


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


@router.post("/{asset_id}/share", response_model=ShareInfo)
async def share_asset(
    asset_id: uuid.UUID,
    settings_in: ShareSettings | None = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Make a marketing asset public (optionally gated)."""
    asset = await db.get(Asset, asset_id, options=[selectinload(Asset.short_link)])
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")
    link = await get_or_create_share_link(
        db,
        existing=asset.short_link,
        target_url=f"/a/{asset.id}",
        title=f"Asset: {asset.name}",
        user=user,
        share_settings=settings_in,
    )
    await db.flush()
    asset.short_link_id = link.id
    asset.is_public = True
    record(
        db,
        user=user,
        action="shared",
        entity_type="asset",
        entity_id=asset.id,
        summary=f"Shared asset '{asset.name}' at /s/{link.code}",
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


@router.post("/{asset_id}/unshare", response_model=ShareInfo)
async def unshare_asset(
    asset_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Revoke public access (and disable the short link)."""
    asset = await db.get(Asset, asset_id, options=[selectinload(Asset.short_link)])
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")
    asset.is_public = False
    if asset.short_link:
        asset.short_link.is_active = False
    record(
        db,
        user=user,
        action="unshared",
        entity_type="asset",
        entity_id=asset.id,
        summary=f"Made asset '{asset.name}' private",
    )
    await db.commit()
    return ShareInfo(is_public=False, share_code=None)


@router.post("/{asset_id}/version", response_model=AssetOut)
async def replace_asset(
    asset_id: uuid.UUID,
    file: UploadFile = File(...),
    note: str | None = Form(None),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Upload a new version of the file, keeping the share link/QR live."""
    asset = await db.get(Asset, asset_id, options=[selectinload(Asset.short_link)])
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")
    new_path, new_size = await versioning.replace_file(
        db,
        doc=asset,
        doc_type="asset",
        current_path=asset.file_path,
        current_content_type=asset.content_type,
        current_size=asset.size_bytes,
        file=file,
        note=note,
        user=user,
        subdir="assets",
    )
    asset.file_path = new_path
    asset.size_bytes = new_size
    asset.content_type = file.content_type
    record(
        db,
        user=user,
        action="updated",
        entity_type="asset",
        entity_id=asset.id,
        summary=f"Uploaded v{asset.version} of '{asset.name}'",
    )
    await db.commit()
    await db.refresh(asset, ["short_link"])
    return asset


@router.get("/{asset_id}/versions", response_model=list[DocVersionOut])
async def asset_versions(
    asset_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    return await versioning.list_versions(db, doc_type="asset", doc_id=asset_id)


@router.get("/{asset_id}/versions/{version}/download")
async def download_asset_version(
    asset_id: uuid.UUID,
    version: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    v = await versioning.get_version(
        db, doc_type="asset", doc_id=asset_id, version=version
    )
    if not v:
        raise HTTPException(status_code=404, detail="Version not found")
    return FileResponse(
        absolute_path(v.file_path),
        media_type=v.content_type or "application/octet-stream",
        filename=f"v{v.version}",
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


# Public asset endpoints — only reachable once an asset is shared.
public_router = APIRouter(prefix="/public/assets", tags=["marketing-assets"])


@public_router.get("/{asset_id}/meta", response_model=PublicDocMeta)
async def public_asset_meta(asset_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    asset = await db.get(Asset, asset_id, options=[selectinload(Asset.short_link)])
    if not asset or not asset.is_public:
        raise HTTPException(status_code=404, detail="Asset not found")
    link = asset.short_link
    return PublicDocMeta(
        id=asset.id,
        kind="asset",
        title=asset.name,
        content_type=asset.content_type,
        size_bytes=asset.size_bytes,
        requires_passcode=bool(link and link.passcode_hash),
        requires_lead=bool(link and link.require_lead),
        brand=await sharing.default_brand_brief(db),
    )


@public_router.get("/{asset_id}/check")
async def check_asset_access(
    asset_id: uuid.UUID,
    passcode: str | None = None,
    lead: uuid.UUID | None = None,
    db: AsyncSession = Depends(get_db),
):
    """Validate a passcode / lead without side effects (gate the viewer)."""
    asset = await db.get(Asset, asset_id, options=[selectinload(Asset.short_link)])
    if not asset or not asset.is_public:
        raise HTTPException(status_code=404, detail="Asset not found")
    link = asset.short_link
    lead_ok = not (link and link.require_lead) or await sharing.lead_is_valid(
        db, origin_type="asset_share", origin_id=str(asset.id), lead_id=lead
    )
    sharing.enforce_access(link, passcode=passcode, lead_ok=lead_ok)
    return {"ok": True}


@public_router.post("/{asset_id}/lead")
async def capture_asset_lead(
    asset_id: uuid.UUID,
    payload: LeadCapture,
    db: AsyncSession = Depends(get_db),
):
    asset = await db.get(Asset, asset_id)
    if not asset or not asset.is_public:
        raise HTTPException(status_code=404, detail="Asset not found")
    lead = CrmLead(
        name=payload.name,
        email=payload.email,
        phone=payload.phone,
        company=payload.company,
        source="asset",
        source_detail=asset.name,
        origin_type="asset_share",
        origin_id=str(asset.id),
    )
    db.add(lead)
    if asset.uploaded_by_id:
        await notify_user(
            db,
            user_id=asset.uploaded_by_id,
            title="New lead from a shared asset",
            body=f"{payload.name or payload.email or 'Someone'} requested '{asset.name}'.",
            link="/crm",
            category="lead",
        )
    await db.commit()
    return {"id": lead.id}


@public_router.get("/{asset_id}/download")
async def public_download_asset(
    asset_id: uuid.UUID,
    request: Request,
    passcode: str | None = None,
    lead: uuid.UUID | None = None,
    db: AsyncSession = Depends(get_db),
):
    asset = await db.get(Asset, asset_id, options=[selectinload(Asset.short_link)])
    if not asset or not asset.is_public:
        raise HTTPException(status_code=404, detail="Asset not found")
    link = asset.short_link
    lead_ok = not (link and link.require_lead) or await sharing.lead_is_valid(
        db, origin_type="asset_share", origin_id=str(asset.id), lead_id=lead
    )
    sharing.enforce_access(link, passcode=passcode, lead_ok=lead_ok)

    first_open = asset.download_count == 0
    asset.download_count += 1
    await sharing.record_open(
        db,
        link,
        ip=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    if first_open and asset.uploaded_by_id:
        await notify_user(
            db,
            user_id=asset.uploaded_by_id,
            title="Your shared asset was opened",
            body=f"'{asset.name}' was opened for the first time.",
            link="/shared",
            category="share",
            dedup_key=f"share-open:asset:{asset.id}",
        )
    await db.commit()
    return FileResponse(
        absolute_path(asset.file_path),
        media_type=asset.content_type or "application/octet-stream",
        filename=asset.name,
    )
