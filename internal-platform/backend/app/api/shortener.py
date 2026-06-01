import uuid

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.core.config import settings
from app.core.database import get_db
from app.models.shortlink import LinkClick, ShortLink
from app.models.user import User
from app.schemas.common import ShortLinkCreate, ShortLinkOut
from app.services.utils import random_code

router = APIRouter(prefix="/short-links", tags=["url-shortener"])


async def _unique_code(db: AsyncSession, preferred: str | None) -> str:
    from app.services.utils import slugify

    code = slugify(preferred) if preferred else random_code()
    while (
        await db.execute(select(ShortLink).where(ShortLink.code == code))
    ).scalar_one_or_none() is not None:
        code = random_code()
    return code


@router.get("", response_model=list[ShortLinkOut])
async def list_links(
    db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)
):
    return (
        await db.execute(select(ShortLink).order_by(ShortLink.created_at.desc()))
    ).scalars().all()


@router.post("", response_model=ShortLinkOut, status_code=201)
async def create_link(
    payload: ShortLinkCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    code = await _unique_code(db, payload.code)
    link = ShortLink(
        code=code,
        target_url=payload.target_url,
        title=payload.title,
        campaign=payload.campaign,
        created_by_id=user.id,
    )
    db.add(link)
    await db.commit()
    await db.refresh(link)
    return link


@router.delete("/{link_id}", status_code=204)
async def delete_link(
    link_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    link = await db.get(ShortLink, link_id)
    if not link:
        raise HTTPException(status_code=404, detail="Link not found")
    await db.delete(link)
    await db.commit()


# Public redirect endpoint (feature #8). Served at /s/{code}.
async def redirect_short_link(code: str, request: Request, db: AsyncSession):
    link = (
        await db.execute(
            select(ShortLink).where(
                ShortLink.code == code, ShortLink.is_active.is_(True)
            )
        )
    ).scalar_one_or_none()
    if not link:
        raise HTTPException(status_code=404, detail="Link not found")

    link.click_count += 1
    db.add(
        LinkClick(
            link_id=link.id,
            ip_address=request.client.host if request.client else None,
            user_agent=request.headers.get("user-agent"),
            referer=request.headers.get("referer"),
        )
    )
    await db.commit()
    return RedirectResponse(link.target_url, status_code=302)
