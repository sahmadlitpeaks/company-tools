"""Per-user saved filter views for list surfaces (tickets, tasks)."""
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.core.database import get_db
from app.models.saved_view import SavedView
from app.models.user import User

router = APIRouter(prefix="/views", tags=["views"])

SURFACES = {"tickets", "tasks"}


class SavedViewCreate(BaseModel):
    surface: str
    name: str
    params: str = ""


class SavedViewOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    surface: str
    name: str
    params: str
    created_at: datetime


@router.get("", response_model=list[SavedViewOut])
async def list_views(
    surface: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    stmt = select(SavedView).where(SavedView.user_id == user.id)
    if surface:
        stmt = stmt.where(SavedView.surface == surface)
    stmt = stmt.order_by(SavedView.created_at.asc())
    rows = (await db.execute(stmt)).scalars().all()
    return [SavedViewOut.model_validate(r) for r in rows]


@router.post("", response_model=SavedViewOut, status_code=201)
async def create_view(
    payload: SavedViewCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if payload.surface not in SURFACES:
        raise HTTPException(status_code=422, detail="Invalid surface")
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="Name is required")
    # Upsert by (user, surface, name) so "save" overwrites a view of the same name.
    existing = (
        await db.execute(
            select(SavedView).where(
                SavedView.user_id == user.id,
                SavedView.surface == payload.surface,
                SavedView.name == name,
            )
        )
    ).scalar_one_or_none()
    if existing:
        existing.params = payload.params
        view = existing
    else:
        view = SavedView(
            user_id=user.id, surface=payload.surface, name=name, params=payload.params
        )
        db.add(view)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="A view with that name exists")
    await db.refresh(view)
    return SavedViewOut.model_validate(view)


@router.delete("/{view_id}", status_code=204)
async def delete_view(
    view_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    view = await db.get(SavedView, view_id)
    if view and view.user_id == user.id:
        await db.delete(view)
        await db.commit()
