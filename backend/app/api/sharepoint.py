"""Company module authorization + live delegated SharePoint authorization."""
import time
import uuid
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, Request
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.responses import RedirectResponse

from app.auth.deps import get_current_admin, get_current_user
from app.core.config import settings
from app.core.database import get_db
from app.models.sharepoint import SharePointConnection, SharePointDocument, SharePointReminder, SharePointRun, SharePointSource
from app.schemas.sharepoint import ApprovalIn, CentralChatIn, ChatIn, ReminderOut, ReminderUpdateIn, RulesIn, SearchIn
from app.services.activity import record
from app.services.sharepoint.analysis import payload, payload_hash
from app.services.sharepoint.chat import ask_central, ask_document
from app.services.sharepoint.common import SharePointError, configuration_errors, decrypt, encrypt, is_reviewer, now, require_config
from app.services.sharepoint.graph import GraphClient, application_token, delegated_token, oauth_client
from app.services.sharepoint.privacy import restore
from app.services.sharepoint.reminders import _calculate_reminder_date, deliver_reminder, run_sharepoint_reminders
from app.services.sharepoint.store import authorize_document, enqueue, public_document, purge, purge_document_reminders, run_info, scope_key, source_for


async def same_origin(request: Request):
    if request.method in ("POST", "PUT", "DELETE", "PATCH"):
        origin = request.headers.get("origin")
        allowed = set(settings.cors_origins) | {str(request.base_url).rstrip("/")}
        if settings.PUBLIC_BASE_URL:
            allowed.add(settings.PUBLIC_BASE_URL.rstrip("/"))
        loopback_variants = set()
        for item in allowed:
            if "localhost" in item:
                loopback_variants.add(item.replace("localhost", "127.0.0.1"))
            elif "127.0.0.1" in item:
                loopback_variants.add(item.replace("127.0.0.1", "localhost"))
        allowed |= loopback_variants
        if request.headers.get("sec-fetch-site") == "cross-site" or (origin and origin not in allowed):
            raise SharePointError("invalid_request_origin", 403)


router = APIRouter(prefix="/sharepoint", tags=["sharepoint"], dependencies=[Depends(same_origin)])


