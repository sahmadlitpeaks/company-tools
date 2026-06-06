"""Generate SLA breach / at-risk notifications for open service-desk tickets.

Shared by the manual endpoint and the background scheduler. Idempotent via
per-ticket dedup keys, so re-running won't spam: each milestone (response
breach, resolution due-soon, resolution breach) fires at most one unread
notification per recipient.
"""
from datetime import datetime, timedelta, timezone

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User
from app.models.workplace import Ticket
from app.services.notify import notify_user

# How far ahead of the resolution deadline we warn ("due soon").
AT_RISK_HOURS = 2
OPEN_STATUSES = ("open", "in_progress")


def _aware(dt: datetime | None) -> datetime | None:
    """Treat naive datetimes (e.g. from SQLite) as UTC for safe comparison."""
    if dt is not None and dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


async def run_sla_alerts(db: AsyncSession) -> dict:
    now = datetime.now(timezone.utc)
    soon = now + timedelta(hours=AT_RISK_HOURS)

    tickets = (
        await db.execute(select(Ticket).where(Ticket.status.in_(OPEN_STATUSES)))
    ).scalars().all()
    if not tickets:
        return {"created": 0}

    # Agents to fall back on for unassigned tickets.
    agents = (
        await db.execute(
            select(User.id).where(
                or_(User.is_admin.is_(True), User.role == "manager"),
                User.status == "active",
            )
        )
    ).scalars().all()
    created = 0

    async def _notify(uid, *, title, body, key):
        nonlocal created
        n = await notify_user(
            db, user_id=uid, title=title, body=body, link="/service-desk",
            category="ticket", dedup_key=key,
        )
        if n is not None:
            created += 1

    for t in tickets:
        label = f"#{t.number} · {t.subject}"
        recipients = [t.assignee_id] if t.assignee_id else list(agents)
        recipients = [r for r in recipients if r]
        response_due = _aware(t.sla_response_due)
        resolution_due = _aware(t.sla_resolution_due)

        # First-response SLA breached (no agent reply yet, past response due).
        if t.first_responded_at is None and response_due and response_due < now:
            for uid in recipients:
                await _notify(
                    uid,
                    title=f"Response overdue · #{t.number}",
                    body=f"No first response yet on {label}.",
                    key=f"sla-resp-overdue:{t.id}:{uid}",
                )

        # Resolution SLA: breached, else at-risk.
        if resolution_due:
            if resolution_due < now:
                for uid in recipients:
                    await _notify(
                        uid,
                        title=f"Resolution overdue · #{t.number}",
                        body=f"{label} has passed its resolution SLA.",
                        key=f"sla-res-overdue:{t.id}:{uid}",
                    )
            elif resolution_due <= soon:
                for uid in recipients:
                    await _notify(
                        uid,
                        title=f"Resolution due soon · #{t.number}",
                        body=f"{label} is due within {AT_RISK_HOURS}h.",
                        key=f"sla-res-soon:{t.id}:{uid}",
                    )

    await db.commit()
    return {"created": created}
