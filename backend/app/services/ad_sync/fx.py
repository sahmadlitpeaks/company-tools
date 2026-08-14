"""AED conversion from an admin-maintained rate table.

Rates live in app settings as ``fx_rate_<CUR>`` (e.g. ``fx_rate_USD``). AED is
the base and is always 1. An unknown currency is an error, never a 1:1 guess:
treating USD as parity would understate spend by 3.67x while looking entirely
plausible in the UI.
"""
from decimal import Decimal, InvalidOperation

from sqlalchemy.ext.asyncio import AsyncSession

from app.services.app_settings import get_all

FX_PREFIX = "fx_rate_"
BASE_CURRENCY = "AED"


class MissingRateError(Exception):
    """Raised when a platform reports a currency with no configured rate."""

    def __init__(self, currency: str) -> None:
        self.currency = currency
        super().__init__(
            f"No AED exchange rate configured for {currency}. "
            f"Set one in Settings before syncing this account."
        )


async def get_rates(db: AsyncSession) -> dict[str, Decimal]:
    stored = await get_all(db)
    rates: dict[str, Decimal] = {BASE_CURRENCY: Decimal("1")}
    for key, value in stored.items():
        if not key.startswith(FX_PREFIX) or not value:
            continue
        try:
            rate = Decimal(value)
        except InvalidOperation:
            continue  # a malformed rate must not silently become a wrong number
        if rate > 0:
            rates[key[len(FX_PREFIX):].upper()] = rate
    return rates


def convert(
    amount: Decimal, currency: str | None, rates: dict[str, Decimal]
) -> tuple[Decimal, Decimal]:
    """Return (amount in AED, rate applied). Raises MissingRateError."""
    code = (currency or BASE_CURRENCY).upper()
    rate = rates.get(code)
    if rate is None:
        raise MissingRateError(code)
    return (Decimal(amount) * rate).quantize(Decimal("0.01")), rate