@router.get("/status")
async def status(user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    missing = configuration_errors()
    connection = await db.get(SharePointConnection, user.id)
    connected = bool(connection and connection.tenant_id == settings.SHAREPOINT_TENANT_ID and
        connection.client_id == settings.SHAREPOINT_CLIENT_ID and (connection.object_id == user.azure_oid if user.azure_oid else bool(connection.object_id)))
    source = None
    run = None
    if settings.SHAREPOINT_ENABLED and not missing:
        source = await source_for(db)
        if user.is_admin:
            run = (await db.scalars(select(SharePointRun).where(SharePointRun.source_id == source.id).order_by(SharePointRun.created_at.desc()).limit(1))).first()
    return {"enabled": settings.SHAREPOINT_ENABLED, "configured": not missing,
        "missing": missing if user.is_admin else [], "connected": connected,
        "microsoft_sign_in_required": False, "can_review": is_reviewer(user),
        "user_id": str(user.id), "openai_configured": bool(settings.SHAREPOINT_OPENAI_API_KEY and settings.SHAREPOINT_OPENAI_MODEL),
        "policy": source.policy if source else "review", "active_run": bool(source and source.active_run_id),
        "run": run_info(run), "last_sync": source.last_sync.isoformat() if source and source.last_sync else None,
        "languages": [x.strip() for x in settings.SHAREPOINT_NER_LANGUAGES.split(",") if x.strip()]}


@router.get("/connect")
async def connect(request: Request, user=Depends(get_current_user)):
    require_config()
    request.session["sharepoint_user"] = {"id": str(user.id), "scope": scope_key()}
    return await oauth_client().authorize_redirect(request, settings.SHAREPOINT_REDIRECT_URI, prompt="select_account")


@router.get("/callback")
async def callback(request: Request, user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    require_config()
    context = request.session.pop("sharepoint_user", None)
    if context != {"id": str(user.id), "scope": scope_key()}:
        raise SharePointError("microsoft_connection_state_invalid", 403)
    try:
        token = await oauth_client().authorize_access_token(request)
        identity = token.get("userinfo") or {}
        oid = (identity.get("oid") or "").strip()
        if identity.get("tid", "").lower() != settings.SHAREPOINT_TENANT_ID.lower() or not oid:
            raise SharePointError("microsoft_account_mismatch", 403)
        if user.azure_oid and oid.lower() != user.azure_oid.lower():
            raise SharePointError("microsoft_account_mismatch", 403)
        if not user.azure_oid:
            user.azure_oid = oid
        if not token.get("access_token") or not token.get("refresh_token"):
            raise SharePointError("microsoft_consent_required", 403)
        secret = {k: token[k] for k in ("access_token", "refresh_token", "expires_at") if k in token}
        if "expires_at" not in secret:
            secret["expires_at"] = time.time() + int(token.get("expires_in", 3600))
    except SharePointError:
        raise
    except Exception:
        raise SharePointError("microsoft_connection_failed", 403) from None
    connection = await db.get(SharePointConnection, user.id)
    if not connection:
        connection = SharePointConnection(user_id=user.id, version=0)
        db.add(connection)
    connection.tenant_id, connection.object_id, connection.client_id = settings.SHAREPOINT_TENANT_ID, oid, settings.SHAREPOINT_CLIENT_ID
    connection.token_cipher = encrypt(secret)
    connection.version += 1
    record(db, user=user, action="connect", entity_type="sharepoint", summary="Connected Microsoft document access")
    await db.commit()
    return RedirectResponse("/sharepoint?connected=1", status_code=303)


@router.delete("/connection", status_code=204)
async def disconnect(user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await db.execute(delete(SharePointConnection).where(SharePointConnection.user_id == user.id))
    record(db, user=user, action="disconnect", entity_type="sharepoint", summary="Disconnected Microsoft document access")


@router.post("/test-connection")
async def test_connection(user=Depends(get_current_admin), db: AsyncSession = Depends(get_db)):
    source = await source_for(db)
    graph = GraphClient(await application_token())
    await graph.verify_source(source)
    return {"ok": True, "access": "read_only", "openai_tested": False}


@router.post("/sync", status_code=202)
async def sync(user=Depends(get_current_admin), db: AsyncSession = Depends(get_db)):
    source = await source_for(db)
    run = await enqueue(db, source, user.id)
    record(db, user=user, action="sync", entity_type="sharepoint", summary="Requested read-only document sync")
    return run_info(run)


@router.get("/rules")
async def rules(user=Depends(get_current_admin), db: AsyncSession = Depends(get_db)):
    source = await source_for(db)
    return {"policy": source.policy, "terms": decrypt(source.rules_cipher) if source.rules_cipher else []}


@router.put("/rules")
async def update_rules(body: RulesIn, user=Depends(get_current_admin), db: AsyncSession = Depends(get_db)):
    source = await source_for(db)
    source = (await db.scalars(select(SharePointSource).where(SharePointSource.id == source.id).with_for_update().execution_options(populate_existing=True))).one()
    terms = [term.model_dump() for term in body.terms]
    current_terms = decrypt(source.rules_cipher) if source.rules_cipher else []
    if source.policy == body.policy and current_terms == terms:
        return {"ok": True, "changed": False}
    if source.active_run_id:
        raise SharePointError("sync_in_progress", 409)
    source.policy, source.rules_cipher = body.policy, encrypt(terms)
    source.policy_version += 1
    for doc in (await db.scalars(select(SharePointDocument).where(SharePointDocument.source_id == source.id, SharePointDocument.in_scope.is_(True)))).all():
        purge(doc, "ai_skipped" if body.policy == "skip" else "queued")
        if doc.id:
            await purge_document_reminders(db, doc.id)
    run = await enqueue(db, source, user.id)
    record(db, user=user, action="policy", entity_type="sharepoint", summary="Updated document privacy policy; reprocessing queued")
    return {"ok": True, "changed": True, "run": run_info(run)}


@router.post("/search")
async def documents(body: SearchIn,
                    user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    # Search names/text stay out of access-log URLs and browser history.
    q, cursor = body.q, body.cursor or None
    source = await source_for(db)
    graph = GraphClient(await delegated_token(db, user))
    after = None
    if cursor:
        try:
            position = decrypt(cursor)
            if position["user"] != str(user.id) or position["scope"] != source.scope_key or position["q"] != q or position["until"] < time.time():
                raise ValueError()
            after = uuid.UUID(position["after"])
        except (ValueError, KeyError, TypeError, SharePointError):
            raise SharePointError("invalid_search_cursor", 400) from None
    query = select(SharePointDocument).where(SharePointDocument.source_id == source.id,
        SharePointDocument.in_scope.is_(True), SharePointDocument.deleted.is_(False), SharePointDocument.is_folder.is_(False))
    if after:
        query = query.where(SharePointDocument.id > after)
    candidates = list((await db.scalars(query.order_by(SharePointDocument.id).limit(21))).all())
    items = []
    for doc in candidates[:20]:
        try:
            metadata = await authorize_document(db, user, source, doc, graph)
        except SharePointError as error:
            if error.code in ("document_access_denied", "document_not_found", "document_changed_sync_required"):
                continue
            raise
        if q:
            mapping = decrypt(doc.mapping_cipher) if doc.mapping_cipher else {}
            text = metadata.get("name", "") + " " + " ".join(s["text"] for s in restore(doc.segments or [], mapping))
            if q.casefold() not in text.casefold():
                continue
        items.append(public_document(doc, metadata))
    next_cursor = None
    if len(candidates) > 20:
        next_cursor = encrypt({"user": str(user.id), "scope": source.scope_key, "q": q,
            "after": str(candidates[19].id), "until": time.time() + 900})
    return {"items": items, "next_cursor": next_cursor}


@router.get("/documents")
async def first_documents(user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await documents(SearchIn(), user, db)


@router.get("/documents/{document_id}")
async def document(document_id: uuid.UUID, user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    source = await source_for(db)
    doc = await db.get(SharePointDocument, document_id)
    metadata = await authorize_document(db, user, source, doc)
    return public_document(doc, metadata, detail=True)


@router.get("/documents/{document_id}/preview")
async def preview(document_id: uuid.UUID, user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    source = await source_for(db)
    if not is_reviewer(user):
        raise SharePointError("reviewer_required", 403)
    doc = await db.get(SharePointDocument, document_id)
    await authorize_document(db, user, source, doc)
    if doc.status != "awaiting_approval" or not doc.segments or doc.payload_hash != payload_hash(doc.segments):
        raise SharePointError("preview_not_current", 409)
    return {"payload_hash": doc.payload_hash, "payload": payload(doc.segments)}


@router.post("/documents/{document_id}/approve", status_code=202)
async def approve(document_id: uuid.UUID, body: ApprovalIn, user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    source = await source_for(db)
    if not is_reviewer(user):
        raise SharePointError("reviewer_required", 403)
    doc = await db.get(SharePointDocument, document_id)
    await authorize_document(db, user, source, doc)
    source = (await db.scalars(select(SharePointSource).where(SharePointSource.id == source.id).with_for_update().execution_options(populate_existing=True))).one()
    await db.refresh(doc)
    if source.active_run_id or source.policy != "review" or doc.status != "awaiting_approval" or body.payload_hash != doc.payload_hash or body.payload_hash != payload_hash(doc.segments or []):
        raise SharePointError("approval_not_current", 409)
    doc.approval_hash, doc.approved_by, doc.approved_at = body.payload_hash, user.id, now()
    doc.status, doc.attempts = "approved", 0
    run = await enqueue(db, source, user.id)
    record(db, user=user, action="approve_ai", entity_type="sharepoint", entity_id=doc.id, summary="Approved exact sanitized document payload")
    return run_info(run)


@router.post("/documents/{document_id}/retry", status_code=202)
async def retry(document_id: uuid.UUID, user=Depends(get_current_admin), db: AsyncSession = Depends(get_db)):
    source = await source_for(db)
    doc = await db.get(SharePointDocument, document_id)
    await authorize_document(db, user, source, doc)
    source = (await db.scalars(select(SharePointSource).where(SharePointSource.id == source.id).with_for_update().execution_options(populate_existing=True))).one()
    await db.refresh(doc)
    if source.active_run_id or doc.status != "failed":
        raise SharePointError("retry_not_available", 409)
    # A retry always repeats sanitization and review; old approval is discarded.
    purge(doc)
    if doc.id:
        await purge_document_reminders(db, doc.id)
    return run_info(await enqueue(db, source, user.id))


@router.post("/documents/{document_id}/chat")
async def document_chat(document_id: uuid.UUID, body: ChatIn, user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    source = await source_for(db)
    doc = await db.get(SharePointDocument, document_id)
    await authorize_document(db, user, source, doc)
    return await ask_document(db, user, str(document_id), [m.model_dump() for m in body.messages])


@router.post("/chat")
async def central_chat(body: CentralChatIn, user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await ask_central(db, user, [m.model_dump() for m in body.messages], body.document_ids)


@router.get("/reminders", response_model=list[ReminderOut])
async def list_reminders(
    category: str | None = None,
    status: str | None = None,
    unassigned: bool | None = None,
    user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    source = await source_for(db)
    token = await delegated_token(db, user)
    graph = GraphClient(token)

    # 1. Filter by reminder IDs before loading document rows. DISTINCT on the
    # full document fails in PostgreSQL because documents contain JSON fields.
    reminder_doc_ids = select(SharePointReminder.document_id).where(SharePointReminder.source_id == source.id)
    if status:
        reminder_doc_ids = reminder_doc_ids.where(SharePointReminder.status == status)
    if category:
        reminder_doc_ids = reminder_doc_ids.where(SharePointReminder.category == category)
    if unassigned is True:
        reminder_doc_ids = reminder_doc_ids.where(SharePointReminder.recipient_email.is_(None))
    elif unassigned is False:
        reminder_doc_ids = reminder_doc_ids.where(SharePointReminder.recipient_email.is_not(None))

    doc_stmt = select(SharePointDocument).where(
        SharePointDocument.id.in_(reminder_doc_ids),
        SharePointDocument.deleted.is_(False),
        SharePointDocument.in_scope.is_(True),
    )
    candidate_docs = list((await db.scalars(doc_stmt)).all())
    if not candidate_docs:
        return []

    # 2. Authorize candidate documents first before applying limit
    auth_doc_cache: dict[uuid.UUID, dict] = {}
    for doc in candidate_docs:
        try:
            meta = await authorize_document(db, user, source, doc, graph)
            auth_doc_cache[doc.id] = meta
        except SharePointError:
            continue

    if not auth_doc_cache:
        return []

    # 3. Query reminders constrained strictly to authorized documents, ordered and limited to 150
    stmt = (
        select(SharePointReminder, SharePointDocument)
        .join(SharePointDocument, SharePointReminder.document_id == SharePointDocument.id)
        .where(
            SharePointReminder.source_id == source.id,
            SharePointReminder.document_id.in_(auth_doc_cache.keys()),
            SharePointDocument.deleted == False,
            SharePointDocument.in_scope == True,
        )
    )
    if status:
        stmt = stmt.where(SharePointReminder.status == status)
    if category:
        stmt = stmt.where(SharePointReminder.category == category)
    if unassigned is True:
        stmt = stmt.where(SharePointReminder.recipient_email.is_(None))
    elif unassigned is False:
        stmt = stmt.where(SharePointReminder.recipient_email.is_not(None))

    stmt = stmt.order_by(SharePointReminder.target_date.asc(), SharePointReminder.created_at.desc()).limit(150)
    rows = (await db.execute(stmt)).all()

    results = []
    for rem, doc in rows:
        meta = auth_doc_cache.get(doc.id, {})
        fname = doc.filename or meta.get("name", "Document")
        furl = meta.get("webUrl") or doc.web_url or ""
        fpath = doc.path or fname
        results.append(
            ReminderOut(
                id=str(rem.id),
                document_id=str(rem.document_id),
                document_name=fname,
                document_path=fpath,
                document_url=furl,
                title=rem.title,
                category=rem.category,
                target_date=rem.target_date,
                reminder_date=rem.reminder_date,
                lead_days=rem.lead_days,
                responsible_name=rem.responsible_name,
                recipient_email=rem.recipient_email,
                amount=rem.amount,
                currency=rem.currency,
                status=rem.status,
                notes=rem.notes,
                sent_at=rem.sent_at.isoformat() if rem.sent_at else None,
            )
        )
    return results


@router.post("/reminders/run")
async def trigger_reminders(user=Depends(get_current_admin), db: AsyncSession = Depends(get_db)):
    return await run_sharepoint_reminders(db)


@router.post("/reminders/{reminder_id}/test-send")
async def test_send_reminder(reminder_id: uuid.UUID, user=Depends(get_current_admin), db: AsyncSession = Depends(get_db)):
    rem = await db.get(SharePointReminder, reminder_id)
    if not rem:
        raise SharePointError("reminder_not_found", 404)
    source = await source_for(db)
    doc = await db.get(SharePointDocument, rem.document_id)
    if not doc or doc.deleted or not doc.in_scope:
        raise SharePointError("document_not_found", 404)
    await authorize_document(db, user, source, doc)
    success = await deliver_reminder(db, rem)
    return {"id": str(rem.id), "success": success, "status": rem.status, "last_error": rem.last_error}


@router.post("/reminders/{reminder_id}/dismiss")
async def dismiss_reminder(reminder_id: uuid.UUID, user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    rem = await db.get(SharePointReminder, reminder_id)
    if not rem:
        raise SharePointError("reminder_not_found", 404)
    source = await source_for(db)
    doc = await db.get(SharePointDocument, rem.document_id)
    if not doc or doc.deleted or not doc.in_scope:
        raise SharePointError("document_not_found", 404)
    await authorize_document(db, user, source, doc)
    rem.status = "dismissed"
    await db.commit()
    return {"id": str(rem.id), "status": "dismissed"}


@router.post("/reminders/{reminder_id}/complete")
async def complete_reminder(reminder_id: uuid.UUID, user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    rem = await db.get(SharePointReminder, reminder_id)
    if not rem:
        raise SharePointError("reminder_not_found", 404)
    source = await source_for(db)
    doc = await db.get(SharePointDocument, rem.document_id)
    if not doc or doc.deleted or not doc.in_scope:
        raise SharePointError("document_not_found", 404)
    await authorize_document(db, user, source, doc)
    rem.status = "completed"
    await db.commit()
    return {"id": str(rem.id), "status": "completed"}


@router.post("/reminders/{reminder_id}/reopen")
async def reopen_reminder(reminder_id: uuid.UUID, user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    rem = await db.get(SharePointReminder, reminder_id)
    if not rem:
        raise SharePointError("reminder_not_found", 404)
    source = await source_for(db)
    doc = await db.get(SharePointDocument, rem.document_id)
    if not doc or doc.deleted or not doc.in_scope:
        raise SharePointError("document_not_found", 404)
    await authorize_document(db, user, source, doc)
    rem.status = "pending"
    await db.commit()
    return {"id": str(rem.id), "status": "pending"}


@router.patch("/reminders/{reminder_id}")
async def update_reminder(reminder_id: uuid.UUID, body: ReminderUpdateIn, user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    rem = await db.get(SharePointReminder, reminder_id)
    if not rem:
        raise SharePointError("reminder_not_found", 404)
    source = await source_for(db)
    doc = await db.get(SharePointDocument, rem.document_id)
    if not doc or doc.deleted or not doc.in_scope:
        raise SharePointError("document_not_found", 404)
    await authorize_document(db, user, source, doc)
    if body.status is not None:
        rem.status = body.status
    if body.target_date is not None:
        rem.target_date = body.target_date
        rem.reminder_date = _calculate_reminder_date(body.target_date, rem.lead_days)
    if body.responsible_name is not None:
        rem.responsible_name = body.responsible_name
    if body.recipient_email is not None:
        if body.recipient_email.strip():
            from app.models.user import User
            from sqlalchemy import func
            assignee = (
                await db.execute(
                    select(User).where(
                        func.lower(User.email) == body.recipient_email.strip().lower(),
                        User.is_active == True,
                    )
                )
            ).scalars().first()
            if not assignee:
                raise SharePointError("invalid_recipient", 400)
            rem.recipient_email = assignee.email.lower()
        else:
            rem.recipient_email = None
    if body.notes is not None:
        rem.notes = body.notes
    await db.commit()
    return {"id": str(rem.id), "status": rem.status}


@router.get("/documents/{document_id}/reminders", response_model=list[ReminderOut])
async def document_reminders(document_id: uuid.UUID, user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    source = await source_for(db)
    doc = await db.get(SharePointDocument, document_id)
    await authorize_document(db, user, source, doc)
    stmt = (
        select(SharePointReminder)
        .where(SharePointReminder.document_id == document_id)
        .order_by(SharePointReminder.target_date.asc())
    )
    reminders = list((await db.scalars(stmt)).all())
    return [
        ReminderOut(
            id=str(r.id),
            document_id=str(r.document_id),
            document_name=doc.filename,
            document_path=doc.path or doc.filename,
            document_url=doc.web_url,
            title=r.title,
            category=r.category,
            target_date=r.target_date,
            reminder_date=r.reminder_date,
            lead_days=r.lead_days,
            responsible_name=r.responsible_name,
            recipient_email=r.recipient_email,
            amount=r.amount,
            currency=r.currency,
            status=r.status,
            notes=r.notes,
            sent_at=r.sent_at.isoformat() if r.sent_at else None,
        )
        for r in reminders
    ]
