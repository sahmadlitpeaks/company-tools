"""Shared subscription helpers: cost normalisation and per-person resolution."""
import uuid
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.subscription import Subscription, SubscriptionSeat
from app.models.user import User

# Multiplier to convert a billing cycle into a monthly figure.
_CYCLE_TO_MONTHLY = {
    "monthly": Decimal("1"),
    "quarterly": Decimal("1") / Decimal("3"),
    "annual": Decimal("1") / Decimal("12"),
    "weekly": Decimal("52") / Decimal("12"),
    "one_time": Decimal("0"),
}


def monthly_cost(sub: Subscription, active_seats: int) -> Decimal | None:
    """Recurring spend normalised to a month (None if no cost recorded)."""
    if sub.cost is None:
        return None
    base = Decimal(sub.cost)
    total = base * active_seats if sub.cost_type == "per_seat" else base
    factor = _CYCLE_TO_MONTHLY.get(sub.billing_cycle, Decimal("1"))
    return (total * factor).quantize(Decimal("0.01"))


async def person_subscriptions(db: AsyncSession, user: User) -> list[dict]:
    """Every subscription a person is covered by, with the reason.

    Returns dicts: {subscription, seat, source} where source is
    ``seat`` (personal, revocable), ``department`` or ``company``.
    """
    out: list[dict] = []
    # Personal seats (active or revoked — caller filters as needed).
    seats = (
        await db.execute(
            select(SubscriptionSeat)
            .where(SubscriptionSeat.user_id == user.id)
            .join(Subscription, Subscription.id == SubscriptionSeat.subscription_id)
        )
    ).scalars().all()
    seen: set[uuid.UUID] = set()
    for seat in seats:
        sub = await db.get(Subscription, seat.subscription_id)
        if sub:
            out.append({"subscription": sub, "seat": seat, "source": "seat"})
            seen.add(sub.id)
    # Department-wide and company-wide subscriptions covering this person.
    stmt = select(Subscription).where(Subscription.scope == "company")
    company = (await db.execute(stmt)).scalars().all()
    for sub in company:
        if sub.id not in seen:
            out.append({"subscription": sub, "seat": None, "source": "company"})
            seen.add(sub.id)
    if user.department_id:
        dept_subs = (
            await db.execute(
                select(Subscription).where(
                    Subscription.scope == "department",
                    Subscription.department_id == user.department_id,
                )
            )
        ).scalars().all()
        for sub in dept_subs:
            if sub.id not in seen:
                out.append({"subscription": sub, "seat": None, "source": "department"})
                seen.add(sub.id)
    return out
