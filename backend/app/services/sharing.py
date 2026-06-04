"""Create or update the short link that backs a public document share.

Used by the brochure and marketing-asset share endpoints so that "make public"
produces a short, client-friendly URL (/s/{code}) that redirects to the public
flipbook viewer. Reusing :class:`ShortLink` means shares also show up in the URL
shortener's click analytics.
"""
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.shortlink import ShortLink
from app.models.user import User
from app.services.utils import random_code


async def _unique_code(db: AsyncSession) -> str:
    code = random_code()
    while (
        await db.execute(select(ShortLink).where(ShortLink.code == code))
    ).scalar_one_or_none() is not None:
        code = random_code()
    return code


async def get_or_create_share_link(
    db: AsyncSession,
    *,
    existing: ShortLink | None,
    target_url: str,
    title: str,
    user: User,
) -> ShortLink:
    """Reuse an existing link (keeping its code so old URLs keep working) or mint
    a new one. The caller is responsible for committing."""
    if existing is not None:
        existing.is_active = True
        existing.target_url = target_url
        existing.title = title
        return existing
    link = ShortLink(
        code=await _unique_code(db),
        target_url=target_url,
        title=title,
        created_by_id=user.id,
    )
    db.add(link)
    return link
