import uuid

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.core.database import get_db
from app.models.qrcode import QRCode
from app.models.user import User
from app.schemas.common import QRCodeCreate, QRCodeOut
from app.services.qrcodes import generate_qr_png

router = APIRouter(prefix="/qrcodes", tags=["qr-codes"])


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
    png = generate_qr_png(qr.target_url, fill_color=qr.fill_color, back_color=qr.back_color)
    return Response(content=png, media_type="image/png")


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
