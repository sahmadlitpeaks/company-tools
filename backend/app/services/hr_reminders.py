"""HR automation engine — scheduled, idempotent people reminders.

Generates in-app notifications (which fan out to email/Slack/Teams when
``NOTIFY_OUTBOUND`` is on) for the time-sensitive things an HRIS should chase
on its own instead of waiting for someone to click a button:

  * HR document / visa / passport expiry
  * Probation periods ending
  * Fixed-term contracts ending
  * Review-cycle deadlines (nudges the assigned reviewer)
  * Birthdays
  * Work anniversaries
  * Unsubmitted timesheets for the week that just ended

Shared by the background scheduler and the manual "Run now" endpoint. Every
alert carries a stable ``dedup_key`` so re-running never spams: each milestone
fires at most one unread notification per recipient.
"""
import json
import logging
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.hr import HrDocument, Review, ReviewCycle
from app.models.timekeeping import Timesheet
from app.models.user import User
from app.services.app_settings import set_many
from app.services.notify import notify_user

log = logging.getLogger("hr_reminders")

# Persisted under these app-settings keys.
CONFIG_KEY = "hr_reminders_config"
LAST_RUN_KEY = "hr_reminders_last_run"
LAST_RESULT_KEY = "hr_reminders_last_result"

# Catalogue of reminder types, with their default lead times (in days) and the
# label/description shown in the admin UI. ``lead_days`` means "fire when the
# event is within N days from now"; for birthday/anniversary/timesheet it is the
# number of days of advance notice (0 = on the day).
REMINDER_TYPES: dict[str, dict] = {
    "doc_expiry": {
        "label": "Document & visa expiry",
        "description": "Contracts, visas, passports and IDs nearing their expiry date.",
        "default_lead": 30,
    },
    "probation_end": {
        "label": "Probation ending",
        "description": "Probation periods coming to an end — time to confirm or extend.",
        "default_lead": 14,
    },
    "contract_end": {
        "label": "Contract ending",
        "description": "Fixed-term contracts approaching their end date.",
        "default_lead": 30,
    },
    "review_due": {
        "label": "Review-cycle deadlines",
        "description": "Open review cycles nearing their due date with reviews still pending.",
        "default_lead": 7,
    },
    "birthday": {
        "label": "Birthdays",
        "description": "Upcoming employee birthdays (notifies the manager and HR).",
        "default_lead": 0,
    },
    "work_anniversary": {
        "label": "Work anniversaries",
        "description": "Employment milestones (notifies the manager and HR).",
        "default_lead": 0,
    },
    "timesheet": {
        "label": "Unsubmitted timesheets",
        "description": "Nudges people who haven't submitted last week's timesheet.",
        "default_lead": 0,
    },
}


def default_config() -> dict:
    return {
        k: {"enabled": True, "lead_days": spec["default_lead"]}
        for k, spec in REMINDER_TYPES.items()
    }


async def get_config(db: AsyncSession) -> dict:
    """Effective reminder config: stored values merged over the defaults."""
    cfg = default_config()
    row = await _get_setting(db, CONFIG_KEY)
    if row:
        try:
            stored = json.loads(row)
            for key, val in stored.items():
                if key in cfg and isinstance(val, dict):
                    cfg[key] = {
                        "enabled": bool(val.get("enabled", cfg[key]["enabled"])),
                        "lead_days": int(val.get("lead_days", cfg[key]["lead_days"])),
                    }
        except (ValueError, TypeError):
            pass
    return cfg


async def set_config(db: AsyncSession, incoming: dict) -> dict:
    """Validate + persist the reminder config; returns the effective config."""
    cfg = await get_config(db)
    for key, val in (incoming or {}).items():
        if key not in REMINDER_TYPES or not isinstance(val, dict):
            continue
        lead = val.get("lead_days", cfg[key]["lead_days"])
        try:
            lead = max(0, min(365, int(lead)))
        except (ValueError, TypeError):
            lead = cfg[key]["lead_days"]
        cfg[key] = {"enabled": bool(val.get("enabled", cfg[key]["enabled"])), "lead_days": lead}
    await set_many(db, {CONFIG_KEY: json.dumps(cfg)})
    return cfg


