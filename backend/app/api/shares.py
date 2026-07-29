import uuid

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth.deps import get_current_user
from app.core.database import get_db
from app.models.asset import Asset
from app.models.product import Brochure, Product
from app.models.shortlink import LinkClick
from app.models.user import User
from app.models.workspace import WorkspaceItem
from app.models.workplace import KnowledgeArticle, Task, Ticket
from app.models.operations import Idea, LostFoundReport
from app.schemas.common import (
    SearchHit,
    SearchResults,
    SharedDocOut,
)
from app.services import sharing
from app.services.qrcodes import generate_qr_png

router = APIRouter(tags=["shares"])
search_router = APIRouter(tags=["search"])


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


@search_router.get("/search", response_model=SearchResults)
async def global_search(
    q: str = Query(..., min_length=1),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Permission-aware search across people, work and company content."""
    like = f"%{q.strip()}%"
    hits: list[SearchHit] = []
    permissions = set(user.effective_permissions)

    if "directory" in permissions:
        people = (
            await db.execute(
                select(User)
                .where(
                    User.status == "active",
                    or_(
                        User.display_name.ilike(like),
                        User.email.ilike(like),
                        User.job_title.ilike(like),
                        User.department.ilike(like),
                    ),
                )
                .limit(10)
            )
        ).scalars().all()
        hits.extend(
            SearchHit(
                kind="person",
                id=person.id,
                title=person.display_name or person.email or "Employee",
                subtitle=person.job_title or person.department or "Employee",
                href=f"/people/{person.id}",
            )
            for person in people
        )

    if "tasks" in permissions:
        tasks = (
            await db.execute(
                select(Task)
                .where(or_(Task.title.ilike(like), Task.description.ilike(like)))
                .limit(10)
            )
        ).scalars().all()
        hits.extend(
            SearchHit(
                kind="task", id=task.id, title=task.title,
                subtitle=f"Task · {task.status.replace('_', ' ')}",
                href=f"/tasks?open={task.id}",
            )
            for task in tasks
        )

    if "service_desk" in permissions:
        tickets = (
            await db.execute(
                select(Ticket)
                .where(or_(Ticket.subject.ilike(like), Ticket.description.ilike(like)))
                .limit(10)
            )
        ).scalars().all()
        hits.extend(
            SearchHit(
                kind="ticket", id=ticket.id, title=ticket.subject,
                subtitle=f"Ticket #{ticket.number or '—'} · {ticket.status.replace('_', ' ')}",
                href=f"/service-desk?open={ticket.id}",
            )
            for ticket in tickets
        )

    if "knowledge" in permissions:
        articles = (
            await db.execute(
                select(KnowledgeArticle)
                .where(
                    KnowledgeArticle.is_published.is_(True),
                    or_(
                        KnowledgeArticle.title.ilike(like),
                        KnowledgeArticle.body.ilike(like),
                        KnowledgeArticle.category.ilike(like),
                    ),
                )
                .limit(10)
            )
        ).scalars().all()
        hits.extend(
            SearchHit(
                kind="knowledge", id=article.id, title=article.title,
                subtitle=article.category or "Knowledge article",
                href=f"/knowledge?open={article.id}",
            )
            for article in articles
        )

    if "workspace" in permissions:
        documents = (
            await db.execute(
                select(WorkspaceItem)
                .where(
                    or_(WorkspaceItem.owner_id == user.id, WorkspaceItem.shared.is_(True)),
                    or_(
                        WorkspaceItem.title.ilike(like),
                        WorkspaceItem.body.ilike(like),
                        WorkspaceItem.tags.ilike(like),
                    ),
                )
                .limit(10)
            )
        ).scalars().all()
        hits.extend(
            SearchHit(
                kind="document", id=document.id, title=document.title,
                subtitle=f"My Docs · {document.kind}",
                href=f"/my-docs?open={document.id}",
            )
            for document in documents
        )

    if "ideas" in permissions:
        ideas = (
            await db.execute(
                select(Idea).where(or_(Idea.title.ilike(like), Idea.description.ilike(like))).limit(10)
            )
        ).scalars().all()
        hits.extend(
            SearchHit(kind="idea", id=idea.id, title=idea.title, subtitle=f"{idea.kind.title()} · {idea.status.replace('_', ' ')}", href=f"/ideas?open={idea.id}")
            for idea in ideas
        )

    if "lost_found" in permissions:
        reports = (
            await db.execute(
                select(LostFoundReport).where(
                    or_(LostFoundReport.description.ilike(like), LostFoundReport.location.ilike(like))
                ).limit(10)
            )
        ).scalars().all()
        hits.extend(
            SearchHit(kind="lost_found", id=report.id, title=report.description[:120], subtitle=f"{report.kind.title()} · {report.location}", href=f"/lost-found?open={report.id}")
            for report in reports
        )

    if "products" in permissions:
        for b in (
            await db.execute(
                select(Brochure).where(Brochure.title.ilike(like)).limit(10)
            )
        ).scalars().all():
            hits.append(
                SearchHit(
                    kind="brochure", id=b.id, title=b.title, subtitle="Brochure",
                    href=f"/products?open={b.id}",
                )
            )
        for p in (
            await db.execute(select(Product).where(Product.name.ilike(like)).limit(10))
        ).scalars().all():
            hits.append(
                SearchHit(
                    kind="product", id=p.id, title=p.name,
                    subtitle=p.sku or "Product", href=f"/products?open={p.id}",
                )
            )

    if "marketing_assets" in permissions:
        for a in (
            await db.execute(select(Asset).where(Asset.name.ilike(like)).limit(10))
        ).scalars().all():
            hits.append(
                SearchHit(
                    kind="asset", id=a.id, title=a.name,
                    subtitle="Marketing asset", href=f"/marketing-assets?open={a.id}",
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
