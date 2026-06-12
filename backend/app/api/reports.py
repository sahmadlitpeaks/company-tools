"""HR reporting & analytics — a standard report library plus a simple employee
report builder, with CSV export. Gated by the `hr` module."""
import csv
import io
import uuid
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.core.database import get_db
from app.models.department import Department
from app.models.hr import CompensationRecord
from app.models.timekeeping import TimeEntry
from app.models.user import User
from app.models.workplace import ApprovalRequest
from app.schemas.report import (
    CatalogItem,
    EmployeeQuery,
    ReportColumn,
    ReportOut,
)

router = APIRouter(prefix="/reports", tags=["reports"])


def _col(key: str, label: str) -> ReportColumn:
    return ReportColumn(key=key, label=label)


def _weekdays(start: date, end: date) -> int:
    if end < start:
        return 0
    n, cur = 0, start
    while cur <= end:
        if cur.weekday() < 5:
            n += 1
        cur += timedelta(days=1)
    return n


async def _dept_names(db: AsyncSession) -> dict:
    rows = (await db.execute(select(Department.id, Department.name))).all()
    return {r[0]: r[1] for r in rows}


# ---- Report builders -----------------------------------------------------
async def headcount_by_department(db: AsyncSession) -> tuple[list[ReportColumn], list[dict]]:
    users = (await db.execute(select(User).where(User.status == "active"))).scalars().all()
    names = await _dept_names(db)
    counts: dict[str, int] = {}
    for u in users:
        label = names.get(u.department_id, "Unassigned")
        counts[label] = counts.get(label, 0) + 1
    rows = [{"department": k, "headcount": v} for k, v in sorted(counts.items(), key=lambda x: -x[1])]
    return [_col("department", "Department"), _col("headcount", "Headcount")], rows


async def headcount_by_type(db: AsyncSession) -> tuple[list[ReportColumn], list[dict]]:
    users = (await db.execute(select(User).where(User.status == "active"))).scalars().all()
    counts: dict[str, int] = {}
    for u in users:
        label = (u.employment_type or "unspecified").replace("_", " ")
        counts[label] = counts.get(label, 0) + 1
    rows = [{"employment_type": k, "headcount": v} for k, v in sorted(counts.items(), key=lambda x: -x[1])]
    return [_col("employment_type", "Employment type"), _col("headcount", "Headcount")], rows


async def joiners_by_month(db: AsyncSession) -> tuple[list[ReportColumn], list[dict]]:
    today = date.today()
    users = (await db.execute(select(User).where(User.hire_date.is_not(None)))).scalars().all()
    buckets: dict[str, int] = {}
    start = (today.replace(day=1) - timedelta(days=365)).replace(day=1)
    for u in users:
        if u.hire_date and u.hire_date >= start:
            key = u.hire_date.strftime("%Y-%m")
            buckets[key] = buckets.get(key, 0) + 1
    rows = [{"month": k, "joiners": buckets.get(k, 0)} for k in _last_12_months(today)]
    return [_col("month", "Month"), _col("joiners", "Joiners")], rows


def _last_12_months(today: date) -> list[str]:
    out = []
    y, m = today.year, today.month
    for _ in range(12):
        out.append(f"{y:04d}-{m:02d}")
        m -= 1
        if m == 0:
            m = 12
            y -= 1
    return list(reversed(out))


async def tenure_distribution(db: AsyncSession) -> tuple[list[ReportColumn], list[dict]]:
    today = date.today()
    users = (await db.execute(select(User).where(User.status == "active"))).scalars().all()
    buckets = {"< 1 year": 0, "1–3 years": 0, "3–5 years": 0, "5+ years": 0, "Unknown": 0}
    for u in users:
        if not u.hire_date:
            buckets["Unknown"] += 1
            continue
        yrs = (today - u.hire_date).days / 365.25
        if yrs < 1:
            buckets["< 1 year"] += 1
        elif yrs < 3:
            buckets["1–3 years"] += 1
        elif yrs < 5:
            buckets["3–5 years"] += 1
        else:
            buckets["5+ years"] += 1
    rows = [{"tenure": k, "headcount": v} for k, v in buckets.items()]
    return [_col("tenure", "Tenure"), _col("headcount", "Headcount")], rows


