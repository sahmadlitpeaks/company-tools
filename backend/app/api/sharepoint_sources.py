"""Admin-managed, tenant-bound document sources. Webhook secrets never leave the API."""
import uuid
from datetime import timezone

from fastapi import APIRouter, Depends
from pydantic import Field, SecretStr, field_validator
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app.auth.deps import get_current_admin, get_current_user
from app.core.config import settings
from app.core.database import get_db
from app.models.sharepoint import SharePointDocument, SharePointRun, SharePointSource, SharePointUploadDelivery
from app.schemas.sharepoint import StrictModel
from app.services.activity import record
from app.services.sharepoint.common import SharePointError, digest, encrypt, now, require_config
from app.services.sharepoint.graph import GraphClient, application_token, delegated_token
from app.services.sharepoint.store import authorize_document, enqueue, run_info, source_for, sources_for
from app.services.sharepoint.visibility import document_scope
from app.services.sharepoint.uploads import valid_webhook

router = APIRouter(tags=["sharepoint-sources"])


class SourceIn(StrictModel):
    name: str = Field(min_length=1, max_length=128)
    site_id: str = Field(min_length=1, max_length=255)
    drive_id: str = Field(min_length=1, max_length=255)
    folder_id: str = Field(min_length=1, max_length=255)
    enabled: bool = True
    teams_notify_uploads: bool = False
    teams_channel_name: str = Field(default="", max_length=128)
    teams_webhook_url: SecretStr | None = None

    @field_validator("name", "site_id", "drive_id", "folder_id", "teams_channel_name")
    @classmethod
    def trimmed(cls, value, info):
        value = value.strip()
        if info.field_name != "teams_channel_name" and not value:
            raise ValueError("This field is required")
        if info.field_name.endswith("_id") and any(char in value for char in "/\\?#%"):
            raise ValueError("Enter a Microsoft resource ID, not a URL or path")
        return value


async def source_summary(db, source):
    run = (await db.scalars(select(SharePointRun).where(SharePointRun.source_id == source.id)
                           .order_by(SharePointRun.created_at.desc()).limit(1))).first()
    deliveries = dict((await db.execute(select(SharePointUploadDelivery.status, func.count())
        .where(SharePointUploadDelivery.source_id == source.id)
        .group_by(SharePointUploadDelivery.status))).all())
    latest = (await db.scalars(select(SharePointUploadDelivery).where(
        SharePointUploadDelivery.source_id == source.id).order_by(
        SharePointUploadDelivery.updated_at.desc()).limit(1))).first()
    return {
        "id": str(source.id), "name": source.name, "site_id": source.site_id,
        "drive_id": source.drive_id, "folder_id": source.folder_id, "enabled": source.enabled,
        "active_run": bool(source.active_run_id), "last_sync": source.last_sync,
        "baseline_completed": source.baseline_completed_at is not None,
        "teams_notify_uploads": source.teams_notify_uploads,
        "teams_channel_name": source.teams_channel_name or "",
        "teams_webhook_configured": bool(source.teams_webhook_cipher),
        "run": run_info(run), "deliveries": deliveries,
        "last_delivery_error": latest.last_error if latest else None,
    }


@router.get("/sources")
async def list_sources(user=Depends(get_current_admin), db=Depends(get_db)):
    return [await source_summary(db, source) for source in await sources_for(db)]


