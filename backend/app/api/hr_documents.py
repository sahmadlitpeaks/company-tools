"""Employee HR documents (contracts, visas, IDs) with expiry tracking.

Documents are sensitive: visible to the employee themselves and to admins/HR
(People-Ops permission) — not to department managers. The router is therefore
not module-gated; each endpoint enforces visibility itself (like profiles).
"""
import uuid
from datetime import date, timedelta

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.core.database import get_db
from app.models.hr import (
    DOCUMENT_CATEGORIES,
    HrDocument,
    SignatureRequest,
)
from app.models.user import User
from app.schemas.hr_document import HrDocumentOut, SignatureRequestOut, SignIn
from app.services.activity import record
from app.services.notify import notify_user
from app.services.people import user_labels
from app.services.storage import absolute_path, save_upload

router = APIRouter(prefix="/hr-documents", tags=["hr"])


def _is_hr(user: User) -> bool:
    return user.is_admin or "hr" in user.effective_permissions


def _parse_date(v: str | None):
    v = (v or "").strip()
    if not v:
        return None
    try:
        return date.fromisoformat(v)
    except ValueError:
        return None


def _serialize(doc: HrDocument, names: dict | None = None) -> HrDocumentOut:
    out = HrDocumentOut.model_validate(doc)
    if doc.expiry_date:
        out.days_to_expiry = (doc.expiry_date - date.today()).days
    if names:
        out.user_name = names.get(doc.user_id)
    return out


@router.get("/by-user/{user_id}", response_model=list[HrDocumentOut])
async def list_documents(
    user_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    viewer: User = Depends(get_current_user),
):
    if viewer.id != user_id and not _is_hr(viewer):
        raise HTTPException(status_code=403, detail="Not allowed")
    docs = (
        await db.execute(
            select(HrDocument)
            .where(HrDocument.user_id == user_id)
            .order_by(HrDocument.created_at.desc())
        )
    ).scalars().all()
    # Latest signature request per document.
    sig_by_doc: dict[uuid.UUID, SignatureRequest] = {}
    if docs:
        reqs = (
            await db.execute(
                select(SignatureRequest)
                .where(SignatureRequest.document_id.in_([d.id for d in docs]))
                .order_by(SignatureRequest.created_at.desc())
            )
        ).scalars().all()
        for r in reqs:
            sig_by_doc.setdefault(r.document_id, r)
    out = []
    for d in docs:
        item = _serialize(d)
        sig = sig_by_doc.get(d.id)
        if sig:
            item.signature_status = sig.status
            item.signature_request_id = sig.id
        out.append(item)
    return out


@router.post("/by-user/{user_id}", response_model=HrDocumentOut, status_code=201)
async def upload_document(
    user_id: uuid.UUID,
    file: UploadFile = File(...),
    title: str = Form(...),
    category: str = Form("other"),
    issue_date: str | None = Form(None),
    expiry_date: str | None = Form(None),
    notes: str | None = Form(None),
    db: AsyncSession = Depends(get_db),
    viewer: User = Depends(get_current_user),
):
    # Only admins/HR may add documents to someone's record.
    if not _is_hr(viewer):
        raise HTTPException(status_code=403, detail="Only HR can add documents")
    if not await db.get(User, user_id):
        raise HTTPException(status_code=404, detail="User not found")
    if category not in DOCUMENT_CATEGORIES:
        raise HTTPException(status_code=422, detail="Invalid category")
    if not title.strip():
        raise HTTPException(status_code=422, detail="Title is required")
    rel_path, size = await save_upload(file, subdir="hr-documents")
    doc = HrDocument(
        user_id=user_id,
        title=title.strip(),
        category=category,
        file_path=rel_path,
        content_type=file.content_type,
        size_bytes=size,
        issue_date=_parse_date(issue_date),
        expiry_date=_parse_date(expiry_date),
        notes=notes,
        uploaded_by_id=viewer.id,
    )
    db.add(doc)
    record(
        db, user=viewer, action="created", entity_type="user", entity_id=user_id,
        summary=f"Uploaded HR document: {doc.title}",
    )
    await db.commit()
    await db.refresh(doc)
    return _serialize(doc)


