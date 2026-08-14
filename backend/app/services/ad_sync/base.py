"""The contract every ad platform client implements.

Clients fetch and normalise. They never touch the database, convert currency,
or decide what a duplicate is — that is the orchestrator's job. Keeping them
free of those concerns is what makes each one testable against a fixture.
"""
from dataclasses import dataclass
from datetime import date
from decimal import Decimal, InvalidOperation
from typing import Protocol, runtime_checkable

# Mirrors app.api.campaigns.CHANNELS.
CHANNELS = {"facebook", "instagram", "google", "tiktok", "other"}


def to_decimal(value) -> Decimal:
    if value is None:
        return Decimal("0")
    try:
        return Decimal(str(value).strip() or "0")
    except (InvalidOperation, ValueError):
        return Decimal("0")


def to_int(value) -> int:
    """Platforms report counts as float-formatted strings ("12.0")."""
    if value is None:
        return 0
    try:
        return int(float(str(value).strip() or 0))
    except (TypeError, ValueError):
        return 0


def normalise_channel(value: str) -> str:
    channel = (value or "").strip().lower()
    return channel if channel in CHANNELS else "other"


@dataclass(frozen=True)
class NormalizedMetric:
    """One campaign's performance on one channel for one day, as reported."""

    external_campaign_id: str
    campaign_name: str
    campaign_status: str
    channel: str
    date: date
    spend: Decimal
    impressions: int
    clicks: int
    conversions: int
    revenue: Decimal
    currency: str


@runtime_checkable
class AdProvider(Protocol):
    key: str

    async def fetch(
        self, cfg: dict, since: date, until: date
    ) -> list[NormalizedMetric]:
        """Return every row in the window, following pagination to the end."""
        ...

    async def verify(self, cfg: dict) -> dict:
        """Cheap read call. Returns {ok, account_name?, currency?, error?}."""
        ...
