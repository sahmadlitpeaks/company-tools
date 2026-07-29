"""Missing-time reminders, aware of schedules, leave and public holidays."""
from datetime import date, timedelta

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.timekeeping import _holidays, _schedule_for
from app.models.timekeeping import TimeEntry
from app.models.user import User
from app.models.workplace import ApprovalRequest
from app.services.notify import notify_user


async def run_time_reminders(db: AsyncSession) -> dict[str, int]:
    target_day = date.today() - timedelta(days=1)
    holidays = await _holidays(db)
    if target_day in holidays:
        return {"created": 0}
    users = (
        await db.execute(select(User).where(User.status == "active"))
    ).scalars().all()
    created = 0
    for user in users:
        sched = await _schedule_for(db, user)
        workdays = sched.workdays if sched and sched.workdays is not None else [0, 1, 2, 3, 4]
        if target_day.weekday() not in workdays:
            continue
        leave = (
            await db.execute(
                select(ApprovalRequest.id).where(
                    ApprovalRequest.type == "leave",
                    ApprovalRequest.status == "approved",
                    ApprovalRequest.requester_id == user.id,
                    ApprovalRequest.start_date <= target_day,
                    or_(
                        ApprovalRequest.end_date.is_(None),
                        ApprovalRequest.end_date >= target_day,
                    ),
                )
            )
        ).first()
        if leave:
            continue
        has_entry = (
            await db.execute(
                select(TimeEntry.id).where(
                    TimeEntry.user_id == user.id,
                    TimeEntry.work_date == target_day,
                )
            )
        ).first()
        if has_entry:
            continue
        row = await notify_user(
            db,
            user_id=user.id,
            title="Missing time entry",
            body=f"No working time was recorded for {target_day.isoformat()}. Add time or request a correction.",
            link="/time",
            category="attendance",
            dedup_key=f"missing-time:{user.id}:{target_day.isoformat()}",
        )
        created += int(row is not None)
    await db.commit()
    return {"created": created}
