import uuid
from datetime import datetime, timedelta, timezone

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Response,
    UploadFile,
)
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from app.auth.deps import get_current_user
from app.core.config import settings
from app.core.database import get_db
from app.models.transfer import SecureTransfer
from app.models.user import User
from app.schemas.transfer import (
    TransferCreated,
    TransferDownloadRequest,
    TransferMeta,
    TransferOut,
)
from app.services import crypto
from app.services.email import send_email, transfer_email_html
from app.services.storage import absolute_path, ensure_media_root

router = APIRouter(prefix="/transfers", tags=["secure-transfers"])

MAX_TRANSFER_BYTES = 100 * 1024 * 1024  # 100 MB


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _delete_payload(t: SecureTransfer, consumed: bool = True) -> None:
    """Remove the ciphertext from disk and mark the record spent."""
    if t.file_path:
        path = absolute_path(t.file_path)
        try:
            path.unlink(missing_ok=True)
        except OSError:
            pass
    t.file_path = None
    if consumed:
        t.is_consumed = True
        t.consumed_at = _now()


def _is_expired(t: SecureTransfer) -> bool:
    if t.expires_at is None:
        return False
    exp = t.expires_at
    if exp.tzinfo is None:  # SQLite returns naive datetimes; assume UTC
        exp = exp.replace(tzinfo=timezone.utc)
    return _now() >= exp


@router.get("", response_model=list[TransferOut])
async def my_transfers(
    db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)
):
    rows = (
        await db.execute(
            select(SecureTransfer)
            .where(SecureTransfer.sender_id == user.id)
            .order_by(SecureTransfer.created_at.desc())
        )
    ).scalars().all()
    return rows


@router.post("", response_model=TransferCreated, status_code=201)
async def create_transfer(
    file: UploadFile = File(...),
    recipient_email: str = Form(...),
    message: str | None = Form(None),
    password: str | None = Form(None),
    one_time: bool = Form(True),
    expires_in_hours: int = Form(72),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    data = await file.read()
    if len(data) == 0:
        raise HTTPException(status_code=400, detail="Empty file")
    if len(data) > MAX_TRANSFER_BYTES:
        raise HTTPException(status_code=413, detail="File too large (max 100 MB)")

    token = crypto.new_token()
    salt = crypto.new_salt()
    ciphertext = crypto.encrypt_bytes(data, token, salt, password or None)

    ensure_media_root()
    rel_path = f"transfers/{uuid.uuid4().hex}.enc"
    dest = absolute_path(rel_path)
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(ciphertext)

    expires_at = (
        _now() + timedelta(hours=expires_in_hours) if expires_in_hours > 0 else None
    )

    transfer = SecureTransfer(
        token_hash=crypto.token_hash(token),
        salt=salt,
        filename=file.filename or "file",
        content_type=file.content_type,
        size_bytes=len(data),
        file_path=rel_path,
        sender_id=user.id,
        recipient_email=recipient_email,
        message=message,
        password_hash=crypto.hash_password(password) if password else None,
        has_password=bool(password),
        one_time=one_time,
        max_downloads=1 if one_time else 1_000_000,
        expires_at=expires_at,
    )
    db.add(transfer)
    await db.flush()

    share_url = f"{settings.FRONTEND_BASE_URL}/t/{token}"

    # Best-effort email to the recipient (no-op if SMTP not configured).
    try:
        sent = await run_in_threadpool(
            send_email,
            recipient_email,
            "A secure file has been shared with you",
            transfer_email_html(user.display_name or user.email, message, share_url),
        )
        transfer.email_sent = sent
    except Exception:
        transfer.email_sent = False

    await db.commit()
    await db.refresh(transfer)

    return TransferCreated(
        **TransferOut.model_validate(transfer).model_dump(), share_url=share_url
    )


@router.delete("/{transfer_id}", status_code=204)
async def revoke_transfer(
    transfer_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    t = await db.get(SecureTransfer, transfer_id)
    if not t or t.sender_id != user.id:
        raise HTTPException(status_code=404, detail="Transfer not found")
    _delete_payload(t, consumed=True)
    await db.commit()


# ---- Public recipient endpoints ----
public_router = APIRouter(prefix="/public/transfers", tags=["secure-transfers"])


async def _lookup(db: AsyncSession, token: str) -> SecureTransfer:
    t = (
        await db.execute(
            select(SecureTransfer).where(
                SecureTransfer.token_hash == crypto.token_hash(token)
            )
        )
    ).scalar_one_or_none()
    if not t:
        raise HTTPException(status_code=404, detail="Transfer not found")
    return t


def _status(t: SecureTransfer) -> str:
    if t.is_consumed or not t.file_path:
        return "consumed"
    if _is_expired(t):
        return "expired"
    return "available"


@public_router.get("/{token}/meta", response_model=TransferMeta)
async def transfer_meta(token: str, db: AsyncSession = Depends(get_db)):
    t = await _lookup(db, token)

    # Lazily purge expired payloads on access.
    if _is_expired(t) and t.file_path:
        _delete_payload(t, consumed=False)
        await db.commit()

    sender_name = None
    if t.sender_id:
        sender = await db.get(User, t.sender_id)
        sender_name = sender.display_name or sender.email if sender else None

    return TransferMeta(
        filename=t.filename,
        size_bytes=t.size_bytes,
        requires_password=t.has_password,
        sender_name=sender_name,
        message=t.message,
        expires_at=t.expires_at,
        status=_status(t),
    )


@public_router.post("/{token}/download")
async def download_transfer(
    token: str,
    payload: TransferDownloadRequest,
    db: AsyncSession = Depends(get_db),
):
    t = await _lookup(db, token)

    if t.is_consumed or not t.file_path:
        raise HTTPException(status_code=410, detail="This file is no longer available")
    if _is_expired(t):
        _delete_payload(t, consumed=False)
        await db.commit()
        raise HTTPException(status_code=410, detail="This link has expired")

    if t.has_password:
        if not payload.password:
            raise HTTPException(status_code=401, detail="Password required")
        if not crypto.verify_password(payload.password, t.password_hash or ""):
            raise HTTPException(status_code=403, detail="Incorrect password")

    blob = absolute_path(t.file_path).read_bytes()
    plaintext = crypto.decrypt_bytes(blob, token, t.salt, payload.password or None)
    if plaintext is None:
        raise HTTPException(status_code=403, detail="Unable to decrypt file")

    t.download_count += 1
    if t.one_time or t.download_count >= t.max_downloads:
        _delete_payload(t, consumed=True)
    await db.commit()

    filename = t.filename.replace('"', "")
    return Response(
        content=plaintext,
        media_type=t.content_type or "application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