@router.get("/{doc_id}/download")
async def download_document(
    doc_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    viewer: User = Depends(get_current_user),
):
    doc = await db.get(HrDocument, doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    if viewer.id != doc.user_id and not _is_hr(viewer):
        raise HTTPException(status_code=403, detail="Not allowed")
    return FileResponse(
        absolute_path(doc.file_path),
        media_type=doc.content_type or "application/octet-stream",
        filename=doc.title,
    )


@router.delete("/{doc_id}", status_code=204)
async def delete_document(
    doc_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    viewer: User = Depends(get_current_user),
):
    doc = await db.get(HrDocument, doc_id)
    if not doc:
        return
    if not _is_hr(viewer):
        raise HTTPException(status_code=403, detail="Only HR can delete documents")
    await db.delete(doc)
    await db.commit()


@router.get("/expiring", response_model=list[HrDocumentOut])
async def expiring(
    days: int = 60,
    db: AsyncSession = Depends(get_db),
    viewer: User = Depends(get_current_user),
):
    """Documents that have expired or expire within the window (HR oversight)."""
    if not _is_hr(viewer):
        raise HTTPException(status_code=403, detail="Not allowed")
    horizon = date.today() + timedelta(days=max(days, 0))
    docs = (
        await db.execute(
            select(HrDocument)
            .where(HrDocument.expiry_date.is_not(None), HrDocument.expiry_date <= horizon)
            .order_by(HrDocument.expiry_date)
        )
    ).scalars().all()
    names = await _names(db, {d.user_id for d in docs})
    return [_serialize(d, names) for d in docs]


@router.post("/expiring/notify")
async def notify_expiring(
    days: int = 60,
    db: AsyncSession = Depends(get_db),
    viewer: User = Depends(get_current_user),
):
    """Remind admins/HR about documents expiring soon (deduped per doc+date)."""
    if not _is_hr(viewer):
        raise HTTPException(status_code=403, detail="Not allowed")
    horizon = date.today() + timedelta(days=max(days, 0))
    docs = (
        await db.execute(
            select(HrDocument).where(
                HrDocument.expiry_date.is_not(None), HrDocument.expiry_date <= horizon
            )
        )
    ).scalars().all()
    if not docs:
        return {"reminders_sent": 0, "candidates": 0}
    names = await _names(db, {d.user_id for d in docs})
    recipients = (
        await db.execute(
            select(User.id).where(
                (User.is_admin.is_(True)) | (User.role == "manager"),
                User.status == "active",
            )
        )
    ).scalars().all()
    sent = 0
    for doc in docs:
        who = names.get(doc.user_id) or "an employee"
        for rid in recipients:
            n = await notify_user(
                db,
                user_id=rid,
                title=f"Document expiring: {doc.title}",
                body=f"{doc.title} for {who} expires on {doc.expiry_date.isoformat()}.",
                link="/people-ops",
                category="warning",
                dedup_key=f"hrdoc-expiry:{doc.id}:{doc.expiry_date.isoformat()}:{rid}",
            )
            if n:
                sent += 1
    await db.commit()
    return {"reminders_sent": sent, "candidates": len(docs)}


async def _names(db: AsyncSession, ids: set) -> dict:
    labels = await user_labels(db, ids)
    return {uid: (lab or {}).get("name") for uid, lab in labels.items()}


# ---- E-signatures --------------------------------------------------------
@router.post("/{doc_id}/signature-requests", response_model=SignatureRequestOut, status_code=201)
async def request_signature(
    doc_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    viewer: User = Depends(get_current_user),
):
    """Ask the document's employee to e-sign it (HR only)."""
    if not _is_hr(viewer):
        raise HTTPException(status_code=403, detail="Only HR can request signatures")
    doc = await db.get(HrDocument, doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    existing = (
        await db.execute(
            select(SignatureRequest).where(
                SignatureRequest.document_id == doc_id,
                SignatureRequest.status == "pending",
            )
        )
    ).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=409, detail="A signature is already pending")
    req = SignatureRequest(document_id=doc_id, user_id=doc.user_id, requested_by_id=viewer.id)
    db.add(req)
    await notify_user(
        db,
        user_id=doc.user_id,
        title="Document needs your signature",
        body=f"Please review and sign “{doc.title}”.",
        link="/profile",
        category="warning",
    )
    record(
        db, user=viewer, action="created", entity_type="user", entity_id=doc.user_id,
        summary=f"Requested signature on {doc.title}",
    )
    await db.commit()
    await db.refresh(req)
    out = SignatureRequestOut.model_validate(req)
    out.document_title = doc.title
    return out


@router.get("/signatures/mine", response_model=list[SignatureRequestOut])
async def my_signature_requests(
    pending_only: bool = False,
    db: AsyncSession = Depends(get_db),
    viewer: User = Depends(get_current_user),
):
    stmt = (
        select(SignatureRequest)
        .where(SignatureRequest.user_id == viewer.id)
        .order_by(SignatureRequest.created_at.desc())
    )
    if pending_only:
        stmt = stmt.where(SignatureRequest.status == "pending")
    reqs = (await db.execute(stmt)).scalars().all()
    titles = {
        d.id: d.title
        for d in (
            await db.execute(
                select(HrDocument).where(HrDocument.id.in_([r.document_id for r in reqs]))
            )
        ).scalars().all()
    } if reqs else {}
    out = []
    for r in reqs:
        item = SignatureRequestOut.model_validate(r)
        item.document_title = titles.get(r.document_id)
        out.append(item)
    return out


@router.post("/signatures/{req_id}/sign", response_model=SignatureRequestOut)
async def sign_document(
    req_id: uuid.UUID,
    payload: SignIn,
    request: Request,
    db: AsyncSession = Depends(get_db),
    viewer: User = Depends(get_current_user),
):
    req = await db.get(SignatureRequest, req_id)
    if not req:
        raise HTTPException(status_code=404, detail="Request not found")
    if req.user_id != viewer.id:
        raise HTTPException(status_code=403, detail="Only the named signer can sign")
    if req.status != "pending":
        raise HTTPException(status_code=409, detail="Already actioned")
    if not payload.consent or not (payload.typed_name or "").strip():
        raise HTTPException(status_code=422, detail="Typed name and consent are required")
    req.status = "signed"
    req.typed_name = payload.typed_name.strip()
    req.signed_at = date.today()
    req.audit_ip = request.client.host if request.client else None
    req.audit_agent = request.headers.get("user-agent", "")[:512]
    doc = await db.get(HrDocument, req.document_id)
    record(
        db, user=viewer, action="updated", entity_type="user", entity_id=viewer.id,
        summary=f"Signed document {doc.title if doc else ''}",
    )
    if doc and doc.uploaded_by_id:
        await notify_user(
            db, user_id=doc.uploaded_by_id,
            title="Document signed",
            body=f"{viewer.display_name or viewer.email} signed “{doc.title}”.",
            link="/profile", category="info",
        )
    await db.commit()
    await db.refresh(req)
    out = SignatureRequestOut.model_validate(req)
    out.document_title = doc.title if doc else None
    return out


@router.get("/{doc_id}/signatures", response_model=list[SignatureRequestOut])
async def document_signatures(
    doc_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    viewer: User = Depends(get_current_user),
):
    doc = await db.get(HrDocument, doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    if viewer.id != doc.user_id and not _is_hr(viewer):
        raise HTTPException(status_code=403, detail="Not allowed")
    reqs = (
        await db.execute(
            select(SignatureRequest)
            .where(SignatureRequest.document_id == doc_id)
            .order_by(SignatureRequest.created_at.desc())
        )
    ).scalars().all()
    names = await user_labels(db, {r.user_id for r in reqs})
    out = []
    for r in reqs:
        item = SignatureRequestOut.model_validate(r)
        item.document_title = doc.title
        item.user_name = (names.get(r.user_id) or {}).get("name")
        out.append(item)
    return out
