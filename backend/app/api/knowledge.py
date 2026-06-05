import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import distinct, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.core.database import get_db
from app.models.user import User
from app.models.workplace import KnowledgeArticle
from app.schemas.workplace import (
    ArticleCreate,
    ArticleOut,
    ArticleSummary,
    ArticleUpdate,
)
from app.services.activity import record
from app.services.people import user_names

router = APIRouter(prefix="/knowledge", tags=["knowledge-base"])


@router.get("/categories", response_model=list[str])
async def list_categories(
    db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)
):
    rows = (
        await db.execute(
            select(distinct(KnowledgeArticle.category))
            .where(KnowledgeArticle.category.is_not(None))
            .order_by(KnowledgeArticle.category)
        )
    ).scalars().all()
    return [c for c in rows if c]


@router.get("", response_model=list[ArticleSummary])
async def list_articles(
    category: str | None = None,
    q: str | None = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    stmt = select(KnowledgeArticle).order_by(
        KnowledgeArticle.pinned.desc(), KnowledgeArticle.updated_at.desc()
    )
    # Non-managers only see published articles (drafts are author/admin only).
    if not (user.is_admin or user.role == "manager"):
        stmt = stmt.where(
            or_(
                KnowledgeArticle.is_published.is_(True),
                KnowledgeArticle.author_id == user.id,
            )
        )
    if category:
        stmt = stmt.where(KnowledgeArticle.category == category)
    if q:
        like = f"%{q}%"
        stmt = stmt.where(
            KnowledgeArticle.title.ilike(like) | KnowledgeArticle.body.ilike(like)
        )
    articles = (await db.execute(stmt)).scalars().all()
    names = await user_names(db, {a.author_id for a in articles})
    out = []
    for a in articles:
        s = ArticleSummary.model_validate(a)
        s.author_name = names.get(a.author_id) if a.author_id else None
        out.append(s)
    return out


@router.post("", response_model=ArticleOut, status_code=201)
async def create_article(
    payload: ArticleCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    article = KnowledgeArticle(**payload.model_dump(), author_id=user.id)
    db.add(article)
    record(
        db,
        user=user,
        action="created",
        entity_type="article",
        entity_id=article.id,
        summary=f"Wrote knowledge article '{article.title}'",
    )
    await db.commit()
    await db.refresh(article)
    return await _detail(db, article, user)


@router.get("/{article_id}", response_model=ArticleOut)
async def get_article(
    article_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    article = await db.get(KnowledgeArticle, article_id)
    if not article:
        raise HTTPException(status_code=404, detail="Article not found")
    if not article.is_published and not (
        user.is_admin or user.role == "manager" or article.author_id == user.id
    ):
        raise HTTPException(status_code=404, detail="Article not found")
    article.view_count += 1
    await db.commit()
    await db.refresh(article)
    return await _detail(db, article, user)


@router.patch("/{article_id}", response_model=ArticleOut)
async def update_article(
    article_id: uuid.UUID,
    payload: ArticleUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    article = await db.get(KnowledgeArticle, article_id)
    if not article:
        raise HTTPException(status_code=404, detail="Article not found")
    if not (user.is_admin or user.role == "manager" or article.author_id == user.id):
        raise HTTPException(status_code=403, detail="Not allowed")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(article, field, value)
    await db.commit()
    await db.refresh(article)
    return await _detail(db, article, user)


@router.delete("/{article_id}", status_code=204)
async def delete_article(
    article_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    article = await db.get(KnowledgeArticle, article_id)
    if not article:
        return
    if not (user.is_admin or user.role == "manager" or article.author_id == user.id):
        raise HTTPException(status_code=403, detail="Not allowed")
    await db.delete(article)
    await db.commit()


async def _detail(db: AsyncSession, article: KnowledgeArticle, user: User) -> ArticleOut:
    names = await user_names(db, {article.author_id})
    out = ArticleOut.model_validate(article)
    out.author_name = names.get(article.author_id) if article.author_id else None
    return out
