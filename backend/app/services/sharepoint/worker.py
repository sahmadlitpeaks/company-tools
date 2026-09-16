"""Database-leased, restartable sync. All remote file operations are GETs."""
import asyncio
import logging
import uuid
from datetime import timedelta

from sqlalchemy import or_, select, update

from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.models.sharepoint import SharePointDocument, SharePointRun, SharePointSource
from app.models.user import User
from app.services.sharepoint.analysis import analyze, payload_hash
from app.services.sharepoint.common import SharePointError, decrypt, digest, encrypt, is_reviewer, now
from app.services.sharepoint.graph import GraphClient, application_token, graph_url, item_path
from app.services.sharepoint.privacy import PIPELINE_VERSION, preprocess
from app.services.sharepoint.store import authorize_document, enqueue, in_live_scope, purge, scope_key, source_for

log = logging.getLogger(__name__)
LEASE_SECONDS = 180


async def owned(db, source_id, owner):
    # The row lock serializes result publication with lease takeover on PostgreSQL.
    source = (await db.execute(select(SharePointSource).where(SharePointSource.id == source_id,
        SharePointSource.lease_owner == owner, SharePointSource.lease_until > now()).with_for_update())).scalar_one_or_none()
    if not source or source.scope_key != scope_key():
        raise SharePointError("sync_lease_lost", 409)
    return source


async def heartbeat(source_id, owner):
    while True:
        await asyncio.sleep(20)
        async with AsyncSessionLocal() as db:
            changed = await db.execute(update(SharePointSource).where(SharePointSource.id == source_id,
                SharePointSource.lease_owner == owner, SharePointSource.lease_until > now()).values(lease_until=now() + timedelta(seconds=LEASE_SECONDS)))
            await db.commit()
            if not changed.rowcount:
                return


async def claim():
    async with AsyncSessionLocal() as db:
        source = await source_for(db)
        if not source.active_run_id and settings.SHAREPOINT_POLLING_ENABLED:
            last = source.last_sync
            if last is None or (now() - last.replace(tzinfo=now().tzinfo)).total_seconds() >= max(60, settings.SHAREPOINT_SYNC_INTERVAL_SECONDS):
                await enqueue(db, source)
        owner = str(uuid.uuid4())
        changed = await db.execute(update(SharePointSource).execution_options(synchronize_session=False).where(SharePointSource.id == source.id,
            SharePointSource.active_run_id.is_not(None), or_(SharePointSource.lease_until.is_(None), SharePointSource.lease_until < now())
        ).values(lease_owner=owner, lease_until=now() + timedelta(seconds=LEASE_SECONDS)))
        await db.commit()
        return (source.id, owner) if changed.rowcount else None


def item_path_from_metadata(item, indexed):
    parent = item.get("parentReference") or {}
    p_path = parent.get("path") or ""
    name = item.get("name", "")
    if "root:" in p_path:
        rel = p_path.split("root:", 1)[1].strip("/")
        return f"/{rel}/{name}".replace("//", "/") if rel else f"/{name}"
    parts = [name]
    curr_pid = parent.get("id")
    seen = set()
    while curr_pid and curr_pid not in seen:
        seen.add(curr_pid)
        p_doc = indexed.get(curr_pid) if indexed else None
        if not p_doc:
            break
        if p_doc.filename:
            parts.append(p_doc.filename)
        curr_pid = p_doc.parent_id
    return "/" + "/".join(reversed(parts)).lstrip("/")


def ancestry(doc, by_id, folder):
    seen = set()
    current = doc
    for _ in range(100):
        if current.deleted:
            return False
        if current.item_id == folder or current.parent_id == folder:
            return True
        if not current.parent_id or current.parent_id in seen:
            return False
        seen.add(current.parent_id)
        current = by_id.get(current.parent_id)
        if not current:
            return False
    return False


