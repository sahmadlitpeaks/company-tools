import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.azure import fetch_graph_users, get_app_token
from app.auth.deps import get_current_admin, get_current_user
from app.core.database import get_db
from app.models.brand import Brand
from app.models.user import User
from app.schemas.user import ManagedBrandsUpdate, UserOut, UserUpdate
from app.services.users import sync_all_users_from_graph

ROLES = {"admin", "manager", "member"}

router = APIRouter(prefix="/users", tags=["directory"])


@router.get("", response_model=list[UserOut])
async def list_users(
    q: str | None = Query(None, description="Search name/email/department"),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    stmt = select(User).order_by(User.display_name)
    if q:
        like = f"%{q}%"
        stmt = stmt.where(
            or_(
                User.display_name.ilike(like),
                User.email.ilike(like),
                User.department.ilike(like),
                User.job_title.ilike(like),
            )
        )
    result = await db.execute(stmt.limit(500))
    return result.scalars().all()


@router.get("/{user_id}", response_model=UserOut)
async def get_user(
    user_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user


@router.patch("/{user_id}", response_model=UserOut)
async def update_user(
    user_id: uuid.UUID,
    payload: UserUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    data = payload.model_dump(exclude_unset=True)
    if "role" in data:
        if data["role"] not in ROLES:
            raise HTTPException(status_code=422, detail="Invalid role")
        # Keep the is_admin flag in sync with the role.
        user.is_admin = data["role"] == "admin"
    for field, value in data.items():
        setattr(user, field, value)
    await db.commit()
    await db.refresh(user)
    return user


@router.put("/{user_id}/brands", response_model=UserOut)
async def set_managed_brands(
    user_id: uuid.UUID,
    payload: ManagedBrandsUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    """Set which brands a manager can manage."""
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    brands = (
        await db.execute(select(Brand).where(Brand.id.in_(payload.brand_ids)))
    ).scalars().all()
    user.managed_brands = list(brands)
    await db.commit()
    await db.refresh(user)
    return user


@router.post("/sync", response_model=dict)
async def sync_directory(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    """Feature #1 — pull every user from Entra ID into the local DB."""
    token = await get_app_token()
    graph_users = await fetch_graph_users(token)
    count = await sync_all_users_from_graph(db, graph_users)
    await db.commit()
    return {"synced": count}
