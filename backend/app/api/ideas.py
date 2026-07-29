import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.core.database import get_db
from app.models.operations import Idea, IdeaComment, IdeaVote
from app.models.user import User
from app.services.activity import record
from app.services.notify import notify_user
from app.services.people import user_names


router = APIRouter(prefix="/ideas", tags=["ideas"])
STATUSES = {"submitted", "under_review", "planned", "accepted", "completed"}


class IdeaIn(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    description: str = Field(min_length=1)
    kind: str = "idea"
    username: str | None = Field(default=None, max_length=255)
    anonymous: bool = False
    company_id: uuid.UUID | None = None

    @model_validator(mode="after")
    def named_submission_has_username(self):
        self.title = self.title.strip()
        self.description = self.description.strip()
        self.username = self.username.strip() if self.username else None
        return self


class StatusIn(BaseModel):
    status: str


class CommentIn(BaseModel):
    body: str = Field(min_length=1, max_length=5000)


def can_moderate(user: User) -> bool:
    return bool(user.is_admin or user.role == "manager")


async def out(db: AsyncSession, idea: Idea, user: User):
    vote_count = int(
        (
            await db.execute(
                select(func.count())
                .select_from(IdeaVote)
                .where(IdeaVote.idea_id == idea.id)
            )
        ).scalar_one()
    )
    comment_count = int(
        (
            await db.execute(
                select(func.count())
                .select_from(IdeaComment)
                .where(IdeaComment.idea_id == idea.id)
            )
        ).scalar_one()
    )
    voted = (
        await db.execute(
            select(IdeaVote.id).where(
                IdeaVote.idea_id == idea.id,
                IdeaVote.user_id == user.id,
            )
        )
    ).scalar_one_or_none() is not None
    names = await user_names(db, {idea.author_id})
    reveal_identity = not idea.is_anonymous
    return {
        "id": idea.id,
        "title": idea.title,
        "description": idea.description,
        "kind": idea.kind,
        "status": idea.status,
        "author_id": idea.author_id if reveal_identity else None,
        "author_name": (
            idea.submitted_name or names.get(idea.author_id)
            if reveal_identity
            else "Anonymous"
        ),
        "username": idea.submitted_name if reveal_identity else None,
        "anonymous": idea.is_anonymous,
        "is_owner": idea.author_id == user.id,
        "can_moderate": can_moderate(user),
        "vote_count": vote_count,
        "comment_count": comment_count,
        "voted": voted,
        "created_at": idea.created_at,
    }


@router.get("")
async def listing(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    rows = (
        await db.execute(select(Idea).order_by(Idea.created_at.desc()))
    ).scalars().all()
    return [await out(db, idea, user) for idea in rows]


@router.post("", status_code=201)
async def create(
    body: IdeaIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if body.kind not in {"idea", "issue"}:
        raise HTTPException(422, "Kind must be idea or issue")
    idea = Idea(
        title=body.title,
        description=body.description,
        kind=body.kind,
        company_id=body.company_id,
        author_id=user.id,
        submitted_name=(
            None
            if body.anonymous
            else body.username or user.display_name or user.email
        ),
        is_anonymous=body.anonymous,
        status="submitted",
    )
    db.add(idea)
    await db.flush()
    record(
        db,
        user=user,
        action="created",
        entity_type="idea",
        entity_id=idea.id,
        summary=f"Submitted {idea.kind}: {idea.title}",
    )
    await db.commit()
    await db.refresh(idea)
    return await out(db, idea, user)


@router.patch("/{idea_id}")
async def edit(
    idea_id: uuid.UUID,
    body: IdeaIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    idea = await db.get(Idea, idea_id)
    if not idea:
        raise HTTPException(404, "Idea not found")
    if idea.author_id != user.id or idea.status != "submitted":
        raise HTTPException(403, "Only the author can edit a pending submission")
    idea.title = body.title
    idea.description = body.description
    idea.kind = body.kind
    idea.company_id = body.company_id
    idea.submitted_name = (
        None
        if body.anonymous
        else body.username or user.display_name or user.email
    )
    idea.is_anonymous = body.anonymous
    await db.commit()
    await db.refresh(idea)
    return await out(db, idea, user)


@router.post("/{idea_id}/status")
async def moderate(
    idea_id: uuid.UUID,
    body: StatusIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if not can_moderate(user):
        raise HTTPException(403, "Manager privileges required")
    if body.status not in STATUSES - {"submitted"}:
        raise HTTPException(422, "Invalid status")
    idea = await db.get(Idea, idea_id)
    if not idea:
        raise HTTPException(404, "Idea not found")
    idea.status = body.status
    await notify_user(
        db,
        user_id=idea.author_id,
        title=f"Your {idea.kind} is now {body.status.replace('_', ' ')}",
        body=idea.title,
        link="/ideas",
        category="idea",
    )
    record(
        db,
        user=user,
        action="status",
        entity_type="idea",
        entity_id=idea.id,
        summary=f"Idea moved to {body.status}",
    )
    await db.commit()
    await db.refresh(idea)
    return await out(db, idea, user)


@router.post("/{idea_id}/vote")
async def vote(
    idea_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    idea = await db.get(Idea, idea_id)
    if not idea:
        raise HTTPException(404, "Idea not found")
    existing = (
        await db.execute(
            select(IdeaVote).where(
                IdeaVote.idea_id == idea_id,
                IdeaVote.user_id == user.id,
            )
        )
    ).scalar_one_or_none()
    if existing:
        await db.delete(existing)
    else:
        db.add(IdeaVote(idea_id=idea_id, user_id=user.id))
    await db.commit()
    return await out(db, idea, user)


@router.get("/{idea_id}/comments")
async def comments(
    idea_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    rows = (
        await db.execute(
            select(IdeaComment)
            .where(IdeaComment.idea_id == idea_id)
            .order_by(IdeaComment.created_at)
        )
    ).scalars().all()
    names = await user_names(db, {row.author_id for row in rows})
    return [
        {
            "id": row.id,
            "body": row.body,
            "author_name": names.get(row.author_id),
            "created_at": row.created_at,
        }
        for row in rows
    ]


@router.post("/{idea_id}/comments", status_code=201)
async def comment(
    idea_id: uuid.UUID,
    body: CommentIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    idea = await db.get(Idea, idea_id)
    if not idea:
        raise HTTPException(404, "Idea not found")
    new_comment = IdeaComment(
        idea_id=idea.id,
        author_id=user.id,
        body=body.body.strip(),
    )
    db.add(new_comment)
    if idea.author_id != user.id:
        await notify_user(
            db,
            user_id=idea.author_id,
            title="New comment on your submission",
            body=idea.title,
            link="/ideas",
            category="idea",
        )
    await db.commit()
    await db.refresh(new_comment)
    return {
        "id": new_comment.id,
        "body": new_comment.body,
        "author_name": user.display_name or user.email,
        "created_at": new_comment.created_at,
    }
