import re
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.azure import fetch_graph_users, get_app_token
from app.auth.deps import get_current_admin, get_current_user
from app.core.database import get_db
from app.core.permissions import ALL_MODULES, MODULES, ROLE_DEFAULTS
from app.core.security import hash_password
from app.models.brand import Brand
from app.models.user import User
from app.schemas.user import (
    ManagedBrandsUpdate,
    SetPasswordIn,
    UserCreate,
    UserOut,
    UserUpdate,
)
from app.services.activity import record
from app.services.app_settings import get_azure_config, get_bamboo_config
from app.services.integrations import provision_azure_user, push_bamboo_employee
from app.services.users import sync_all_users_from_graph

ROLES = {"admin", "manager", "member"}
STATUSES = {"pending", "active", "disabled"}

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _valid_email(value: str) -> bool:
    return bool(_EMAIL_RE.match(value))

router = APIRouter(prefix="/users", tags=["directory"])


@router.get("/modules")
async def list_modules(_: User = Depends(get_current_admin)) -> dict:
    """Catalogue of permission modules + role defaults, for the admin matrix."""
    return {
        "modules": [{"key": k, "label": label} for k, label in MODULES],
        "role_defaults": ROLE_DEFAULTS,
    }


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


@router.post("", response_model=UserOut, status_code=201)
async def create_user(
    payload: UserCreate,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(get_current_admin),
):
    """Manually add an employee not yet synced from Azure (e.g. a new joiner)."""
    official = (payload.email or "").strip().lower() or None
    personal = (payload.personal_email or "").strip().lower() or None
    name = (
        payload.display_name
        or " ".join(filter(None, [payload.given_name, payload.surname])).strip()
        or None
    )
    if not name:
        raise HTTPException(status_code=422, detail="A name is required")
    if not official and not personal:
        raise HTTPException(
            status_code=422, detail="A personal or official email is required"
        )
    if official and not _valid_email(official):
        raise HTTPException(status_code=422, detail="Official email is invalid")
    if personal and not _valid_email(personal):
        raise HTTPException(status_code=422, detail="Personal email is invalid")
    if payload.role not in ROLES:
        raise HTTPException(status_code=422, detail="Invalid role")
    if payload.status not in STATUSES:
        raise HTTPException(status_code=422, detail="Invalid status")
    if official:
        clash = (
            await db.execute(select(User).where(User.email == official))
        ).scalar_one_or_none()
        if clash:
            raise HTTPException(status_code=409, detail="That official email is taken")
    user = User(
        email=official,
        personal_email=personal,
        display_name=name,
        given_name=payload.given_name,
        surname=payload.surname,
        job_title=payload.job_title,
        department=payload.department,
        mobile_phone=payload.mobile_phone,
        business_phone=payload.business_phone,
        office_location=payload.office_location,
        passport_no=payload.passport_no,
        nationality=payload.nationality,
        role=payload.role,
        is_admin=payload.role == "admin",
        status=payload.status,
    )
    if payload.password:
        if len(payload.password) < 8:
            raise HTTPException(
                status_code=422, detail="Password must be at least 8 characters"
            )
        user.password_hash = hash_password(payload.password)
        user.must_change_password = True
    db.add(user)
    record(
        db,
        user=admin,
        action="created",
        entity_type="user",
        summary=f"Added employee {name} ({official or personal})",
    )
    await db.commit()
    await db.refresh(user)
    return user


@router.post("/{user_id}/set-password")
async def set_password(
    user_id: uuid.UUID,
    payload: SetPasswordIn,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(get_current_admin),
):
    """Set or reset a user's local password (they must change it on next login)."""
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if len(payload.password or "") < 8:
        raise HTTPException(status_code=422, detail="Password must be at least 8 characters")
    user.password_hash = hash_password(payload.password)
    user.must_change_password = True
    record(
        db, user=admin, action="updated", entity_type="user", entity_id=user.id,
        summary=f"Reset password for {user.display_name or user.email}",
    )
    await db.commit()
    return {"ok": True}


@router.post("/{user_id}/sync-azure")
async def sync_azure(
    user_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(get_current_admin),
):
    """Provision this employee in Azure Entra ID (requires Azure configured)."""
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.azure_oid:
        return {"ok": True, "message": "Already linked to Azure", "azure_oid": user.azure_oid}
    cfg = await get_azure_config(db)
    result = await provision_azure_user(cfg, user)
    if not result["ok"]:
        raise HTTPException(status_code=400, detail=result["error"])
    user.azure_oid = result.get("azure_oid") or user.azure_oid
    record(
        db, user=admin, action="updated", entity_type="user", entity_id=user.id,
        summary=f"Provisioned {user.email} in Azure",
    )
    await db.commit()
    return {"ok": True, "azure_oid": user.azure_oid, "temp_password": result.get("temp_password")}


@router.post("/{user_id}/sync-bamboo")
async def sync_bamboo(
    user_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(get_current_admin),
):
    """Push this employee to BambooHR (requires BambooHR configured)."""
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.bamboo_id:
        return {"ok": True, "message": "Already in BambooHR", "bamboo_id": user.bamboo_id}
    cfg = await get_bamboo_config(db)
    result = await push_bamboo_employee(cfg, user)
    if not result["ok"]:
        raise HTTPException(status_code=400, detail=result["error"])
    user.bamboo_id = result.get("bamboo_id") or user.bamboo_id
    record(
        db, user=admin, action="updated", entity_type="user", entity_id=user.id,
        summary=f"Pushed {user.display_name or user.email} to BambooHR",
    )
    await db.commit()
    return {"ok": True, "bamboo_id": user.bamboo_id}


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
    admin: User = Depends(get_current_admin),
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
    if "status" in data and data["status"] not in STATUSES:
        raise HTTPException(status_code=422, detail="Invalid status")
    if data.get("permissions") is not None:
        invalid = set(data["permissions"]) - set(ALL_MODULES)
        if invalid:
            raise HTTPException(
                status_code=422, detail=f"Unknown modules: {', '.join(sorted(invalid))}"
            )
    for field, value in data.items():
        setattr(user, field, value)
    record(
        db,
        user=admin,
        action="updated",
        entity_type="user",
        entity_id=user.id,
        summary=f"Updated access for {user.email}",
    )
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
    cfg = await get_azure_config(db)
    if not cfg["configured"]:
        raise HTTPException(status_code=503, detail="Azure is not configured")
    token = await get_app_token(cfg["tenant_id"], cfg["client_id"], cfg["client_secret"])
    graph_users = await fetch_graph_users(token)
    count = await sync_all_users_from_graph(db, graph_users)
    await db.commit()
    return {"synced": count}
