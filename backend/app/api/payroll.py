"""Payroll: monthly runs that fan out into per-employee payslips.

A run seeds each active employee's payslip from their latest salary
``CompensationRecord`` (annual/monthly/hourly normalised to a monthly base).
HR can adjust earning/deduction line items while a run is ``draft``; finalising
locks it and exposes payslips to employees under ``/payroll/my``.
"""
import csv
import io
import re
import uuid
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth.deps import get_current_user
from app.core.database import get_db
from app.core.permissions import is_hr
from app.models.hr import CompensationRecord
from app.models.payroll import Payslip, PayrollRun
from app.models.user import User
from app.schemas.payroll import (
    PayslipOut,
    PayslipUpdate,
    RunCreate,
    RunOut,
)

router = APIRouter(prefix="/payroll", tags=["payroll"])

_PERIOD_RE = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")
_HOURS_PER_MONTH = Decimal("173.33")


def _require_hr(user: User) -> None:
    if not is_hr(user):
        raise HTTPException(status_code=403, detail="HR access required")


def _monthly(amount, pay_period: str) -> Decimal:
    """Normalise a salary amount to a monthly figure."""
    amt = Decimal(str(amount or 0))
    if pay_period == "annual":
        return (amt / Decimal(12)).quantize(Decimal("0.01"))
    if pay_period == "hourly":
        return (amt * _HOURS_PER_MONTH).quantize(Decimal("0.01"))
    return amt.quantize(Decimal("0.01"))


def _recalc(slip: Payslip) -> None:
    base = Decimal(str(slip.base_salary or 0))
    earnings = Decimal(0)
    deductions = Decimal(0)
    for item in slip.items or []:
        amt = Decimal(str(item.get("amount", 0)))
        if item.get("kind") == "deduction":
            deductions += amt
        else:
            earnings += amt
    slip.gross = (base + earnings).quantize(Decimal("0.01"))
    slip.deductions = deductions.quantize(Decimal("0.01"))
    slip.net = (slip.gross - slip.deductions).quantize(Decimal("0.01"))


def _slip_out(slip: Payslip, name_by_id: dict, period: str | None = None) -> PayslipOut:
    return PayslipOut(
        id=slip.id,
        run_id=slip.run_id,
        user_id=slip.user_id,
        employee_name=name_by_id.get(slip.user_id),
        period=period,
        currency=slip.currency,
        base_salary=slip.base_salary,
        items=slip.items or [],
        gross=slip.gross,
        deductions=slip.deductions,
        net=slip.net,
    )


def _run_out(run: PayrollRun) -> RunOut:
    slips = run.payslips or []
    return RunOut(
        id=run.id,
        period=run.period,
        status=run.status,
        note=run.note,
        created_at=run.created_at,
        payslip_count=len(slips),
        total_net=sum((Decimal(str(s.net or 0)) for s in slips), Decimal(0)),
    )


async def _run_with_slips(db: AsyncSession, run_id: uuid.UUID) -> PayrollRun | None:
    res = await db.execute(
        select(PayrollRun)
        .where(PayrollRun.id == run_id)
        .options(selectinload(PayrollRun.payslips))
        .execution_options(populate_existing=True)
    )
    return res.scalar_one_or_none()


async def _names_for(db: AsyncSession, user_ids: list[uuid.UUID]) -> dict:
    if not user_ids:
        return {}
    res = await db.execute(
        select(User.id, User.display_name).where(User.id.in_(user_ids))
    )
    return {row[0]: row[1] for row in res.all()}


