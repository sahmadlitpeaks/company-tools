import uuid

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from fastapi import Request
from fastapi.responses import RedirectResponse

from app.auth.deps import get_current_user
from app.core.config import settings
from app.core.database import get_db
from app.models.qrcode import QRCode
from app.models.user import User
from app.schemas.common import QRCodeCreate, QRCodeOut, QRCodeUpdate
from app.services.activity import record
from app.services.qrcodes import generate_qr_png

router = APIRouter(prefix="/qrcodes", tags=["qr-codes"])


def _encoded_value(qr: QRCode) -> str:
    """What the rendered QR encodes: a tracked redirect when dynamic."""
    if qr.dynamic:
        return f"{settings.PUBLIC_BASE_URL}/q/{qr.id}"
    return qr.target_url


@router.get("", response_model=list[QRCodeOut])
async def list_qrcodes(
    db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)
):
    return (
        await db.execute(select(QRCode).order_by(QRCode.created_at.desc()))
    ).scalars().all()


@router.post("", response_model=QRCodeOut, status_code=201)
async def create_qrcode(
    payload: QRCodeCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    qr = QRCode(created_by_id=user.id, **payload.model_dump())
    db.add(qr)
    record(
        db,
        user=user,
        action="created",
        entity_type="qrcode",
        entity_id=qr.id,
        summary=f"Created QR code “{qr.label}”",
    )
    await db.commit()
    await db.refresh(qr)
    return qr


@router.get("/{qr_id}/image.png")
async def qr_image(
    qr_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    qr = await db.get(QRCode, qr_id)
    if not qr:
        raise HTTPException(status_code=404, detail="QR code not found")
    png = generate_qr_png(
        _encoded_value(qr), fill_color=qr.fill_color, back_color=qr.back_color
    )
    return Response(content=png, media_type="image/png")


@router.patch("/{qr_id}", response_model=QRCodeOut)
async def update_qrcode(
    qr_id: uuid.UUID,
    payload: QRCodeUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    qr = await db.get(QRCode, qr_id)
    if not qr:
        raise HTTPException(status_code=404, detail="QR code not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(qr, field, value)
    await db.commit()
    await db.refresh(qr)
    return qr


@router.delete("/{qr_id}", status_code=204)
async def delete_qrcode(
    qr_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    qr = await db.get(QRCode, qr_id)
    if not qr:
        raise HTTPException(status_code=404, detail="QR code not found")
    await db.delete(qr)
    await db.commit()


@router.get("/preview.png")
async def qr_preview(
    data: str,
    fill_color: str = "#000000",
    back_color: str = "#ffffff",
    _: User = Depends(get_current_user),
):
    """Render an ad-hoc QR without persisting it (live preview in the UI)."""
    png = generate_qr_png(data, fill_color=fill_color, back_color=back_color)
    return Response(content=png, media_type="image/png")


# Public scan redirect for dynamic QR codes. Served at /q/{qr_id}.
async def scan_redirect(qr_id: uuid.UUID, request: Request, db: AsyncSession):
    qr = await db.get(QRCode, qr_id)
    if not qr:
        raise HTTPException(status_code=404, detail="QR code not found")
    qr.scan_count += 1
    await db.commit()
    return RedirectResponse(qr.target_url, status_code=302)
