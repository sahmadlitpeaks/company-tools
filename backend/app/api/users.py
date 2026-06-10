import csv
import io
import re
import uuid
from datetime import date

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import StreamingResponse
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.azure import fetch_graph_users, get_app_token
from app.auth.deps import get_current_admin, get_current_user
from app.core.database import get_db
from app.core.permissions import ALL_MODULES, MODULES, ROLE_DEFAULTS
from app.core.security import hash_password
from app.models.company import Company
from app.models.department import Department
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


# ---- CSV import / export (employee migration, e.g. from BambooHR) ----------
CSV_FIELDS = [
    "email", "display_name", "given_name", "surname", "job_title", "department",
    "office_location", "mobile_phone", "business_phone", "personal_email",
    "employment_type", "hire_date", "manager_email", "role", "status",
]

CSV_SAMPLE = {
    "email": "person@agholding.net", "display_name": "Jane Doe",
    "given_name": "Jane", "surname": "Doe", "job_title": "Accountant",
    "department": "Finance", "office_location": "Dubai", "mobile_phone": "+9715...",
    "business_phone": "", "personal_email": "jane@example.com",
    "employment_type": "full_time", "hire_date": "2025-01-15",
    "manager_email": "manager@agholding.net", "role": "member", "status": "active",
}


def _csv_response(rows: list[dict], filename: str) -> StreamingResponse:
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=CSV_FIELDS)
    writer.writeheader()
    writer.writerows(rows)
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def _parse_date(v: str | None):
    v = (v or "").strip()
    if not v:
        return None
    try:
        return date.fromisoformat(v)
    except ValueError:
        return None


@router.get("/template.csv")
async def employees_template(_: User = Depends(get_current_admin)):
    return _csv_response([CSV_SAMPLE], "employees-template.csv")


@router.get("/export.csv")
async def export_employees(
    db: AsyncSession = Depends(get_db), _: User = Depends(get_current_admin)
):
    users = (await db.execute(select(User).order_by(User.display_name))).scalars().all()
    emails = {u.id: u.email for u in users}
    rows = [
        {
            "email": u.email or "",
            "display_name": u.display_name or "",
            "given_name": u.given_name or "",
            "surname": u.surname or "",
            "job_title": u.job_title or "",
            "department": u.department or "",
            "office_location": u.office_location or "",
            "mobile_phone": u.mobile_phone or "",
            "business_phone": u.business_phone or "",
            "personal_email": u.personal_email or "",
            "employment_type": u.employment_type or "",
            "hire_date": u.hire_date.isoformat() if u.hire_date else "",
            "manager_email": emails.get(u.manager_id, "") if u.manager_id else "",
            "role": u.role,
            "status": u.status,
        }
        for u in users
    ]
    return _csv_response(rows, "employees.csv")


@router.post("/import")
async def import_employees(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(get_current_admin),
):
    """Bulk create/update employees from CSV (matched by email). Manager links
    are resolved by manager_email in a second pass so order doesn't matter."""
    raw = (await file.read()).decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(raw))
    created = updated = 0
    errors: list[str] = []
    seen: list[tuple[str, str]] = []  # (email, manager_email) for pass 2

    for i, row in enumerate(reader, start=2):
        email = (row.get("email") or "").strip().lower()
        if not email:
            errors.append(f"Row {i}: email is required")
            continue
        if not _valid_email(email):
            errors.append(f"Row {i}: invalid email '{email}'")
            continue
        role = (row.get("role") or "member").strip().lower()
        if role not in ROLES:
            role = "member"
        status = (row.get("status") or "active").strip().lower()
        if status not in STATUSES:
            status = "active"
        name = (row.get("display_name") or "").strip() or " ".join(
            filter(None, [(row.get("given_name") or "").strip(), (row.get("surname") or "").strip()])
        ).strip() or email
        values = dict(
            display_name=name,
            given_name=(row.get("given_name") or "").strip() or None,
            surname=(row.get("surname") or "").strip() or None,
            job_title=(row.get("job_title") or "").strip() or None,
            department=(row.get("department") or "").strip() or None,
            office_location=(row.get("office_location") or "").strip() or None,
            mobile_phone=(row.get("mobile_phone") or "").strip() or None,
            business_phone=(row.get("business_phone") or "").strip() or None,
            personal_email=(row.get("personal_email") or "").strip().lower() or None,
            employment_type=(row.get("employment_type") or "").strip() or None,
            hire_date=_parse_date(row.get("hire_date")),
            role=role,
            is_admin=role == "admin",
            status=status,
        )
        existing = (
            await db.execute(select(User).where(User.email == email))
        ).scalar_one_or_none()
        if existing:
            for k, v in values.items():
                setattr(existing, k, v)
            updated += 1
        else:
            db.add(User(email=email, **values))
            created += 1
        mgr_email = (row.get("manager_email") or "").strip().lower()
        if mgr_email:
            seen.append((email, mgr_email))

    await db.flush()
    # Pass 2: resolve manager links now that everyone exists.
    for email, mgr_email in seen:
        u = (await db.execute(select(User).where(User.email == email))).scalar_one_or_none()
        mgr = (await db.execute(select(User).where(User.email == mgr_email))).scalar_one_or_none()
        if not mgr:
            errors.append(f"Unknown manager '{mgr_email}' for {email}")
        elif u and mgr.id != u.id:
            u.manager_id = mgr.id

    record(
        db, user=admin, action="created", entity_type="user",
        summary=f"Imported employees via CSV ({created} new, {updated} updated)",
    )
    await db.commit()
    return {"created": created, "updated": updated, "errors": errors}


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
    for key in ("permissions", "extra_permissions", "revoked_permissions"):
        if data.get(key) is not None:
            invalid = set(data[key]) - set(ALL_MODULES)
            if invalid:
                raise HTTPException(
                    status_code=422,
                    detail=f"Unknown modules: {', '.join(sorted(invalid))}",
                )
    if data.get("department_id") is not None:
        dept = await db.get(Department, data["department_id"])
        if not dept:
            raise HTTPException(status_code=404, detail="Department not found")
    if data.get("manager_id") is not None:
        if data["manager_id"] == user.id:
            raise HTTPException(status_code=422, detail="A user can't manage themselves")
        if not await db.get(User, data["manager_id"]):
            raise HTTPException(status_code=404, detail="Manager not found")
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
    # Reload via a fresh SELECT so the (selectin) manager relationship is
    # eagerly populated and never lazy-loads during sync serialization.
    return (
        await db.execute(
            select(User).where(User.id == user.id).execution_options(populate_existing=True)
        )
    ).scalar_one()


@router.put("/{user_id}/brands", response_model=UserOut)
async def set_managed_companies(
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
        await db.execute(select(Company).where(Company.id.in_(payload.company_ids)))
    ).scalars().all()
    user.managed_companies = list(brands)
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