async def leave_taken_ytd(db: AsyncSession) -> tuple[list[ReportColumn], list[dict]]:
    year = date.today().year
    leaves = (
        await db.execute(
            select(ApprovalRequest).where(
                ApprovalRequest.type == "leave",
                ApprovalRequest.status == "approved",
                ApprovalRequest.start_date.is_not(None),
            )
        )
    ).scalars().all()
    used: dict[uuid.UUID, int] = {}
    for lv in leaves:
        if lv.start_date and lv.start_date.year == year and lv.requester_id:
            used[lv.requester_id] = used.get(lv.requester_id, 0) + _weekdays(
                lv.start_date, lv.end_date or lv.start_date
            )
    users = {u.id: u for u in (await db.execute(select(User))).scalars().all()}
    rows = sorted(
        ({"employee": (users[uid].display_name if uid in users else "—"), "days": d} for uid, d in used.items()),
        key=lambda r: -r["days"],
    )
    return [_col("employee", "Employee"), _col("days", "Days taken (YTD)")], rows


async def attendance_hours_month(db: AsyncSession) -> tuple[list[ReportColumn], list[dict]]:
    today = date.today()
    start = today.replace(day=1)
    entries = (
        await db.execute(select(TimeEntry).where(TimeEntry.work_date >= start))
    ).scalars().all()
    mins: dict[uuid.UUID, int] = {}
    for e in entries:
        mins[e.user_id] = mins.get(e.user_id, 0) + e.minutes
    users = {u.id: u for u in (await db.execute(select(User))).scalars().all()}
    rows = sorted(
        ({"employee": (users[uid].display_name if uid in users else "—"),
          "hours": round(m / 60, 1)} for uid, m in mins.items()),
        key=lambda r: -r["hours"],
    )
    return [_col("employee", "Employee"), _col("hours", f"Hours ({today:%B})")], rows


async def compensation_current(db: AsyncSession) -> tuple[list[ReportColumn], list[dict]]:
    recs = (
        await db.execute(
            select(CompensationRecord)
            .where(CompensationRecord.record_type == "salary")
            .order_by(CompensationRecord.effective_date.desc())
        )
    ).scalars().all()
    latest: dict[uuid.UUID, CompensationRecord] = {}
    for r in recs:
        latest.setdefault(r.user_id, r)
    users = {u.id: u for u in (await db.execute(select(User))).scalars().all()}
    rows = []
    for uid, r in latest.items():
        amt = float(r.amount)
        annual = amt * 12 if r.pay_period == "monthly" else amt * 2080 if r.pay_period == "hourly" else amt
        rows.append({
            "employee": users[uid].display_name if uid in users else "—",
            "amount": amt, "period": r.pay_period, "currency": r.currency,
            "annualised": round(annual, 2),
        })
    rows.sort(key=lambda r: -r["annualised"])
    return (
        [_col("employee", "Employee"), _col("amount", "Amount"), _col("period", "Period"),
         _col("currency", "Currency"), _col("annualised", "Annualised")],
        rows,
    )


_REGISTRY: dict[str, dict] = {
    "headcount_by_department": {"title": "Headcount by department", "group": "Workforce", "sensitive": False, "fn": headcount_by_department, "description": "Active employees per department."},
    "headcount_by_type": {"title": "Headcount by employment type", "group": "Workforce", "sensitive": False, "fn": headcount_by_type, "description": "Active employees by employment type."},
    "joiners_by_month": {"title": "Joiners by month", "group": "Workforce", "sensitive": False, "fn": joiners_by_month, "description": "New hires per month, last 12 months."},
    "tenure_distribution": {"title": "Tenure distribution", "group": "Workforce", "sensitive": False, "fn": tenure_distribution, "description": "Active employees grouped by length of service."},
    "leave_taken_ytd": {"title": "Leave taken (YTD)", "group": "Time off", "sensitive": False, "fn": leave_taken_ytd, "description": "Approved leave days this year, by employee."},
    "attendance_hours_month": {"title": "Attendance hours (this month)", "group": "Time", "sensitive": False, "fn": attendance_hours_month, "description": "Logged hours this month, by employee."},
    "compensation_current": {"title": "Current compensation", "group": "Compensation", "sensitive": True, "fn": compensation_current, "description": "Latest salary per employee (sensitive)."},
}


