import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.core.database import get_db
from app.models.user import User
from app.models.workplace import Announcement, AnnouncementRead
from app.schemas.workplace import (
    AnnouncementCreate,
    AnnouncementOut,
    AnnouncementUpdate,
)
from app.services.activity import record
from app.services.notify import notify_user
from app.services.people import user_names

router = APIRouter(prefix="/announcements", tags=["announcements"])


def _can_post(user: User) -> bool:
    return user.is_admin or user.role == "manager"


async def _read_ids(db: AsyncSession, user_id: uuid.UUID) -> set[uuid.UUID]:
    rows = (
        await db.execute(
            select(AnnouncementRead.announcement_id).where(
                AnnouncementRead.user_id == user_id
            )
        )
    ).scalars().all()
    return set(rows)


@router.get("/unread-count")
async def unread_count(
    db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)
):
    total = (
        await db.execute(
            select(func.count())
            .select_from(Announcement)
            .where(Announcement.is_published.is_(True))
        )
    ).scalar_one()
    read = len(await _read_ids(db, user.id))
    return {"count": max(int(total) - read, 0)}


@router.get("", response_model=list[AnnouncementOut])
async def list_announcements(
    db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)
):
    stmt = select(Announcement).order_by(
        Announcement.pinned.desc(), Announcement.created_at.desc()
    )
    if not _can_post(user):
        stmt = stmt.where(Announcement.is_published.is_(True))
    items = (await db.execute(stmt)).scalars().all()

    read = await _read_ids(db, user.id)
    names = await user_names(db, {a.author_id for a in items})
    # Read counts (for authors/admins) in one grouped query.
    counts: dict[uuid.UUID, int] = {}
    if items and _can_post(user):
        rows = (
            await db.execute(
                select(AnnouncementRead.announcement_id, func.count())
                .where(AnnouncementRead.announcement_id.in_([a.id for a in items]))
                .group_by(AnnouncementRead.announcement_id)
            )
        ).all()
        counts = {r[0]: int(r[1]) for r in rows}

    out = []
    for a in items:
        o = AnnouncementOut.model_validate(a)
        o.author_name = names.get(a.author_id) if a.author_id else None
        o.is_read = a.id in read
        o.read_count = counts.get(a.id, 0)
        out.append(o)
    return out


@router.post("", response_model=AnnouncementOut, status_code=201)
async def create_announcement(
    payload: AnnouncementCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if not _can_post(user):
        raise HTTPException(status_code=403, detail="Only managers/admins can post")
    a = Announcement(**payload.model_dump(), author_id=user.id)
    db.add(a)
    await db.flush()
    if a.is_published:
        # Notify all active users.
        recipients = (
            await db.execute(
                select(User.id).where(User.status == "active", User.id != user.id)
            )
        ).scalars().all()
        for uid in recipients:
            await notify_user(
                db,
                user_id=uid,
                title="New announcement",
                body=a.title,
                link="/announcements",
                category="announcement",
                dedup_key=f"announcement:{a.id}:{uid}",
            )
    record(
        db,
        user=user,
        action="published",
        entity_type="announcement",
        entity_id=a.id,
        summary=f"Posted announcement '{a.title}'",
    )
    await db.commit()
    await db.refresh(a)
    o = AnnouncementOut.model_validate(a)
    o.author_name = user.display_name or user.email
    return o


@router.post("/{ann_id}/read", status_code=204)
async def mark_read(
    ann_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    exists = (
        await db.execute(
            select(AnnouncementRead).where(
                AnnouncementRead.announcement_id == ann_id,
                AnnouncementRead.user_id == user.id,
            )
        )
    ).scalar_one_or_none()
    if not exists:
        db.add(AnnouncementRead(announcement_id=ann_id, user_id=user.id))
        await db.commit()


@router.patch("/{ann_id}", response_model=AnnouncementOut)
async def update_announcement(
    ann_id: uuid.UUID,
    payload: AnnouncementUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    a = await db.get(Announcement, ann_id)
    if not a:
        raise HTTPException(status_code=404, detail="Not found")
    if not (user.is_admin or a.author_id == user.id):
        raise HTTPException(status_code=403, detail="Not allowed")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(a, field, value)
    await db.commit()
    await db.refresh(a)
    names = await user_names(db, {a.author_id})
    o = AnnouncementOut.model_validate(a)
    o.author_name = names.get(a.author_id) if a.author_id else None
    return o


@router.delete("/{ann_id}", status_code=204)
async def delete_announcement(
    ann_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    a = await db.get(Announcement, ann_id)
    if not a:
        return
    if not (user.is_admin or a.author_id == user.id):
        raise HTTPException(status_code=403, detail="Not allowed")
    await db.delete(a)
    await db.commit()