async def discover(source_id, owner, graph):
    async with AsyncSessionLocal() as db:
        source = await owned(db, source_id, owner)
        drive, folder = source.drive_id, source.folder_id
        # Confirm the configured drive belongs to the selected site, not an arbitrary drive.
        await graph.verify_source(source)
        run = await db.get(SharePointRun, uuid.UUID(source.active_run_id))
        run.status = "running"
        if not source.delta_link and not source.next_link:
            source.generation = str(uuid.uuid4())
        await db.commit()
    reset_once = False
    pages = 0
    visited = set()
    while True:
        async with AsyncSessionLocal() as db:
            source = await owned(db, source_id, owner)
            link = source.next_link or source.delta_link or f"/drives/{drive}/root/delta?$select=id,name,eTag,parentReference,webUrl,file,folder,size,lastModifiedDateTime,deleted"
            generation = source.generation
        pages += 1
        if link in visited or pages > settings.SHAREPOINT_MAX_ITEMS + 1:
            raise SharePointError("delta_page_limit", 422)
        visited.add(link)
        try:
            page = await graph.get(link)
        except SharePointError as error:
            if error.code != "delta_expired" or reset_once:
                raise
            reset_once = True
            visited.clear()
            async with AsyncSessionLocal() as db:
                source = await owned(db, source_id, owner)
                source.next_link = source.delta_link = None
                source.generation = str(uuid.uuid4())
                await db.commit()
            continue
        if not isinstance(page.get("value"), list):
            raise SharePointError("invalid_delta_page", 502)
        next_link, delta = page.get("@odata.nextLink"), page.get("@odata.deltaLink")
        if (not next_link and not delta) or (next_link and delta):
            raise SharePointError("invalid_delta_page", 502)
        graph_url(next_link or delta)
        async with AsyncSessionLocal() as db:
            source = await owned(db, source_id, owner)
            documents = list((await db.scalars(select(SharePointDocument).where(SharePointDocument.source_id == source_id))).all())
            indexed = {d.item_id: d for d in documents}
            run = await db.get(SharePointRun, uuid.UUID(source.active_run_id))
            for item in page["value"]:
                if not isinstance(item.get("id"), str):
                    raise SharePointError("invalid_delta_item", 502)
                doc = indexed.get(item["id"])
                if not doc:
                    if len(indexed) >= settings.SHAREPOINT_MAX_ITEMS:
                        raise SharePointError("source_item_limit", 422)
                    doc = SharePointDocument(source_id=source_id, item_id=item["id"])
                    db.add(doc)
                    indexed[item["id"]] = doc
                doc.seen_generation = generation
                if "deleted" in item:
                    doc.deleted = True
                    doc.in_scope = False
                    purge(doc, "deleted")
                    doc.filename = doc.web_url = doc.path = ""
                    continue
                if doc.version != item.get("eTag", "") or doc.deleted:
                    purge(doc)
                doc.deleted = False
                doc.version = item.get("eTag", "")
                doc.parent_id = (item.get("parentReference") or {}).get("id")
                doc.is_folder = "folder" in item
                doc.filename, doc.web_url = item.get("name", ""), item.get("webUrl", "")
                doc.path = item_path_from_metadata(item, indexed)
                doc.mime_type = (item.get("file") or {}).get("mimeType", "")
                doc.size = item.get("size", 0)
                doc.modified_at = item.get("lastModifiedDateTime")
                run.discovered += 1
            source.next_link = next_link
            if not next_link:
                if generation:
                    for doc in indexed.values():
                        if doc.seen_generation != generation:
                            doc.deleted = True
                            purge(doc, "deleted")
                for doc in indexed.values():
                    included = ancestry(doc, indexed, folder) and not doc.is_folder
                    if doc.in_scope and not included:
                        purge(doc, "out_of_scope")
                    elif included and not doc.in_scope:
                        purge(doc)
                    elif included and doc.segments and doc.payload_hash != payload_hash(doc.segments):
                        purge(doc)
                    doc.in_scope = included
                    if not included:
                        doc.filename = doc.web_url = doc.path = ""
                source.delta_link = delta
                source.generation = None
            await db.commit()
        if not next_link:
            return


