from datetime import date, datetime, time, timezone

from fastapi import HTTPException


def received_range(stmt, column, after: date | None, before: date | None):
    """Dates are inclusive UTC calendar days, matching the list filter labels."""
    if after and before and after > before:
        raise HTTPException(status_code=422, detail="From date must be on or before the to date")
    if after:
        stmt = stmt.where(column >= datetime.combine(after, time.min, tzinfo=timezone.utc))
    if before:
        stmt = stmt.where(column <= datetime.combine(before, time.max, tzinfo=timezone.utc))
    return stmt


def search_pattern(value: str) -> str:
    # Search text is literal: '%' and '_' are not user-facing wildcard controls.
    return "%" + value.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
