"""Custom fields & custom tables — admin schema + per-employee values.

Schema (definitions/tables) is managed by HR/admins. Values follow profile
visibility: readable by self / HR / the person's reporting-line manager, with
``sensitive`` fields hidden unless the viewer may see sensitive data; editable
by self or HR.
"""
import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.core.database import get_db
from app.core.permissions import is_hr
from app.models.custom_fields import (
    FIELD_TYPES,
    CustomFieldDef,
    CustomFieldValue,
    CustomTableDef,
    CustomTableRow,
)
from app.models.user import User
from app.schemas.custom_fields import (
    CustomSchema,
    CustomValuesOut,
    FieldDefCreate,
    FieldDefOut,
    FieldDefUpdate,
    FieldValueOut,
    FieldValuesIn,
    TableDefCreate,
    TableDefOut,
    TableDefUpdate,
    TableRowIn,
    TableRowOut,
    TableValuesOut,
)
from app.services.activity import record

router = APIRouter(prefix="/custom-fields", tags=["hr"])


async def _can_see(db: AsyncSession, viewer: User, target_id: uuid.UUID) -> tuple[bool, bool, bool]:
    """Return (can_view, can_edit, can_see_sensitive) for viewer→target."""
    is_self = viewer.id == target_id
    hr = is_hr(viewer)
    is_manager = False
    if not (is_self or hr):
        target = await db.get(User, target_id)
        is_manager = bool(target and target.manager_id == viewer.id)
    return (is_self or hr or is_manager, is_self or hr, is_self or hr)