async def save_source(db, user, body, source=None):
    require_config()
    webhook = body.teams_webhook_url.get_secret_value().strip() if body.teams_webhook_url is not None else None
    if webhook:
        valid_webhook(webhook)
    if body.teams_notify_uploads and not (webhook or (webhook is None and source and source.teams_webhook_cipher)):
        raise SharePointError("teams_destination_required", 422)
    if body.teams_notify_uploads and not body.teams_channel_name:
        raise SharePointError("teams_channel_name_required", 422)
    key = digest([settings.SHAREPOINT_TENANT_ID, body.site_id, body.drive_id, body.folder_id])
    reactivating = False
    if source is None:
        existing = (await db.scalars(select(SharePointSource).where(
            SharePointSource.scope_key == key).with_for_update())).first()
        if existing:
            if existing.registered or existing.tenant_id != settings.SHAREPOINT_TENANT_ID:
                raise SharePointError("source_already_exists", 409)
            source, reactivating = existing, True
    if source and source.active_run_id:
        if not reactivating or (source.lease_until and source.lease_until.replace(tzinfo=timezone.utc) > now()):
            raise SharePointError("source_sync_running", 409)
        # A retired environment source may retain an abandoned run. Reconnecting
        # may close an expired run, but never takes over a still-live lease.
        abandoned = await db.get(SharePointRun, uuid.UUID(source.active_run_id))
        if abandoned:
            abandoned.status, abandoned.error_code, abandoned.finished_at = "failed", "source_reconnected", now()
        source.active_run_id = source.lease_owner = source.lease_until = None
    if source and source.scope_key != key:
        indexed = await db.scalar(select(SharePointDocument.id).where(SharePointDocument.source_id == source.id).limit(1))
        if indexed:
            raise SharePointError("source_scope_locked", 409)
        source.delta_link = source.next_link = source.generation = source.baseline_completed_at = None
    needs_verification = source is None or reactivating or source.scope_key != key
    if not source:
        source = SharePointSource(tenant_id=settings.SHAREPOINT_TENANT_ID, registered=True, policy="auto")
        db.add(source)
    if (source.teams_notify_uploads != body.teams_notify_uploads
            or webhook is not None or source.teams_channel_name != body.teams_channel_name):
        source.notification_version = (source.notification_version or 0) + 1
        source.notify_after = now()
    source.name, source.scope_key = body.name, key
    source.site_id, source.drive_id, source.folder_id = body.site_id, body.drive_id, body.folder_id
    # Resolve the Graph "root" alias into a real folder ID for ancestry checks.
    graph = GraphClient(await application_token()) if needs_verification else None
    if graph:
        await graph.verify_source(source)
    if graph and source.folder_id == "root":
        root = await graph.item(source.drive_id, "root")
        source.folder_id = root["id"]
        source.scope_key = digest([source.tenant_id, source.site_id, source.drive_id, source.folder_id])
    source.registered = True
    source.enabled = body.enabled
    source.teams_notify_uploads, source.teams_channel_name = body.teams_notify_uploads, body.teams_channel_name
    if webhook is not None:
        source.teams_webhook_cipher = encrypt(webhook) if webhook else None
    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        raise SharePointError("source_already_exists", 409) from None
    record(db, user=user, action="update", entity_type="sharepoint_source", entity_id=source.id,
           summary="Updated document source settings")
    return await source_summary(db, source)


@router.post("/sources", status_code=201)
async def create_source(body: SourceIn, user=Depends(get_current_admin), db=Depends(get_db)):
    return await save_source(db, user, body)


@router.put("/sources/{source_id}")
async def update_source(source_id: uuid.UUID, body: SourceIn, user=Depends(get_current_admin), db=Depends(get_db)):
    source = (await db.scalars(select(SharePointSource).where(
        SharePointSource.id == source_id, SharePointSource.tenant_id == settings.SHAREPOINT_TENANT_ID,
        SharePointSource.registered.is_(True))
        .with_for_update())).first()
    if not source:
        raise SharePointError("source_not_found", 404)
    return await save_source(db, user, body, source)


@router.post("/sources/{source_id}/test-connection")
async def test_source(source_id: uuid.UUID, user=Depends(get_current_admin), db=Depends(get_db)):
    source = await source_for(db, source_id)
    await GraphClient(await application_token()).verify_source(source)
    return {"ok": True, "access": "read_only", "openai_tested": False}


@router.post("/sources/{source_id}/sync", status_code=202)
async def sync_source(source_id: uuid.UUID, user=Depends(get_current_admin), db=Depends(get_db)):
    source = await source_for(db, source_id)
    if not source.enabled:
        raise SharePointError("source_paused", 409)
    return run_info(await enqueue(db, source, user.id))


@router.get("/source-options")
async def source_options(user=Depends(get_current_user), db=Depends(get_db)):
    sources = await sources_for(db)
    if user.is_admin:
        return [{"id": str(source.id), "name": source.name} for source in sources]
    graph = GraphClient(await delegated_token(db, user))
    workspace = await document_scope(db, user)
    result = []
    for source in sources:
        candidates = (await db.scalars(select(SharePointDocument).where(
            SharePointDocument.source_id == source.id, workspace.document_filter(),
            SharePointDocument.in_scope.is_(True), SharePointDocument.deleted.is_(False),
            SharePointDocument.is_folder.is_(False)))).all()
        for document in candidates:
            try:
                await authorize_document(db, user, source, document, graph, workspace=workspace)
            except SharePointError as error:
                if error.code in {"document_not_found", "document_access_denied", "document_changed_sync_required"}:
                    continue
                raise
            result.append({"id": str(source.id), "name": source.name})
            break
    return result
