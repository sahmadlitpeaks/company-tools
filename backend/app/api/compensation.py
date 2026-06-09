"""Employee compensation: dated salary/bonus records and reference pay bands.

Highly sensitive: an employee may view their own records; only admins/HR may
add/delete records or manage pay bands; department managers are excluded.
"""
import uuid
from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.core.database import get_db
from app.models.hr import (
    COMPENSATION_TYPES,
    PAY_PERIODS,
    CompensationRecord,
    EmploymentEvent,
    PayBand,
)
from app.models.user import User
from app.schemas.compensation import (
    CompensationCreate,
    CompensationRecordOut,
    CompensationSummary,
    PayBandCreate,
    PayBandOut,
    PayBandUpdate,
)
from app.services.activity import record as log

router = APIRouter(prefix="/compensation", tags=["hr"])

# Hours per year used to annualise hourly pay.
_HOURS_PER_YEAR = Decimal("2080")


def _is_hr(user: User) -> bool:
    return user.is_admin or "hr" in user.effective_permissions


def _annualised(amount: Decimal, period: str) -> Decimal:
    if period == "monthly":
        return (amount * 12).quantize(Decimal("0.01"))
    if period == "hourly":
        return (amount * _HOURS_PER_YEAR).quantize(Decimal("0.01"))
    return amount


# ---- Pay bands (admin/HR) ------------------------------------------------
@router.get("/bands", response_model=list[PayBandOut])
async def list_bands(
    db: AsyncSession = Depends(get_db), viewer: User = Depends(get_current_user)
):
    if not _is_hr(viewer):
        raise HTTPException(status_code=403, detail="Not allowed")
    return (await db.execute(select(PayBand).order_by(PayBand.name))).scalars().all()


@router.post("/bands", response_model=PayBandOut, status_code=201)
async def create_band(
    payload: PayBandCreate,
    db: AsyncSession = Depends(get_db),
    viewer: User = Depends(get_current_user),
):
    if not _is_hr(viewer):
        raise HTTPException(status_code=403, detail="Not allowed")
    if not payload.name.strip():
        raise HTTPException(status_code=422, detail="Name is required")
    band = PayBand(**payload.model_dump())
    db.add(band)
    await db.commit()
    await db.refresh(band)
    return band


@router.patch("/bands/{band_id}", response_model=PayBandOut)
async def update_band(
    band_id: uuid.UUID,
    payload: PayBandUpdate,
    db: AsyncSession = Depends(get_db),
    viewer: User = Depends(get_current_user),
):
    if not _is_hr(viewer):
        raise HTTPException(status_code=403, detail="Not allowed")
    band = await db.get(PayBand, band_id)
    if not band:
        raise HTTPException(status_code=404, detail="Band not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(band, field, value)
    await db.commit()
    await db.refresh(band)
    return band


@router.delete("/bands/{band_id}", status_code=204)
async def delete_band(
    band_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    viewer: User = Depends(get_current_user),
):
    if not _is_hr(viewer):
        raise HTTPException(status_code=403, detail="Not allowed")
    band = await db.get(PayBand, band_id)
    if band:
        await db.delete(band)
        await db.commit()


# ---- Compensation records ------------------------------------------------
async def _band_names(db: AsyncSession, ids: set) -> dict:
    ids = {i for i in ids if i}
    if not ids:
        return {}
    rows = (await db.execute(select(PayBand.id, PayBand.name).where(PayBand.id.in_(ids)))).all()
    return {r[0]: r[1] for r in rows}


@router.get("/by-user/{user_id}", response_model=list[CompensationRecordOut])
async def list_records(
    user_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    viewer: User = Depends(get_current_user),
):
    if viewer.id != user_id and not _is_hr(viewer):
        raise HTTPException(status_code=403, detail="Not allowed")
    records = (
        await db.execute(
            select(CompensationRecord)
            .where(CompensationRecord.user_id == user_id)
            .order_by(CompensationRecord.effective_date.desc(), CompensationRecord.created_at.desc())
        )
    ).scalars().all()
    bands = await _band_names(db, {r.band_id for r in records})
    out = []
    for r in records:
        item = CompensationRecordOut.model_validate(r)
        item.band_name = bands.get(r.band_id)
        out.append(item)
    return out


@router.get("/current/{user_id}", response_model=CompensationSummary)
async def current(
    user_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    viewer: User = Depends(get_current_user),
):
    if viewer.id != user_id and not _is_hr(viewer):
        raise HTTPException(status_code=403, detail="Not allowed")
    rec = (
        await db.execute(
            select(CompensationRecord)
            .where(
                CompensationRecord.user_id == user_id,
                CompensationRecord.record_type == "salary",
            )
            .order_by(CompensationRecord.effective_date.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    if not rec:
        return CompensationSummary(user_id=user_id)
    bands = await _band_names(db, {rec.band_id})
    return CompensationSummary(
        user_id=user_id,
        amount=rec.amount,
        currency=rec.currency,
        pay_period=rec.pay_period,
        effective_date=rec.effective_date,
        band_name=bands.get(rec.band_id),
        annualised=_annualised(Decimal(rec.amount), rec.pay_period),
    )


@router.post("/by-user/{user_id}", response_model=CompensationRecordOut, status_code=201)
async def add_record(
    user_id: uuid.UUID,
    payload: CompensationCreate,
    db: AsyncSession = Depends(get_db),
    viewer: User = Depends(get_current_user),
):
    if not _is_hr(viewer):
        raise HTTPException(status_code=403, detail="Only HR can record compensation")
    if not await db.get(User, user_id):
        raise HTTPException(status_code=404, detail="User not found")
    if payload.record_type not in COMPENSATION_TYPES:
        raise HTTPException(status_code=422, detail="Invalid compensation type")
    if payload.pay_period not in PAY_PERIODS:
        raise HTTPException(status_code=422, detail="Invalid pay period")
    if payload.band_id and not await db.get(PayBand, payload.band_id):
        raise HTTPException(status_code=404, detail="Pay band not found")
    eff = payload.effective_date or date.today()
    rec = CompensationRecord(
        user_id=user_id,
        record_type=payload.record_type,
        amount=payload.amount,
        currency=payload.currency,
        pay_period=payload.pay_period,
        effective_date=eff,
        band_id=payload.band_id,
        note=payload.note,
        created_by_id=viewer.id,
    )
    db.add(rec)
    # Mirror onto the employment timeline (without the figure, for privacy).
    db.add(
        EmploymentEvent(
            user_id=user_id,
            event_type="compensation",
            effective_date=eff,
            title=f"{payload.record_type.title()} updated",
            detail=payload.note,
            created_by_id=viewer.id,
        )
    )
    log(
        db, user=viewer, action="created", entity_type="user", entity_id=user_id,
        summary=f"Recorded {payload.record_type} compensation",
    )
    await db.commit()
    await db.refresh(rec)
    out = CompensationRecordOut.model_validate(rec)
    if rec.band_id:
        out.band_name = (await _band_names(db, {rec.band_id})).get(rec.band_id)
    return out


@router.delete("/{record_id}", status_code=204)
async def delete_record(
    record_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    viewer: User = Depends(get_current_user),
):
    if not _is_hr(viewer):
        raise HTTPException(status_code=403, detail="Only HR can delete records")
    rec = await db.get(CompensationRecord, record_id)
    if rec:
        await db.delete(rec)
        await db.commit()
