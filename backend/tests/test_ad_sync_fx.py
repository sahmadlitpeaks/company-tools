from decimal import Decimal

import pytest

from app.core.database import AsyncSessionLocal
from app.services.ad_sync.fx import (
    BASE_CURRENCY,
    MissingRateError,
    convert,
    get_rates,
)
from app.services.app_settings import set_many


def test_base_currency_converts_one_to_one():
    got, rate = convert(Decimal("10.00"), "AED", {BASE_CURRENCY: Decimal("1")})
    assert got == Decimal("10.00")
    assert rate == Decimal("1")


def test_usd_converts_at_the_configured_rate():
    rates = {BASE_CURRENCY: Decimal("1"), "USD": Decimal("3.6725")}
    got, rate = convert(Decimal("100.00"), "USD", rates)
    assert got == Decimal("367.25")
    assert rate == Decimal("3.6725")


def test_unknown_currency_raises_rather_than_assuming_parity():
    """A silent 1:1 on a USD account understates spend 3.67x and looks plausible."""
    with pytest.raises(MissingRateError):
        convert(Decimal("100.00"), "EUR", {BASE_CURRENCY: Decimal("1")})


def test_missing_currency_is_treated_as_base():
    got, _ = convert(Decimal("5.00"), None, {BASE_CURRENCY: Decimal("1")})
    assert got == Decimal("5.00")


@pytest.mark.asyncio
async def test_get_rates_reads_settings_and_always_includes_base(client):
    async with AsyncSessionLocal() as db:
        await set_many(db, {"fx_rate_USD": "3.6725", "fx_rate_GBP": "4.65"})
        rates = await get_rates(db)
    assert rates[BASE_CURRENCY] == Decimal("1")
    assert rates["USD"] == Decimal("3.6725")
    assert rates["GBP"] == Decimal("4.65")


@pytest.mark.asyncio
async def test_get_rates_ignores_malformed_values(client):
    async with AsyncSessionLocal() as db:
        await set_many(db, {"fx_rate_XXX": "not-a-number"})
        rates = await get_rates(db)
    assert "XXX" not in rates
