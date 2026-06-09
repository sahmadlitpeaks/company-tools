"""Public document sharing: the short link that backs a share plus the access
controls (expiry, passcode, lead-capture) layered on top of it.

A share is just a :class:`ShortLink` whose target is the public viewer
(/b/:id or /a/:id). Reusing ShortLink means shares show up in the shortener's
click analytics and re-sharing keeps a stable code (and therefore stable QR
codes / printed URLs).
"""
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.urls import public_base_url
from app.models.shortlink import LinkClick, ShortLink
from app.models.user import User
from app.services import crypto
from app.services.utils import random_code


async def _unique_code(db: AsyncSession) -> str:
    code = random_code()
    while (
        await db.execute(select(ShortLink).where(ShortLink.code == code))
    ).scalar_one_or_none() is not None:
        code = random_code()
    return code


def _apply_settings(link: ShortLink, settings_in) -> None:
    """Apply an optional ShareSettings payload onto the backing link."""
    if settings_in is None:
        return
    if settings_in.expires_in_days is not None:
        link.expires_at = (
            datetime.now(timezone.utc)
            + timedelta(days=settings_in.expires_in_days)
            if settings_in.expires_in_days > 0
            else None
        )
    if settings_in.passcode is not None:
        link.passcode_hash = (
            crypto.hash_password(settings_in.passcode)
            if settings_in.passcode
            else None
        )
    link.require_lead = bool(settings_in.require_lead)


async def get_or_create_share_link(
    db: AsyncSession,
    *,
    existing: ShortLink | None,
    target_url: str,
    title: str,
    user: User,
    share_settings=None,
) -> ShortLink:
    """Reuse an existing link (keeping its code) or mint a new one, then apply
    any access-control settings. The caller is responsible for committing."""
    if existing is not None:
        existing.is_active = True
        existing.target_url = target_url
        existing.title = title
        _apply_settings(existing, share_settings)
        return existing
    link = ShortLink(
        code=await _unique_code(db),
        target_url=target_url,
        title=title,
        created_by_id=user.id,
    )
    _apply_settings(link, share_settings)
    db.add(link)
    return link


def share_url(code: str) -> str:
    return f"{public_base_url()}/s/{code}"


def enforce_access(
    link: ShortLink | None,
    *,
    passcode: str | None,
    lead_ok: bool,
) -> None:
    """Validate a public download attempt against the share's controls.

    Raises HTTPException (404 gone / 401 passcode / 403 lead) on failure.
    """
    now = datetime.now(timezone.utc)
    if link is not None and link.is_expired(now):
        raise HTTPException(status_code=410, detail="This link has expired")
    if link is not None and link.passcode_hash:
        if not passcode or not crypto.verify_password(passcode, link.passcode_hash):
            raise HTTPException(status_code=401, detail="A passcode is required")
    if link is not None and link.require_lead and not lead_ok:
        raise HTTPException(status_code=403, detail="Please share your details first")


async def record_open(
    db: AsyncSession, link: ShortLink | None, *, ip: str | None, user_agent: str | None
) -> None:
    """Count a flipbook open against the backing link's analytics."""
    if link is None:
        return
    link.click_count += 1
    db.add(LinkClick(link_id=link.id, ip_address=ip, user_agent=user_agent))


async def default_brand_brief(db: AsyncSession):
    """Brand identity used to skin public viewers (the default brand)."""
    from app.models.brand import Brand
    from app.schemas.common import BrandBrief

    brand = (
        await db.execute(
            select(Brand)
            .where(Brand.is_active.is_(True))
            .order_by(Brand.is_default.desc(), Brand.created_at.asc())
        )
    ).scalars().first()
    if not brand:
        return None
    return BrandBrief(
        name=brand.name,
        logo_url=brand.logo_url,
        primary_color=brand.primary_color or "#0b5cab",
        website=brand.website,
        tagline=brand.tagline,
    )


async def lead_is_valid(
    db: AsyncSession, *, origin_type: str, origin_id: str, lead_id
) -> bool:
    """True if `lead_id` is a lead captured for this exact document."""
    if lead_id is None:
        return False
    from app.models.crm import CrmLead

    lead = await db.get(CrmLead, lead_id)
    return bool(
        lead and lead.origin_type == origin_type and lead.origin_id == origin_id
    )
