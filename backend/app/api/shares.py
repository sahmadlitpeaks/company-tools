import uuid

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth.deps import get_current_user
from app.core.database import get_db
from app.models.asset import Asset
from app.models.product import Brochure, Product
from app.models.shortlink import LinkClick
from app.models.user import User
from app.schemas.common import (
    SearchHit,
    SearchResults,
    SharedDocOut,
)
from app.services import sharing
from app.services.qrcodes import generate_qr_png

router = APIRouter(tags=["shares"])


async def _last_opened(db: AsyncSession, link_ids: list[uuid.UUID]) -> dict:
    """Map short_link_id -> most recent open timestamp."""
    if not link_ids:
        return {}
    rows = (
        await db.execute(
            select(LinkClick.link_id, func.max(LinkClick.created_at))
            .where(LinkClick.link_id.in_(link_ids))
            .group_by(LinkClick.link_id)
        )
    ).all()
    return {lid: ts for lid, ts in rows}


@router.get("/shares", response_model=list[SharedDocOut])
async def list_shares(
    db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)
):
    """Everything currently shared with clients, with open/download analytics."""
    brochures = (
        await db.execute(
            select(Brochure)
            .where(Brochure.is_public.is_(True))
            .options(selectinload(Brochure.short_link))
        )
    ).scalars().all()
    assets = (
        await db.execute(
            select(Asset)
            .where(Asset.is_public.is_(True))
            .options(selectinload(Asset.short_link))
        )
    ).scalars().all()

    link_ids = [
        d.short_link.id
        for d in (*brochures, *assets)
        if d.short_link is not None
    ]
    last = await _last_opened(db, link_ids)

    out: list[SharedDocOut] = []
    for b in brochures:
        link = b.short_link
        if not link:
            continue
        out.append(
            SharedDocOut(
                kind="brochure",
                id=b.id,
                title=b.title,
                share_code=link.code,
                share_url=sharing.share_url(link.code),
                public_url=f"/b/{b.id}",
                opens=link.click_count,
                downloads=b.download_count,
                last_opened=last.get(link.id),
                expires_at=link.expires_at,
                require_lead=link.require_lead,
                has_passcode=bool(link.passcode_hash),
                created_at=b.created_at,
            )
        )
    for a in assets:
        link = a.short_link
        if not link:
            continue
        out.append(
            SharedDocOut(
                kind="asset",
                id=a.id,
                title=a.name,
                share_code=link.code,
                share_url=sharing.share_url(link.code),
                public_url=f"/a/{a.id}",
                opens=link.click_count,
                downloads=a.download_count,
                last_opened=last.get(link.id),
                expires_at=link.expires_at,
                require_lead=link.require_lead,
                has_passcode=bool(link.passcode_hash),
                created_at=a.created_at,
            )
        )
    out.sort(key=lambda r: (r.last_opened is None, r.last_opened or r.created_at), reverse=True)
    return out


@router.get("/search", response_model=SearchResults)
async def global_search(
    q: str = Query(..., min_length=1),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Cross-library search across brochures, marketing assets and products."""
    like = f"%{q.strip()}%"
    hits: list[SearchHit] = []

    for b in (
        await db.execute(
            select(Brochure).where(Brochure.title.ilike(like)).limit(10)
        )
    ).scalars().all():
        hits.append(
            SearchHit(
                kind="brochure",
                id=b.id,
                title=b.title,
                subtitle="Brochure",
                href="/products",
            )
        )
    for a in (
        await db.execute(select(Asset).where(Asset.name.ilike(like)).limit(10))
    ).scalars().all():
        hits.append(
            SearchHit(
                kind="asset",
                id=a.id,
                title=a.name,
                subtitle="Marketing asset",
                href="/marketing-assets",
            )
        )
    for p in (
        await db.execute(select(Product).where(Product.name.ilike(like)).limit(10))
    ).scalars().all():
        hits.append(
            SearchHit(
                kind="product",
                id=p.id,
                title=p.name,
                subtitle=p.sku or "Product",
                href="/products",
            )
        )
    return SearchResults(query=q, hits=hits)


# Public, no-auth QR renderer — used to show a scannable code for any share URL.
public_router = APIRouter(prefix="/public", tags=["shares"])


@public_router.get("/qr.png")
async def public_qr(
    data: str = Query(..., min_length=1),
    fill_color: str = "#0b5cab",
    back_color: str = "#ffffff",
):
    png = generate_qr_png(data, fill_color=fill_color, back_color=back_color)
    return Response(content=png, media_type="image/png")