async def process_document(source_id, owner, document_id, graph):
    async with AsyncSessionLocal() as db:
        source = await owned(db, source_id, owner)
        doc = await db.get(SharePointDocument, document_id)
        if not doc.in_scope or doc.deleted:
            return
        if source.policy == "skip":
            purge(doc, "ai_skipped")
            await db.commit()
            return
        policy, policy_version = source.policy, source.policy_version
        terms = decrypt(source.rules_cipher) if source.rules_cipher else []
        drive, version, item, filename = source.drive_id, doc.version, doc.item_id, doc.filename
        segments, mapping, languages = doc.segments, doc.mapping_cipher, doc.languages
        approved = doc.approval_hash
        doc.status = "processing"
        doc.attempts += 1
        await db.commit()
    try:
        metadata = await graph.item(drive, item)
        if metadata.get("eTag") != version or not await in_live_scope(graph, source, metadata):
            raise SharePointError("document_changed_sync_required", 409)
        if not segments:
            if metadata.get("size", 0) > settings.SHAREPOINT_MAX_FILE_BYTES:
                raise SharePointError("file_too_large", 422)
            data = await graph.get(item_path(drive, item) + "/content", content=True, download=True)
            segments, mapping_values, languages = await preprocess(data, filename.rsplit(".", 1)[-1].lower(), terms)
            del data
            mapping = encrypt(mapping_values)
        final_metadata = await graph.item(drive, item)
        if final_metadata.get("eTag") != version or not await in_live_scope(graph, source, final_metadata):
            raise SharePointError("document_changed_sync_required", 409)
        hashed = payload_hash(segments)
        fingerprint = digest([version, policy_version, PIPELINE_VERSION, hashed])
        async with AsyncSessionLocal() as db:
            live_source = await owned(db, source_id, owner)
            doc = await db.get(SharePointDocument, document_id)
            if live_source.policy_version != policy_version or doc.version != version:
                raise SharePointError("document_changed_sync_required", 409)
            doc.segments, doc.mapping_cipher, doc.languages = segments, mapping, languages
            doc.payload_hash, doc.fingerprint = hashed, fingerprint
            if policy == "review" and approved != hashed:
                doc.status = "awaiting_approval"
                doc.approval_hash = None
                await db.commit()
                return
            if policy == "review":
                reviewer = await db.get(User, doc.approved_by) if doc.approved_by else None
                if not reviewer or not reviewer.is_active or reviewer.status != "active" or reviewer.must_change_password or not is_reviewer(reviewer) or "sharepoint_intelligence" not in reviewer.effective_permissions:
                    doc.status = "awaiting_approval"
                    doc.approval_hash = None
                    await db.commit()
                    return
                await authorize_document(db, reviewer, live_source, doc)
            await db.commit()
        analysis, usage = await analyze(segments)
        metadata = await graph.item(drive, item)
        if metadata.get("eTag") != version or not await in_live_scope(graph, source, metadata):
            raise SharePointError("document_changed_sync_required", 409)
        async with AsyncSessionLocal() as db:
            live_source = await owned(db, source_id, owner)
            doc = await db.get(SharePointDocument, document_id)
            if live_source.policy_version != policy_version or doc.version != version:
                raise SharePointError("document_changed_sync_required", 409)
            doc.analysis, doc.usage, doc.status, doc.error_code = analysis, usage, "ready", None
            doc.processed_at = now()
            run = await db.get(SharePointRun, uuid.UUID(live_source.active_run_id))
            run.processed += 1
            await db.commit()
            try:
                from app.services.sharepoint.reminders import populate_document_reminders
                await populate_document_reminders(db, doc, analysis, live_source.id)
            except Exception as rem_err:
                import logging
                logging.getLogger("sharepoint_worker").warning("Reminder population failed for %s: %s", document_id, rem_err)
    except SharePointError as error:
        if error.code == "sync_lease_lost":
            raise
        async with AsyncSessionLocal() as db:
            live_source = await owned(db, source_id, owner)
            doc = await db.get(SharePointDocument, document_id)
            doc.error_code = error.code
            doc.status = "failed"
            doc.analysis = None
            if error.code in ("document_changed_sync_required", "document_access_denied"):
                purge(doc, "failed")
                doc.error_code = error.code
            run = await db.get(SharePointRun, uuid.UUID(live_source.active_run_id))
            run.failed += 1
            await db.commit()


async def execute(source_id, owner):
    beat = asyncio.create_task(heartbeat(source_id, owner))
    failure = None
    try:
        graph = GraphClient(await application_token())
        await discover(source_id, owner, graph)
        async with AsyncSessionLocal() as db:
            await owned(db, source_id, owner)
            await db.execute(update(SharePointDocument).where(SharePointDocument.source_id == source_id,
                SharePointDocument.status == "processing", SharePointDocument.attempts >= 3
            ).values(status="failed", error_code="processing_retry_limit"))
            await db.commit()
            ids = list((await db.scalars(select(SharePointDocument.id).where(
                SharePointDocument.source_id == source_id, SharePointDocument.in_scope.is_(True),
                SharePointDocument.deleted.is_(False), SharePointDocument.status.in_(["queued", "processing", "approved", "failed"]),
                SharePointDocument.attempts < 3))).all())
        for document_id in ids:
            await process_document(source_id, owner, document_id, graph)
    except SharePointError as error:
        failure = error.code
    except Exception:
        # Never log exception bodies: upstream exceptions may include document data/tokens.
        failure = "sync_failed"
    finally:
        beat.cancel()
        await asyncio.gather(beat, return_exceptions=True)
    if failure == "sync_lease_lost":
        return
    async with AsyncSessionLocal() as db:
        source = await owned(db, source_id, owner)
        run = await db.get(SharePointRun, uuid.UUID(source.active_run_id))
        run.status, run.error_code, run.finished_at = ("failed" if failure else "completed"), failure, now()
        source.active_run_id = source.lease_owner = source.lease_until = None
        source.last_sync = now()
        await db.commit()


async def worker_loop():
    while True:
        try:
            if settings.SHAREPOINT_ENABLED:
                work = await claim()
                if work:
                    await execute(*work)
        except asyncio.CancelledError:
            raise
        except Exception:
            log.warning("SharePoint worker unavailable; retrying (details withheld)")
        await asyncio.sleep(5)
