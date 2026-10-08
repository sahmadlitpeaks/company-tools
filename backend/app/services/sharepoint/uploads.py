"""Durable, bounded upload notifications, independent of extraction and AI."""
import asyncio
import uuid
from datetime import datetime, timedelta, timezone
from urllib.parse import urlsplit

from sqlalchemy import or_, select, update

from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.models.sharepoint import SharePointDocument, SharePointSource, SharePointUploadDelivery
from app.services.dispatch import send_teams
from app.services.sharepoint.common import SharePointError, decrypt, now
from app.services.sharepoint.graph import GraphClient, application_token, safe_file_url
from app.services.sharepoint.store import in_live_scope


def valid_webhook(value):
    try:
        if len(value) > 4096:
            raise ValueError("Webhook URL too long")
        parsed = urlsplit(value)
        host = (parsed.hostname or "").lower()
        domains = ("webhook.office.com", "logic.azure.com", "api.powerplatform.com", "powerautomate.com")
        valid = (parsed.scheme == "https" and parsed.port in (None, 443) and not parsed.username
                 and not parsed.password and not parsed.fragment and bool(parsed.path.strip("/"))
                 and any(host == domain or host.endswith("." + domain) for domain in domains))
    except ValueError:
        valid = False
    if not valid:
        raise SharePointError("invalid_teams_webhook", 422)
    return value


def new_upload(source, item):
    """An older file newly discovered/moved into scope is not a new upload."""
    if not source.baseline_completed_at or not source.teams_notify_uploads:
        return False
    try:
        created = datetime.fromisoformat(item["createdDateTime"].replace("Z", "+00:00"))
        baseline = source.baseline_completed_at.replace(tzinfo=timezone.utc)
        if source.notify_after:
            baseline = max(baseline, source.notify_after.replace(tzinfo=timezone.utc))
        return created.tzinfo is not None and created > baseline
    except (KeyError, TypeError, ValueError, AttributeError):
        return False


async def queue_uploads(db, source, documents):
    for doc in documents:
        if not doc.upload_notification_pending:
            continue
        doc.upload_notification_pending = False
        if not doc.in_scope or doc.deleted or not source.teams_notify_uploads or not source.teams_webhook_cipher:
            continue
        existing = await db.scalar(select(SharePointUploadDelivery.id).where(
            SharePointUploadDelivery.source_id == source.id, SharePointUploadDelivery.document_id == doc.id))
        if not existing:
            db.add(SharePointUploadDelivery(source_id=source.id, document_id=doc.id,
                notification_version=source.notification_version))


def plain_label(value):
    # Adaptive Card text supports Markdown. Treat filenames and source names as
    # plain labels, never as user-controlled links, mentions or card formatting.
    text = " ".join(str(value or "").split())[:240]
    for character in ("\\", "*", "_", "[", "]", "(", ")", "<", ">", "#", "`"):
        text = text.replace(character, " ")
    return text


async def deliver_uploads(limit=20):
    async with AsyncSessionLocal() as db:
        ids = list((await db.scalars(select(SharePointUploadDelivery.id).join(
            SharePointSource, SharePointUploadDelivery.source_id == SharePointSource.id).where(
            SharePointSource.tenant_id == settings.SHAREPOINT_TENANT_ID,
            SharePointSource.registered.is_(True),
            SharePointSource.enabled.is_(True), SharePointSource.teams_notify_uploads.is_(True),
            SharePointUploadDelivery.status.in_(["pending", "failed"]),
            or_(SharePointUploadDelivery.next_attempt_at.is_(None), SharePointUploadDelivery.next_attempt_at <= now()),
            or_(SharePointUploadDelivery.lease_until.is_(None), SharePointUploadDelivery.lease_until < now()),
        ).order_by(SharePointUploadDelivery.created_at, SharePointUploadDelivery.id).limit(limit))).all())
    if not ids:
        return
    graph = GraphClient(await application_token())
    for delivery_id in ids:
        owner = str(uuid.uuid4())
        async with AsyncSessionLocal() as db:
            changed = await db.execute(update(SharePointUploadDelivery).where(
                SharePointUploadDelivery.id == delivery_id,
                SharePointUploadDelivery.status.in_(["pending", "failed"]),
                or_(SharePointUploadDelivery.next_attempt_at.is_(None), SharePointUploadDelivery.next_attempt_at <= now()),
                or_(SharePointUploadDelivery.lease_until.is_(None), SharePointUploadDelivery.lease_until < now()),
            ).values(lease_owner=owner, lease_until=now() + timedelta(seconds=180)))
            await db.commit()
            if not changed.rowcount:
                continue
        async with AsyncSessionLocal() as db:
            delivery = (await db.scalars(select(SharePointUploadDelivery).where(
                SharePointUploadDelivery.id == delivery_id,
                SharePointUploadDelivery.lease_owner == owner).with_for_update())).first()
            if not delivery:
                continue
            source = (await db.scalars(select(SharePointSource).where(
                SharePointSource.id == delivery.source_id).with_for_update())).first()
            doc = await db.get(SharePointDocument, delivery.document_id)
            if (not source or source.tenant_id != settings.SHAREPOINT_TENANT_ID
                    or not source.registered or not source.enabled or not source.teams_notify_uploads):
                delivery.lease_owner = delivery.lease_until = None
                await db.commit()
                continue
            if (delivery.notification_version != source.notification_version or not source.teams_webhook_cipher
                    or not doc or doc.source_id != source.id or doc.deleted or not doc.in_scope):
                delivery.status, delivery.last_error = "skipped", "upload_destination_or_document_changed"
            else:
                delivery.attempts += 1
                try:
                    metadata = await graph.item(source.drive_id, doc.item_id)
                    if "deleted" in metadata or not await in_live_scope(graph, source, metadata):
                        raise SharePointError("document_not_found", 404)
                    link = metadata.get("webUrl", "")
                    if not safe_file_url(link) or not (urlsplit(link).hostname or "").endswith(".sharepoint.com"):
                        raise SharePointError("invalid_upload_link", 422)
                    destination = valid_webhook(decrypt(source.teams_webhook_cipher))
                    sent = await asyncio.to_thread(send_teams,
                        "New file uploaded: " + plain_label(metadata.get("name") or doc.filename),
                        "Source: " + plain_label(source.name), link, webhook_url=destination)
                    if sent:
                        delivery.status, delivery.sent_at, delivery.last_error = "sent", now(), None
                    else:
                        raise SharePointError("teams_upload_delivery_failed")
                except SharePointError as error:
                    delivery.status = "skipped" if error.code in {"document_not_found", "document_access_denied"} else "failed"
                    delivery.last_error = error.code
                except Exception:
                    delivery.status, delivery.last_error = "failed", "teams_upload_delivery_failed"
                if delivery.status == "failed":
                    delivery.next_attempt_at = now() + timedelta(seconds=min(3600, 30 * 2 ** min(delivery.attempts, 7)))
            delivery.lease_owner = delivery.lease_until = None
            await db.commit()


async def upload_notification_loop():
    while True:
        try:
            if settings.SHAREPOINT_ENABLED:
                await deliver_uploads()
        except asyncio.CancelledError:
            raise
        except Exception:
            # Never log webhook URLs, upstream response bodies or document data.
            pass
        await asyncio.sleep(5)