@router.get("/catalog", response_model=list[CatalogItem])
async def catalog(_: User = Depends(get_current_user)):
    return [
        CatalogItem(key=k, title=v["title"], description=v["description"], group=v["group"], sensitive=v["sensitive"])
        for k, v in _REGISTRY.items()
    ]


async def _run(db: AsyncSession, key: str) -> ReportOut:
    spec = _REGISTRY.get(key)
    if not spec:
        raise HTTPException(status_code=404, detail="Unknown report")
    columns, rows = await spec["fn"](db)
    return ReportOut(key=key, title=spec["title"], columns=columns, rows=rows, generated_at=datetime.now(timezone.utc))


@router.get("/run/{key}", response_model=ReportOut)
async def run_report(key: str, db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)):
    return await _run(db, key)


def _csv(columns: list[ReportColumn], rows: list[dict], filename: str) -> StreamingResponse:
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=[c.key for c in columns])
    w.writerow({c.key: c.label for c in columns})
    for r in rows:
        w.writerow({c.key: r.get(c.key, "") for c in columns})
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]), media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/run/{key}/export.csv")
async def export_report(key: str, db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)):
    rep = await _run(db, key)
    return _csv(rep.columns, rep.rows, f"{key}.csv")


# ---- Employee report builder --------------------------------------------
_EMP_FIELDS = {
    "display_name": ("Name", lambda u, d: u.display_name),
    "email": ("Email", lambda u, d: u.email),
    "job_title": ("Job title", lambda u, d: u.job_title),
    "department": ("Department (access)", lambda u, d: d.get(u.department_id)),
    "hr_department": ("Department (label)", lambda u, d: u.department),
    "employment_type": ("Employment type", lambda u, d: u.employment_type),
    "status": ("Status", lambda u, d: u.status),
    "role": ("Role", lambda u, d: u.role),
    "hire_date": ("Hire date", lambda u, d: u.hire_date.isoformat() if u.hire_date else None),
    "office_location": ("Office", lambda u, d: u.office_location),
    "mobile_phone": ("Mobile", lambda u, d: u.mobile_phone),
    "manager": ("Manager", lambda u, d: u.manager_name),
}


@router.get("/employees/fields", response_model=list[ReportColumn])
async def employee_fields(_: User = Depends(get_current_user)):
    return [ReportColumn(key=k, label=v[0]) for k, v in _EMP_FIELDS.items()]


@router.post("/employees", response_model=ReportOut)
async def employee_report(
    payload: EmployeeQuery,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    cols = [c for c in payload.columns if c in _EMP_FIELDS] or ["display_name", "email", "department", "job_title"]
    stmt = select(User)
    if payload.status:
        stmt = stmt.where(User.status == payload.status)
    if payload.employment_type:
        stmt = stmt.where(User.employment_type == payload.employment_type)
    if payload.department_id:
        stmt = stmt.where(User.department_id == uuid.UUID(payload.department_id))
    users = (await db.execute(stmt.order_by(User.display_name))).scalars().all()
    dnames = await _dept_names(db)
    rows = [{c: _EMP_FIELDS[c][1](u, dnames) for c in cols} for u in users]
    return ReportOut(
        key="employees", title="Employee report",
        columns=[ReportColumn(key=c, label=_EMP_FIELDS[c][0]) for c in cols],
        rows=rows, generated_at=datetime.now(timezone.utc),
    )