async def get_status(db: AsyncSession) -> dict:
    """Config + catalogue + last-run metadata for the admin UI."""
    cfg = await get_config(db)
    last_run = await _get_setting(db, LAST_RUN_KEY)
    last_result_raw = await _get_setting(db, LAST_RESULT_KEY)
    last_result = None
    if last_result_raw:
        try:
            last_result = json.loads(last_result_raw)
        except ValueError:
            last_result = None
    return {
        "config": cfg,
        "catalogue": [
            {"key": k, "label": v["label"], "description": v["description"]}
            for k, v in REMINDER_TYPES.items()
        ],
        "last_run": last_run,
        "last_result": last_result,
    }


# --------------------------------------------------------------------------
# Runner
# --------------------------------------------------------------------------
async def run_hr_reminders(db: AsyncSession) -> dict:
    """Generate all enabled HR reminders. Idempotent; safe to run repeatedly."""
    cfg = await get_config(db)
    today = date.today()
    by_type: dict[str, int] = {}

    # Recipients for HR-wide alerts: active admins.
    hr_ids = (
        await db.execute(
            select(User.id).where(User.is_admin.is_(True), User.status == "active")
        )
    ).scalars().all()

    def enabled(key: str) -> bool:
        return cfg.get(key, {}).get("enabled", False)

    def lead(key: str) -> int:
        return int(cfg.get(key, {}).get("lead_days", 0))

    created = 0

    async def emit(uid, *, title, body, link, category, key) -> None:
        nonlocal created
        if not uid:
            return
        n = await notify_user(
            db, user_id=uid, title=title, body=body, link=link,
            category=category, dedup_key=key,
        )
        if n is not None:
            created += 1
            by_type[_current] = by_type.get(_current, 0) + 1

    # ---- 1. Document / visa / passport expiry ----
    _current = "doc_expiry"
    if enabled(_current):
        window = today + timedelta(days=lead(_current))
        docs = (
            await db.execute(
                select(HrDocument).where(
                    HrDocument.expiry_date.is_not(None),
                    HrDocument.expiry_date <= window,
                )
            )
        ).scalars().all()
        for d in docs:
            days = (d.expiry_date - today).days
            when = "expired" if days < 0 else f"expires in {days} day(s)"
            cat = d.category.replace("_", " ")
            owner = await db.get(User, d.user_id)
            owner_name = (owner.display_name if owner else None) or "an employee"
            # HR team + the document owner.
            for uid in {*hr_ids, d.user_id}:
                await emit(
                    uid,
                    title=f"{cat.title()} {when}",
                    body=f"{d.title} for {owner_name} {when} ({d.expiry_date.isoformat()}).",
                    link=f"/people/{d.user_id}",
                    category="hr_document",
                    key=f"hrdoc-expiry:{d.id}:{d.expiry_date.isoformat()}",
                )

    # ---- 2. Probation ending ----
    _current = "probation_end"
    if enabled(_current):
        window = today + timedelta(days=lead(_current))
        people = (
            await db.execute(
                select(User).where(
                    User.probation_end_date.is_not(None),
                    User.probation_end_date >= today,
                    User.probation_end_date <= window,
                    User.status == "active",
                )
            )
        ).scalars().all()
        for u in people:
            days = (u.probation_end_date - today).days
            for uid in {*hr_ids, *( [u.manager_id] if u.manager_id else [] )}:
                await emit(
                    uid,
                    title="Probation ending soon",
                    body=f"{u.display_name or 'An employee'}'s probation ends in {days} day(s) "
                         f"({u.probation_end_date.isoformat()}). Confirm or extend.",
                    link=f"/people/{u.id}",
                    category="hr_probation",
                    key=f"probation-end:{u.id}:{u.probation_end_date.isoformat()}",
                )

    # ---- 3. Contract ending ----
    _current = "contract_end"
    if enabled(_current):
        window = today + timedelta(days=lead(_current))
        people = (
            await db.execute(
                select(User).where(
                    User.contract_end_date.is_not(None),
                    User.contract_end_date >= today,
                    User.contract_end_date <= window,
                    User.status == "active",
                )
            )
        ).scalars().all()
        for u in people:
            days = (u.contract_end_date - today).days
            for uid in {*hr_ids, *( [u.manager_id] if u.manager_id else [] )}:
                await emit(
                    uid,
                    title="Contract ending soon",
                    body=f"{u.display_name or 'An employee'}'s contract ends in {days} day(s) "
                         f"({u.contract_end_date.isoformat()}).",
                    link=f"/people/{u.id}",
                    category="hr_contract",
                    key=f"contract-end:{u.id}:{u.contract_end_date.isoformat()}",
                )

    # ---- 4. Review-cycle deadlines ----
    _current = "review_due"
    if enabled(_current):
        window = today + timedelta(days=lead(_current))
        cycles = (
            await db.execute(
                select(ReviewCycle).where(
                    ReviewCycle.status == "open",
                    ReviewCycle.due_date.is_not(None),
                    ReviewCycle.due_date <= window,
                )
            )
        ).scalars().all()
        for c in cycles:
            overdue = c.due_date < today
            pending = (
                await db.execute(
                    select(Review).where(
                        Review.cycle_id == c.id,
                        Review.status == "pending",
                        Review.reviewer_id.is_not(None),
                    )
                )
            ).scalars().all()
            for r in pending:
                subject = await db.get(User, r.user_id)
                subject_name = (subject.display_name if subject else None) or "an employee"
                verb = "is overdue" if overdue else f"is due {c.due_date.isoformat()}"
                await emit(
                    r.reviewer_id,
                    title=f"Review {verb.split()[0]} · {c.name}",
                    body=f"Your review of {subject_name} for {c.name} {verb}.",
                    link="/performance",
                    category="hr_review",
                    key=f"review-due:{r.id}:{c.due_date.isoformat()}",
                )

    # ---- 5. Birthdays & 6. Work anniversaries (month/day match) ----
    for _current, attr, title, body_fmt, cat in (
        ("birthday", "date_of_birth", "Upcoming birthday",
         "{name}'s birthday is on {when}.", "hr_birthday"),
        ("work_anniversary", "hire_date", "Work anniversary",
         "{name} {years}with the company on {when}.", "hr_anniversary"),
    ):
        if not enabled(_current):
            continue
        lead_days = lead(_current)
        people = (
            await db.execute(
                select(User).where(
                    getattr(User, attr).is_not(None), User.status == "active"
                )
            )
        ).scalars().all()
        for u in people:
            d0 = getattr(u, attr)
            occ = _next_occurrence(d0, today)
            if occ is None or (occ - today).days > lead_days:
                continue
            name = u.display_name or "An employee"
            if _current == "work_anniversary":
                yrs = occ.year - d0.year
                years = f"marks {yrs} year(s) " if yrs > 0 else "joined "
                body = body_fmt.format(name=name, years=years, when=occ.isoformat())
            else:
                body = body_fmt.format(name=name, when=occ.isoformat())
            for uid in {*hr_ids, *( [u.manager_id] if u.manager_id else [] )}:
                await emit(
                    uid, title=title, body=body, link=f"/people/{u.id}",
                    category=cat, key=f"{_current}:{u.id}:{occ.isoformat()}",
                )

    # ---- 7. Unsubmitted timesheets (for the week that just ended) ----
    _current = "timesheet"
    if enabled(_current):
        # Monday of last week.
        this_monday = today - timedelta(days=today.weekday())
        last_monday = this_monday - timedelta(days=7)
        open_sheets = (
            await db.execute(
                select(Timesheet).where(
                    Timesheet.week_start == last_monday,
                    Timesheet.status == "open",
                )
            )
        ).scalars().all()
        for ts in open_sheets:
            await emit(
                ts.user_id,
                title="Timesheet not submitted",
                body=f"Your timesheet for the week of {last_monday.isoformat()} "
                     f"is still open. Please review and submit it.",
                link="/time",
                category="hr_timesheet",
                key=f"timesheet-reminder:{ts.user_id}:{last_monday.isoformat()}",
            )

    await db.commit()

    # Record run metadata (best-effort, separate commit).
    result = {
        "created": created,
        "by_type": by_type,
        "at": datetime.now(timezone.utc).isoformat(),
    }
    try:
        await set_many(
            db,
            {
                LAST_RUN_KEY: result["at"],
                LAST_RESULT_KEY: json.dumps(result),
            },
        )
    except Exception as e:  # noqa: BLE001
        log.warning("failed to record hr_reminders run: %s", e)

    return result


# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------
async def _get_setting(db: AsyncSession, key: str) -> str | None:
    from app.models.app_setting import AppSetting

    row = await db.get(AppSetting, key)
    return row.value if row else None


def _next_occurrence(anchor: date, today: date) -> date | None:
    """The next month/day occurrence of ``anchor`` on or after ``today``.

    Handles Feb 29 by falling back to Feb 28 in non-leap years.
    """
    if anchor is None:
        return None

    def _on(year: int) -> date:
        try:
            return date(year, anchor.month, anchor.day)
        except ValueError:
            return date(year, anchor.month, 28)

    this_year = _on(today.year)
    return this_year if this_year >= today else _on(today.year + 1)
