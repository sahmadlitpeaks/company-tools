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
    for field, value in payload.model_dump(exclude_unset=True).items():
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
    await db.commit()
    await db.refresh(lead)
    return lead
