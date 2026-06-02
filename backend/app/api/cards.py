import uuid

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.core.config import settings
from app.core.database import get_db
from app.models.card import CardScan, DigitalCard, Lead
from app.models.user import User
from app.schemas.card import (
    CardCreate,
    CardOut,
    CardPublic,
    CardUpdate,
    LeadCreate,
    LeadOut,
)
from app.services.qrcodes import generate_qr_png
from app.services.utils import slugify

router = APIRouter(prefix="/cards", tags=["digital-cards"])


async def _unique_slug(db: AsyncSession, base: str) -> str:
    base = slugify(base)
    slug = base
    i = 1
    while (
        await db.execute(select(DigitalCard).where(DigitalCard.slug == slug))
    ).scalar_one_or_none() is not None:
        i += 1
        slug = f"{base}-{i}"
    return slug


def _card_url(slug: str) -> str:
    return f"{settings.PUBLIC_BASE_URL}/c/{slug}"


@router.get("", response_model=list[CardOut])
async def my_cards(
    db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)
):
    result = await db.execute(
        select(DigitalCard)
        .where(DigitalCard.owner_id == user.id)
        .order_by(DigitalCard.created_at.desc())
    )
    return result.scalars().all()


@router.post("", response_model=CardOut, status_code=201)
async def create_card(
    payload: CardCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    data = payload.model_dump(exclude={"slug"})
    slug = await _unique_slug(db, payload.slug or payload.full_name)
    card = DigitalCard(owner_id=user.id, slug=slug, **data)
    db.add(card)
    await db.commit()
    await db.refresh(card)
    return card


@router.get("/{card_id}", response_model=CardOut)
async def get_card(
    card_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    card = await db.get(DigitalCard, card_id)
    if not card or card.owner_id != user.id:
        raise HTTPException(status_code=404, detail="Card not found")
    return card


@router.patch("/{card_id}", response_model=CardOut)
async def update_card(
    card_id: uuid.UUID,
    payload: CardUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    card = await db.get(DigitalCard, card_id)
    if not card or card.owner_id != user.id:
        raise HTTPException(status_code=404, detail="Card not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(card, field, value)
    await db.commit()
    await db.refresh(card)
    return card


@router.delete("/{card_id}", status_code=204)
async def delete_card(
    card_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    card = await db.get(DigitalCard, card_id)
    if not card or card.owner_id != user.id:
        raise HTTPException(status_code=404, detail="Card not found")
    await db.delete(card)
    await db.commit()


@router.get("/{card_id}/qr.png")
async def card_qr(
    card_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    card = await db.get(DigitalCard, card_id)
    if not card or card.owner_id != user.id:
        raise HTTPException(status_code=404, detail="Card not found")
    png = generate_qr_png(_card_url(card.slug), fill_color=card.accent_color)
    return Response(content=png, media_type="image/png")


@router.get("/{card_id}/leads", response_model=list[LeadOut])
async def card_leads(
    card_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    card = await db.get(DigitalCard, card_id)
    if not card or card.owner_id != user.id:
        raise HTTPException(status_code=404, detail="Card not found")
    result = await db.execute(
        select(Lead).where(Lead.card_id == card_id).order_by(Lead.created_at.desc())
    )
    return result.scalars().all()


# ---- Public (unauthenticated) endpoints ----
public_router = APIRouter(prefix="/public/cards", tags=["digital-cards-public"])


async def _get_active_card(db: AsyncSession, slug: str) -> DigitalCard:
    card = (
        await db.execute(
            select(DigitalCard).where(
                DigitalCard.slug == slug, DigitalCard.is_active.is_(True)
            )
        )
    ).scalar_one_or_none()
    if not card:
        raise HTTPException(status_code=404, detail="Card not found")
    return card


@public_router.get("/{slug}", response_model=CardPublic)
async def public_card(
    slug: str, request: Request, db: AsyncSession = Depends(get_db)
):
    card = await _get_active_card(db, slug)
    db.add(
        CardScan(
            card_id=card.id,
            ip_address=request.client.host if request.client else None,
            user_agent=request.headers.get("user-agent"),
            referer=request.headers.get("referer"),
        )
    )
    await db.commit()
    return card


@public_router.post("/{slug}/leads", response_model=LeadOut, status_code=201)
async def submit_lead(
    slug: str, payload: LeadCreate, db: AsyncSession = Depends(get_db)
):
    card = await _get_active_card(db, slug)
    if not card.lead_capture_enabled:
        raise HTTPException(status_code=403, detail="Lead capture disabled")
    lead = Lead(card_id=card.id, **payload.model_dump())
    db.add(lead)
    await db.commit()
    await db.refresh(lead)
    return lead
