import time
import uuid
from urllib.parse import unquote, urlparse

from sqlalchemy import delete, select, update
from sqlalchemy.exc import IntegrityError

from app.core.config import settings
from app.models.sharepoint import SharePointDocument, SharePointRun, SharePointSource
from app.services.sharepoint.analysis import payload_hash
from app.services.sharepoint.common import SharePointError, decrypt, digest, now, require_config
from app.services.sharepoint.graph import GraphClient, delegated_token
from app.services.sharepoint.privacy import restore


def scope_key():
    return digest([settings.SHAREPOINT_TENANT_ID, settings.SHAREPOINT_SITE_ID, settings.SHAREPOINT_DRIVE_ID, settings.SHAREPOINT_FOLDER_ID])


async def source_for(db):
    try:
        require_config()
    except SharePointError:
        existing = (await db.scalars(select(SharePointSource))).first()
        if existing:
            return existing
        raise
    key = scope_key()
    source = (await db.execute(select(SharePointSource).where(SharePointSource.scope_key == key))).scalar_one_or_none()
    if source:
        return source
    try:
        async with db.begin_nested():
            source = SharePointSource(scope_key=key, tenant_id=settings.SHAREPOINT_TENANT_ID,
                site_id=settings.SHAREPOINT_SITE_ID, drive_id=settings.SHAREPOINT_DRIVE_ID,
                folder_id=settings.SHAREPOINT_FOLDER_ID, policy="auto")
            db.add(source)
            await db.flush()
    except IntegrityError:
        source = (await db.execute(select(SharePointSource).where(SharePointSource.scope_key == key))).scalar_one()
    return source


def purge(document, status="queued"):
    clear_auth_cache()
    document.status = status
    document.compliance_status = "pending"
    document.compliance = None
    document.company_id = None
    document.reviewed_by = document.reviewed_at = None
    document.segments = document.mapping_cipher = document.analysis = document.usage = None
    document.languages = document.fingerprint = document.payload_hash = document.approval_hash = None
    document.approved_by = document.approved_at = document.processed_at = None
    document.error_code = None
    document.attempts = 0


async def purge_document_reminders(db, document_id: uuid.UUID):
    from app.models.sharepoint import SharePointReminder
    await db.execute(
        delete(SharePointReminder).where(
            SharePointReminder.document_id == document_id,
            SharePointReminder.status.in_(["pending", "failed", "skipped"]),
        )
    )


async def enqueue(db, source, user_id=None):
    run_id = uuid.uuid4()
    result = await db.execute(update(SharePointSource).where(SharePointSource.id == source.id,
        SharePointSource.active_run_id.is_(None)).values(active_run_id=str(run_id)))
    if result.rowcount:
        run = SharePointRun(id=run_id, source_id=source.id, requested_by=user_id)
        db.add(run)
        await db.flush()
        return run
    await db.refresh(source)
    return await db.get(SharePointRun, uuid.UUID(source.active_run_id))


async def in_live_scope(graph, source, metadata):
    parent = metadata.get("parentReference") or {}
    if parent.get("driveId") != source.drive_id:
        return False
    seen = set()
    item = metadata.get("id")
    for _ in range(100):
        if item == source.folder_id:
            return True
        item = parent.get("id")
        if not item or item in seen:
            return False
        if item == source.folder_id:
            return True
        seen.add(item)
        ancestor = await graph.item(source.drive_id, item)
        parent = ancestor.get("parentReference") or {}
        if parent.get("driveId") not in (None, source.drive_id):
            return False
    return False


# Authorization TTL Cache: (user_id, document_id, version) -> (expires_monotonic, metadata)
_AUTH_CACHE: dict[tuple[uuid.UUID, uuid.UUID, str], tuple[float, dict]] = {}
AUTH_CACHE_TTL_SECONDS = 300.0


def clear_auth_cache() -> None:
    _AUTH_CACHE.clear()


def get_cached_authorization(user_id: uuid.UUID, doc_id: uuid.UUID, version: str) -> dict | None:
    key = (user_id, doc_id, version or "")
    if key in _AUTH_CACHE:
        expires_at, meta = _AUTH_CACHE[key]
        if time.monotonic() < expires_at:
            return meta
        _AUTH_CACHE.pop(key, None)
    return None


def set_cached_authorization(user_id: uuid.UUID, doc_id: uuid.UUID, version: str, meta: dict, ttl: float = AUTH_CACHE_TTL_SECONDS) -> None:
    key = (user_id, doc_id, version or "")
    _AUTH_CACHE[key] = (time.monotonic() + ttl, meta)


async def authorize_document(db, user, source, document, graph=None, use_cache: bool = False):
    if not document or document.source_id != source.id or document.deleted or not document.in_scope or document.is_folder:
        raise SharePointError("document_not_found", 404)
    if use_cache:
        cached = get_cached_authorization(user.id, document.id, document.version)
        if cached is not None:
            return cached
    graph = graph or GraphClient(await delegated_token(db, user))
    metadata = await graph.can_read(source.drive_id, document.item_id)
    if not await in_live_scope(graph, source, metadata):
        raise SharePointError("document_not_found", 404)
    if not metadata.get("eTag") or metadata["eTag"] != document.version:
        # Read paths never serve results produced from an older SharePoint version.
        # A new sync will replace the stale version. No implicit cloud AI call here.
        raise SharePointError("document_changed_sync_required", 409)
    if document.segments and document.payload_hash != payload_hash(document.segments):
        raise SharePointError("document_changed_sync_required", 409)
    if use_cache:
        set_cached_authorization(user.id, document.id, document.version, metadata)
    return metadata


def public_document(document, metadata, detail=False):
    url = metadata.get("webUrl", "")
    parsed = urlparse(url)
    if parsed.scheme != "https" or not parsed.hostname or not parsed.hostname.endswith(".sharepoint.com"):
        url = ""
    path = (document.path or "").strip()
    if not path and (document.web_url or url):
        target_url = document.web_url or url
        if "/Shared%20Documents/" in target_url or "/Shared Documents/" in target_url:
            split_key = "/Shared%20Documents/" if "/Shared%20Documents/" in target_url else "/Shared Documents/"
            sub = target_url.split(split_key, 1)[1]
            path = f"/Shared Documents/{unquote(sub)}"
        elif document.filename:
            path = f"/{document.filename}"

    result = {"id": str(document.id), "name": metadata.get("name", "Document"), "url": url,
        "path": path,
        "status": document.status, "error_code": document.error_code, "languages": document.languages or [],
        "size": metadata.get("size") or document.size or 0,
        "modified_at": metadata.get("lastModifiedDateTime") or document.modified_at,
        "processed_at": document.processed_at.isoformat() if document.processed_at else None,
        "requires_attention": bool((document.analysis or {}).get("requires_attention"))}
    if detail:
        mapping = decrypt(document.mapping_cipher) if document.mapping_cipher else {}
        result["analysis"] = restore(document.analysis, mapping)
        result["compliance"] = document.compliance
        result["segments"] = restore(document.segments or [], mapping)
        result["usage"] = document.usage
        result["model"] = settings.SHAREPOINT_OPENAI_MODEL
        result["attempts"] = document.attempts
    return result


def run_info(run):
    if not run:
        return None
    return {"id": str(run.id), "status": run.status, "discovered": run.discovered,
        "processed": run.processed, "failed": run.failed, "error_code": run.error_code,
        "created_at": run.created_at, "finished_at": run.finished_at}