# ---- schema management (HR) ----------------------------------------------
@router.get("/schema", response_model=CustomSchema)
async def get_schema(
    include_inactive: bool = False,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    fstmt = select(CustomFieldDef).order_by(CustomFieldDef.section, CustomFieldDef.sort)
    tstmt = select(CustomTableDef).order_by(CustomTableDef.sort)
    if not include_inactive:
        fstmt = fstmt.where(CustomFieldDef.active.is_(True))
        tstmt = tstmt.where(CustomTableDef.active.is_(True))
    fields = (await db.execute(fstmt)).scalars().all()
    tables = (await db.execute(tstmt)).scalars().all()
    return CustomSchema(
        fields=[FieldDefOut.model_validate(f) for f in fields],
        tables=[TableDefOut.model_validate(t) for t in tables],
    )


@router.post("/defs", response_model=FieldDefOut, status_code=201)
async def create_def(
    payload: FieldDefCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if not is_hr(user):
        raise HTTPException(status_code=403, detail="HR only")
    if payload.field_type not in FIELD_TYPES:
        raise HTTPException(status_code=422, detail="Invalid field type")
    key = payload.key.strip().lower().replace(" ", "_")
    if not key:
        raise HTTPException(status_code=422, detail="Key is required")
    exists = (
        await db.execute(
            select(CustomFieldDef).where(
                CustomFieldDef.entity == "employee", CustomFieldDef.key == key
            )
        )
    ).scalar_one_or_none()
    if exists:
        raise HTTPException(status_code=409, detail="Field key already exists")
    d = CustomFieldDef(**{**payload.model_dump(), "key": key})
    db.add(d)
    await db.commit()
    await db.refresh(d)
    return d


@router.patch("/defs/{def_id}", response_model=FieldDefOut)
async def update_def(
    def_id: uuid.UUID,
    payload: FieldDefUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if not is_hr(user):
        raise HTTPException(status_code=403, detail="HR only")
    d = await db.get(CustomFieldDef, def_id)
    if not d:
        raise HTTPException(status_code=404, detail="Field not found")
    data = payload.model_dump(exclude_unset=True)
    if "field_type" in data and data["field_type"] not in FIELD_TYPES:
        raise HTTPException(status_code=422, detail="Invalid field type")
    for k, v in data.items():
        setattr(d, k, v)
    await db.commit()
    await db.refresh(d)
    return d


@router.delete("/defs/{def_id}", status_code=204)
async def delete_def(
    def_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if not is_hr(user):
        raise HTTPException(status_code=403, detail="HR only")
    d = await db.get(CustomFieldDef, def_id)
    if d:
        await db.delete(d)
        await db.commit()


@router.post("/tables", response_model=TableDefOut, status_code=201)
async def create_table(
    payload: TableDefCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if not is_hr(user):
        raise HTTPException(status_code=403, detail="HR only")
    key = payload.key.strip().lower().replace(" ", "_")
    if not key:
        raise HTTPException(status_code=422, detail="Key is required")
    if (
        await db.execute(select(CustomTableDef).where(CustomTableDef.key == key))
    ).scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Table key already exists")
    t = CustomTableDef(
        key=key,
        label=payload.label,
        columns=[c.model_dump() for c in payload.columns],
        sensitive=payload.sensitive,
        sort=payload.sort,
    )
    db.add(t)
    await db.commit()
    await db.refresh(t)
    return t


@router.patch("/tables/{table_id}", response_model=TableDefOut)
async def update_table(
    table_id: uuid.UUID,
    payload: TableDefUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if not is_hr(user):
        raise HTTPException(status_code=403, detail="HR only")
    t = await db.get(CustomTableDef, table_id)
    if not t:
        raise HTTPException(status_code=404, detail="Table not found")
    data = payload.model_dump(exclude_unset=True)
    if "columns" in data and data["columns"] is not None:
        data["columns"] = [c for c in data["columns"]]
    for k, v in data.items():
        setattr(t, k, v)
    await db.commit()
    await db.refresh(t)
    return t


@router.delete("/tables/{table_id}", status_code=204)
async def delete_table(
    table_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if not is_hr(user):
        raise HTTPException(status_code=403, detail="HR only")
    t = await db.get(CustomTableDef, table_id)
    if t:
        await db.delete(t)
        await db.commit()


# ---- per-employee values --------------------------------------------------
@router.get("/values/{user_id}", response_model=CustomValuesOut)
async def get_values(
    user_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    viewer: User = Depends(get_current_user),
):
    can_view, can_edit, sensitive = await _can_see(db, viewer, user_id)
    if not can_view:
        raise HTTPException(status_code=403, detail="Not allowed")

    defs = (
        await db.execute(
            select(CustomFieldDef)
            .where(CustomFieldDef.active.is_(True))
            .order_by(CustomFieldDef.section, CustomFieldDef.sort)
        )
    ).scalars().all()
    values = {
        v.def_id: v.value
        for v in (
            await db.execute(
                select(CustomFieldValue).where(CustomFieldValue.user_id == user_id)
            )
        ).scalars().all()
    }
    out = CustomValuesOut(can_edit=can_edit)
    for d in defs:
        if d.sensitive and not sensitive:
            continue
        out.fields.append(
            FieldValueOut(
                def_id=d.id, key=d.key, label=d.label, section=d.section,
                field_type=d.field_type, options=d.options, sensitive=d.sensitive,
                value=values.get(d.id),
            )
        )

    tables = (
        await db.execute(
            select(CustomTableDef)
            .where(CustomTableDef.active.is_(True))
            .order_by(CustomTableDef.sort)
        )
    ).scalars().all()
    for t in tables:
        if t.sensitive and not sensitive:
            continue
        rows = (
            await db.execute(
                select(CustomTableRow)
                .where(CustomTableRow.table_id == t.id, CustomTableRow.user_id == user_id)
                .order_by(CustomTableRow.sort, CustomTableRow.created_at)
            )
        ).scalars().all()
        out.tables.append(
            TableValuesOut(
                table_id=t.id, key=t.key, label=t.label, columns=t.columns,
                sensitive=t.sensitive,
                rows=[TableRowOut(id=r.id, data=r.data, sort=r.sort) for r in rows],
            )
        )
    return out


@router.put("/values/{user_id}", response_model=CustomValuesOut)
async def set_values(
    user_id: uuid.UUID,
    payload: FieldValuesIn,
    db: AsyncSession = Depends(get_db),
    viewer: User = Depends(get_current_user),
):
    _, can_edit, _ = await _can_see(db, viewer, user_id)
    if not can_edit:
        raise HTTPException(status_code=403, detail="Not allowed")
    existing = {
        v.def_id: v
        for v in (
            await db.execute(
                select(CustomFieldValue).where(CustomFieldValue.user_id == user_id)
            )
        ).scalars().all()
    }
    for def_id, value in payload.values.items():
        row = existing.get(def_id)
        if row:
            row.value = value
        else:
            if not await db.get(CustomFieldDef, def_id):
                continue
            db.add(CustomFieldValue(def_id=def_id, user_id=user_id, value=value))
    record(
        db, user=viewer, action="updated", entity_type="user", entity_id=user_id,
        summary="Updated custom fields",
    )
    await db.commit()
    return await get_values(user_id, db, viewer)


@router.post("/tables/{table_id}/rows/{user_id}", response_model=TableRowOut, status_code=201)
async def add_row(
    table_id: uuid.UUID,
    user_id: uuid.UUID,
    payload: TableRowIn,
    db: AsyncSession = Depends(get_db),
    viewer: User = Depends(get_current_user),
):
    _, can_edit, _ = await _can_see(db, viewer, user_id)
    if not can_edit:
        raise HTTPException(status_code=403, detail="Not allowed")
    if not await db.get(CustomTableDef, table_id):
        raise HTTPException(status_code=404, detail="Table not found")
    row = CustomTableRow(table_id=table_id, user_id=user_id, data=payload.data, sort=payload.sort)
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return TableRowOut(id=row.id, data=row.data, sort=row.sort)


@router.patch("/rows/{row_id}", response_model=TableRowOut)
async def update_row(
    row_id: uuid.UUID,
    payload: TableRowIn,
    db: AsyncSession = Depends(get_db),
    viewer: User = Depends(get_current_user),
):
    row = await db.get(CustomTableRow, row_id)
    if not row:
        raise HTTPException(status_code=404, detail="Row not found")
    _, can_edit, _ = await _can_see(db, viewer, row.user_id)
    if not can_edit:
        raise HTTPException(status_code=403, detail="Not allowed")
    row.data = payload.data
    row.sort = payload.sort
    await db.commit()
    await db.refresh(row)
    return TableRowOut(id=row.id, data=row.data, sort=row.sort)


@router.delete("/rows/{row_id}", status_code=204)
async def delete_row(
    row_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    viewer: User = Depends(get_current_user),
):
    row = await db.get(CustomTableRow, row_id)
    if not row:
        return
    _, can_edit, _ = await _can_see(db, viewer, row.user_id)
    if not can_edit:
        raise HTTPException(status_code=403, detail="Not allowed")
    await db.delete(row)
    await db.commit()