@router.get("/runs", response_model=list[RunOut])
async def list_runs(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _require_hr(user)
    res = await db.execute(
        select(PayrollRun)
        .options(selectinload(PayrollRun.payslips))
        .order_by(PayrollRun.period.desc())
    )
    return [_run_out(r) for r in res.scalars().all()]


@router.post("/runs", response_model=RunOut, status_code=201)
async def create_run(
    body: RunCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _require_hr(user)
    if not _PERIOD_RE.match(body.period):
        raise HTTPException(status_code=422, detail="period must be YYYY-MM")

    existing = await db.execute(
        select(PayrollRun).where(PayrollRun.period == body.period)
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="A run already exists for this period")

    run = PayrollRun(period=body.period, note=body.note, created_by_id=user.id)
    db.add(run)
    await db.flush()

    # Active employees → seed a payslip each from their latest salary record.
    emp_res = await db.execute(
        select(User).where(User.status == "active", User.is_active.is_(True))
    )
    employees = emp_res.scalars().all()

    for emp in employees:
        comp_res = await db.execute(
            select(CompensationRecord)
            .where(
                CompensationRecord.user_id == emp.id,
                CompensationRecord.record_type == "salary",
            )
            .order_by(CompensationRecord.effective_date.desc())
            .limit(1)
        )
        comp = comp_res.scalar_one_or_none()
        base = _monthly(comp.amount, comp.pay_period) if comp else Decimal(0)
        currency = comp.currency if comp else "USD"
        slip = Payslip(
            run_id=run.id,
            user_id=emp.id,
            currency=currency,
            base_salary=base,
            items=[],
        )
        _recalc(slip)
        db.add(slip)

    await db.commit()
    run = await _run_with_slips(db, run.id)
    return _run_out(run)


@router.get("/runs/{run_id}", response_model=dict)
async def get_run(
    run_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _require_hr(user)
    run = await _run_with_slips(db, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    names = await _names_for(db, [s.user_id for s in run.payslips])
    slips = sorted(
        run.payslips, key=lambda s: (names.get(s.user_id) or "").lower()
    )
    return {
        "run": _run_out(run).model_dump(),
        "payslips": [_slip_out(s, names, run.period).model_dump() for s in slips],
    }


@router.patch("/payslips/{slip_id}", response_model=PayslipOut)
async def update_payslip(
    slip_id: uuid.UUID,
    body: PayslipUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _require_hr(user)
    res = await db.execute(
        select(Payslip).where(Payslip.id == slip_id).options(selectinload(Payslip.run))
    )
    slip = res.scalar_one_or_none()
    if not slip:
        raise HTTPException(status_code=404, detail="Payslip not found")
    if slip.run.status == "finalized":
        raise HTTPException(status_code=409, detail="Run is finalized")

    slip.items = [item.model_dump(mode="json") for item in body.items]
    _recalc(slip)
    await db.commit()
    names = await _names_for(db, [slip.user_id])
    return _slip_out(slip, names, slip.run.period)


@router.post("/runs/{run_id}/finalize", response_model=RunOut)
async def finalize_run(
    run_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _require_hr(user)
    run = await _run_with_slips(db, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    run.status = "finalized"
    await db.commit()
    run = await _run_with_slips(db, run_id)
    return _run_out(run)


@router.delete("/runs/{run_id}", status_code=204)
async def delete_run(
    run_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _require_hr(user)
    res = await db.execute(select(PayrollRun).where(PayrollRun.id == run_id))
    run = res.scalar_one_or_none()
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    if run.status == "finalized":
        raise HTTPException(status_code=409, detail="Cannot delete a finalized run")
    await db.delete(run)
    await db.commit()


@router.get("/runs/{run_id}/register.csv")
async def register_csv(
    run_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _require_hr(user)
    run = await _run_with_slips(db, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    names = await _names_for(db, [s.user_id for s in run.payslips])

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["Employee", "Currency", "Base", "Gross", "Deductions", "Net"])
    for s in sorted(run.payslips, key=lambda s: (names.get(s.user_id) or "").lower()):
        writer.writerow([
            names.get(s.user_id) or str(s.user_id),
            s.currency,
            f"{Decimal(str(s.base_salary or 0)):.2f}",
            f"{Decimal(str(s.gross or 0)):.2f}",
            f"{Decimal(str(s.deductions or 0)):.2f}",
            f"{Decimal(str(s.net or 0)):.2f}",
        ])
    buf.seek(0)
    filename = f"payroll-{run.period}.csv"
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/my", response_model=list[PayslipOut])
async def my_payslips(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """An employee's own payslips, from finalized runs only."""
    res = await db.execute(
        select(Payslip, PayrollRun.period)
        .join(PayrollRun, Payslip.run_id == PayrollRun.id)
        .where(Payslip.user_id == user.id, PayrollRun.status == "finalized")
        .order_by(PayrollRun.period.desc())
    )
    names = {user.id: user.display_name}
    return [_slip_out(slip, names, period) for slip, period in res.all()]
