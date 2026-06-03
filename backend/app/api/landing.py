import json
import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.core.database import get_db
from app.models.landing import LandingLead, LandingPage
from app.models.user import User
from app.schemas.common import (
    LandingCreate,
    LandingLeadCreate,
    LandingLeadOut,
    LandingOut,
    LandingUpdate,
)
from app.services.utils import slugify

router = APIRouter(prefix="/landing-pages", tags=["landing-pages"])

# Default placeholder copy from the builder — a published page must not contain it.
PLACEHOLDERS = {
    "your headline goes here",
    "a short, compelling subheading for the campaign.",
    "section heading",
    "write a paragraph of supporting copy here to explain the offer.",
}


def _validate_publishable(blocks_json: str | None) -> list[str]:
    """Return a list of reasons the page can't be published (empty = OK)."""
    errors: list[str] = []
    try:
        blocks = json.loads(blocks_json) if blocks_json else []
    except (TypeError, ValueError):
        blocks = []
    if not isinstance(blocks, list):
        blocks = []

    content_blocks = [b for b in blocks if isinstance(b, dict) and b.get("type") != "spacer"]
    if not content_blocks:
        return ["Add some content blocks before publishing."]

    def is_placeholder(text: str | None) -> bool:
        return bool(text) and text.strip().lower() in PLACEHOLDERS

    has_headline = False
    has_media = False
    for b in blocks:
        if not isinstance(b, dict):
            continue
        t = b.get("type")
        for key in ("heading", "subheading", "text"):
            if is_placeholder(b.get(key)):
                errors.append(f"Replace the placeholder text in a {t} block.")
        if t in ("hero", "heading") and (b.get("heading") or b.get("text")):
            if not is_placeholder(b.get("heading") or b.get("text")):
                has_headline = True
        if t in ("hero", "cta"):
            url = (b.get("buttonUrl") or "").strip()
            if b.get("buttonText") and (not url or url == "#"):
                errors.append(f"Set a real button link on the {t} block (not '#').")
        if t == "image":
            if not (b.get("url") or "").strip():
                errors.append("Add an image URL to the image block (or remove it).")
            else:
                has_media = True
        if t == "hero":
            has_media = True

    if not has_headline:
        errors.append("Add a real headline (hero or heading).")
    if not has_media:
        errors.append("Add a hero or an image so the page has visible media.")

    # De-duplicate while preserving order.
    seen: set[str] = set()
    return [e for e in errors if not (e in seen or seen.add(e))]


async def _unique_slug(db: AsyncSession, base: str) -> str:
    base = slugify(base)
    slug = base
    i = 1
    while (
        await db.execute(select(LandingPage).where(LandingPage.slug == slug))
    ).scalar_one_or_none() is not None:
        i += 1
        slug = f"{base}-{i}"
    return slug


@router.get("", response_model=list[LandingOut])
async def list_pages(
    db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)
):
    return (
        await db.execute(select(LandingPage).order_by(LandingPage.created_at.desc()))
    ).scalars().all()


@router.post("", response_model=LandingOut, status_code=201)
async def create_page(
    payload: LandingCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    data = payload.model_dump(exclude={"slug"})
    if data.get("status") == "published":
        errors = _validate_publishable(data.get("blocks"))
        if errors:
            raise HTTPException(status_code=422, detail=" ".join(errors))
    slug = await _unique_slug(db, payload.slug or payload.title)
    page = LandingPage(slug=slug, created_by_id=user.id, **data)
    db.add(page)
    await db.commit()
    await db.refresh(page)
    return page


@router.get("/{page_id}", response_model=LandingOut)
async def get_page(
    page_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    page = await db.get(LandingPage, page_id)
    if not page:
        raise HTTPException(status_code=404, detail="Page not found")
    return page


@router.patch("/{page_id}", response_model=LandingOut)
async def update_page(
    page_id: uuid.UUID,
    payload: LandingUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    page = await db.get(LandingPage, page_id)
    if not page:
        raise HTTPException(status_code=404, detail="Page not found")
    data = payload.model_dump(exclude_unset=True)
    # Validate before publishing (use the incoming blocks if provided, else stored).
    if data.get("status") == "published":
        blocks = data.get("blocks", page.blocks)
        errors = _validate_publishable(blocks)
        if errors:
            raise HTTPException(status_code=422, detail=" ".join(errors))
    for field, value in data.items():
        setattr(page, field, value)
    await db.commit()
    await db.refresh(page)
    return page


@router.get("/{page_id}/leads", response_model=list[LandingLeadOut])
async def page_leads(
    page_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    page = await db.get(LandingPage, page_id)
    if not page:
        raise HTTPException(status_code=404, detail="Page not found")
    return (
        await db.execute(
            select(LandingLead)
            .where(LandingLead.page_id == page_id)
            .order_by(LandingLead.created_at.desc())
        )
    ).scalars().all()


@router.delete("/{page_id}", status_code=204)
async def delete_page(
    page_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    page = await db.get(LandingPage, page_id)
    if not page:
        raise HTTPException(status_code=404, detail="Page not found")
    await db.delete(page)
    await db.commit()


# Public read of a published page (feature #6).
public_router = APIRouter(prefix="/public/landing-pages", tags=["landing-pages"])


@public_router.get("/{slug}", response_model=LandingOut)
async def public_page(slug: str, db: AsyncSession = Depends(get_db)):
    page = (
        await db.execute(
            select(LandingPage).where(
                LandingPage.slug == slug, LandingPage.status == "published"
            )
        )
    ).scalar_one_or_none()
    if not page:
        raise HTTPException(status_code=404, detail="Page not found")
    page.view_count += 1
    await db.commit()
    return page


@public_router.post("/{slug}/leads", response_model=LandingLeadOut, status_code=201)
async def submit_landing_lead(
    slug: str, payload: LandingLeadCreate, db: AsyncSession = Depends(get_db)
):
    page = (
        await db.execute(
            select(LandingPage).where(
                LandingPage.slug == slug, LandingPage.status == "published"
            )
        )
    ).scalar_one_or_none()
    if not page:
        raise HTTPException(status_code=404, detail="Page not found")
    lead = LandingLead(page_id=page.id, **payload.model_dump())
    db.add(lead)
    await db.flush()
    from app.models.crm import CrmLead

    db.add(
        CrmLead(
            brand_id=page.brand_id,
            name=lead.name,
            email=lead.email,
            phone=lead.phone,
            notes=lead.message,
            source="landing",
            source_detail=page.title,
            status="new",
            origin_type="landing_lead",
            origin_id=str(lead.id),
        )
    )
    await db.commit()
    await db.refresh(lead)
    return lead
