"""Business-hours SLA maths for the service desk.

SLA targets are expressed in *working* hours (not wall-clock): a 4-hour target
raised at 17:00 on a Thursday lands the next working morning, skipping the
weekend and any configured public holidays. Work week, hours, timezone and
holidays are admin-configurable via app settings, with sensible UAE defaults
(Sun–Thu, 09:00–18:00, Asia/Dubai).
"""
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta, timezone

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.workplace import Ticket
from app.services.app_settings import get_all

# First-response and resolution targets in *working hours* by priority.
SLA_HOURS: dict[str, tuple[float, float]] = {
    "urgent": (1, 4),
    "high": (4, 24),
    "normal": (8, 72),
    "low": (24, 120),
}

_DAY_NUM = {"mon": 0, "tue": 1, "wed": 2, "thu": 3, "fri": 4, "sat": 5, "sun": 6}
_DEFAULT_WORKDAYS = {6, 0, 1, 2, 3}  # Sun–Thu


@dataclass
class SLAConfig:
    start_h: int = 9
    end_h: int = 18
    tz_offset: int = 4  # hours east of UTC (Asia/Dubai, no DST)
    workdays: set[int] = field(default_factory=lambda: set(_DEFAULT_WORKDAYS))
    holidays: set[date] = field(default_factory=set)

    @property
    def tz(self) -> timezone:
        return timezone(timedelta(hours=self.tz_offset))

    def is_workday(self, d: date) -> bool:
        return d.weekday() in self.workdays and d not in self.holidays


def _parse_workdays(raw: str | None) -> set[int]:
    if not raw:
        return set(_DEFAULT_WORKDAYS)
    days = {_DAY_NUM[p.strip().lower()[:3]] for p in raw.split(",") if p.strip()[:3].lower() in _DAY_NUM}
    return days or set(_DEFAULT_WORKDAYS)


def _parse_holidays(raw: str | None) -> set[date]:
    out: set[date] = set()
    for part in (raw or "").split(","):
        part = part.strip()
        if not part:
            continue
        try:
            out.add(date.fromisoformat(part))
        except ValueError:
            continue
    return out


async def get_sla_config(db: AsyncSession) -> SLAConfig:
    s = await get_all(db)

    def _int(key: str, default: int) -> int:
        try:
            return int(s[key])
        except (KeyError, ValueError, TypeError):
            return default

    return SLAConfig(
        start_h=_int("sla_work_start", 9),
        end_h=_int("sla_work_end", 18),
        tz_offset=_int("sla_tz_offset", 4),
        workdays=_parse_workdays(s.get("sla_workdays")),
        holidays=_parse_holidays(s.get("sla_holidays")),
    )


def _next_work_start(d: date, cfg: SLAConfig) -> datetime:
    """Start-of-work on the first working day on/after `d`."""
    while not cfg.is_workday(d):
        d += timedelta(days=1)
    return datetime.combine(d, time(cfg.start_h), cfg.tz)


def business_deadline(start_utc: datetime, hours: float, cfg: SLAConfig) -> datetime:
    """Add `hours` working hours to `start_utc`, returning a UTC datetime."""
    if start_utc.tzinfo is None:
        start_utc = start_utc.replace(tzinfo=timezone.utc)
    cur = start_utc.astimezone(cfg.tz)
    remaining = timedelta(hours=hours)

    # Anchor the cursor to the next valid working moment.
    if not cfg.is_workday(cur.date()):
        cur = _next_work_start(cur.date(), cfg)
    else:
        day_start = datetime.combine(cur.date(), time(cfg.start_h), cfg.tz)
        day_end = datetime.combine(cur.date(), time(cfg.end_h), cfg.tz)
        if cur < day_start:
            cur = day_start
        elif cur >= day_end:
            cur = _next_work_start(cur.date() + timedelta(days=1), cfg)

    while remaining > timedelta(0):
        day_end = datetime.combine(cur.date(), time(cfg.end_h), cfg.tz)
        avail = day_end - cur
        if remaining <= avail:
            cur = cur + remaining
            remaining = timedelta(0)
        else:
            remaining -= avail
            cur = _next_work_start(cur.date() + timedelta(days=1), cfg)
    return cur.astimezone(timezone.utc)


async def apply_sla(db: AsyncSession, ticket: Ticket, base: datetime | None = None) -> None:
    """(Re)compute a ticket's SLA due dates from its priority, in working hours."""
    cfg = await get_sla_config(db)
    base = base or datetime.now(timezone.utc)
    resp_h, res_h = SLA_HOURS.get(ticket.priority, SLA_HOURS["normal"])
    ticket.sla_response_due = business_deadline(base, resp_h, cfg)
    ticket.sla_resolution_due = business_deadline(base, res_h, cfg)
