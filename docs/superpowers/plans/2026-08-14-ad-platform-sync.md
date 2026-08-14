# Ad Platform Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pull campaign performance from Meta, Google Ads and TikTok into Campaign Studio automatically, converted to AED, and display it.

**Architecture:** A new `backend/app/services/ad_sync/` package holds one client per platform behind a shared `AdProvider` protocol. Clients return normalised rows and know nothing about the database. A provider-agnostic orchestrator converts currency, upserts campaigns and metrics, and records each run. Triggered by an admin endpoint and a nightly job in the existing in-process scheduler.

**Tech Stack:** FastAPI, SQLAlchemy 2 async, Alembic, PostgreSQL (SQLite in tests), httpx, Pydantic v2, React 19 + Vite + Tailwind v4 + shadcn `base-lyra`, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-14-ad-platform-sync-design.md`

## Global Constraints

- Current Alembic head is `h3c4d5e6f7a8`. The new revision must set `down_revision = "h3c4d5e6f7a8"`. There must remain exactly one head.
- Tests run against **SQLite** via `Base.metadata.create_all` (see `backend/tests/conftest.py:32`), not via migrations. Every index and constraint must therefore be declared on the model with **both** `postgresql_where=` and `sqlite_where=`, or tests will not exercise what production has.
- No live HTTP in the test suite. All provider clients are tested through a stubbed `httpx` transport.
- Base currency is `AED`. Never fall back to a 1:1 rate for an unknown currency — raise and fail that provider's run.
- Sync writes only rows with `source='sync'`. It must never read, modify or delete `manual` or `csv` rows.
- Frontend: import primitives from `@/components/ui/<component>`; no new wrappers in `frontend/src/components/ui.tsx`; semantic tokens only; square surfaces (no rounded cards/controls/tables/badges); no native `<select>`, `window.alert`, `window.confirm`.
- Icons inside buttons use `data-icon="inline-start"` / `data-icon="inline-end"` with no size classes.
- Every page works at desktop and Pixel 5 width.
- Secrets are never returned to the browser. `get_integration()` output stays server-side.

---

### Task 1: Data model and migration

**Files:**
- Modify: `backend/app/models/campaign.py`
- Create: `backend/app/models/ad_sync.py`
- Modify: `backend/app/models/__init__.py`
- Create: `backend/alembic/versions/i4d5e6f7a8b9_add_ad_sync.py`
- Test: `backend/tests/test_ad_sync_model.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `Campaign.provider: str | None`, `Campaign.external_id: str | None`, `CampaignMetric.source: str`, `CampaignMetric.currency: str | None`, `CampaignMetric.spend_original`, `CampaignMetric.revenue_original`, `CampaignMetric.fx_rate`, and model `AdSyncRun` with fields `provider, started_at, finished_at, ok, campaigns_synced, metrics_upserted, error`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_ad_sync_model.py`:

```python
"""The sync-row uniqueness guarantee, which is what makes re-running safe."""
import uuid
from datetime import date

import pytest
from sqlalchemy.exc import IntegrityError

from app.core.database import AsyncSessionLocal
from app.models.campaign import Campaign, CampaignMetric


async def _campaign(db, **kw) -> Campaign:
    c = Campaign(name="C", **kw)
    db.add(c)
    await db.commit()
    await db.refresh(c)
    return c


@pytest.mark.asyncio
async def test_sync_rows_are_unique_per_campaign_channel_date(client):
    async with AsyncSessionLocal() as db:
        c = await _campaign(db, provider="meta", external_id="123")
        db.add(CampaignMetric(campaign_id=c.id, channel="facebook",
                              date=date(2026, 8, 1), source="sync"))
        await db.commit()
        db.add(CampaignMetric(campaign_id=c.id, channel="facebook",
                              date=date(2026, 8, 1), source="sync"))
        with pytest.raises(IntegrityError):
            await db.commit()


@pytest.mark.asyncio
async def test_manual_rows_may_repeat_channel_and_date(client):
    """The partial index must not restrict hand-entered rows."""
    async with AsyncSessionLocal() as db:
        c = await _campaign(db)
        for _ in range(2):
            db.add(CampaignMetric(campaign_id=c.id, channel="facebook",
                                  date=date(2026, 8, 1), source="manual"))
        await db.commit()  # must not raise


@pytest.mark.asyncio
async def test_provider_external_id_is_unique(client):
    async with AsyncSessionLocal() as db:
        await _campaign(db, provider="meta", external_id="dup")
        db.add(Campaign(name="other", provider="meta", external_id="dup"))
        with pytest.raises(IntegrityError):
            await db.commit()


@pytest.mark.asyncio
async def test_manual_campaigns_may_repeat_null_provider(client):
    async with AsyncSessionLocal() as db:
        await _campaign(db)
        await _campaign(db)  # must not raise
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && python -m pytest tests/test_ad_sync_model.py -v
```

Expected: FAIL — `TypeError: 'provider' is an invalid keyword argument for Campaign`.

- [ ] **Step 3: Add the model columns and partial indexes**

Replace `backend/app/models/campaign.py` entirely:

```python
import uuid
from datetime import date

from sqlalchemy import (
    BigInteger,
    Date,
    ForeignKey,
    Index,
    Numeric,
    String,
    Text,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.base import TimestampMixin, UUIDMixin


class Campaign(UUIDMixin, TimestampMixin, Base):
    """A marketing campaign that aggregates ad-channel performance metrics.

    Campaigns pulled from an ad platform carry ``provider`` + ``external_id``;
    hand-created ones leave both NULL. ``provider`` is the source platform and
    is deliberately coarser than a metric's ``channel``: one ``meta`` campaign
    yields both facebook and instagram rows via the publisher_platform
    breakdown.
    """

    __tablename__ = "campaigns"

    company_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("companies.id", ondelete="SET NULL"), index=True, nullable=True
    )
    name: Mapped[str] = mapped_column(String(255))
    objective: Mapped[str | None] = mapped_column(String(255))
    status: Mapped[str] = mapped_column(String(16), default="active", index=True)
    start_date: Mapped[date | None] = mapped_column(Date)
    end_date: Mapped[date | None] = mapped_column(Date)
    notes: Mapped[str | None] = mapped_column(Text)
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    # meta | google_ads | tiktok — NULL for manually created campaigns.
    provider: Mapped[str | None] = mapped_column(String(16), index=True)
    external_id: Mapped[str | None] = mapped_column(String(64))

    metrics: Mapped[list["CampaignMetric"]] = relationship(
        back_populates="campaign", cascade="all, delete-orphan"
    )

    __table_args__ = (
        Index(
            "uq_campaigns_provider_external",
            "provider",
            "external_id",
            unique=True,
            postgresql_where=text("provider IS NOT NULL"),
            sqlite_where=text("provider IS NOT NULL"),
        ),
    )


class CampaignMetric(UUIDMixin, TimestampMixin, Base):
    """One channel's performance for a given date within a campaign."""

    __tablename__ = "campaign_metrics"

    campaign_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("campaigns.id", ondelete="CASCADE"), index=True
    )
    # facebook | instagram | google | tiktok | other
    channel: Mapped[str] = mapped_column(String(32), index=True)
    date: Mapped[date | None] = mapped_column(Date)
    spend: Mapped[float] = mapped_column(Numeric(14, 2), default=0)
    impressions: Mapped[int] = mapped_column(BigInteger, default=0)
    clicks: Mapped[int] = mapped_column(BigInteger, default=0)
    conversions: Mapped[int] = mapped_column(BigInteger, default=0)
    revenue: Mapped[float] = mapped_column(Numeric(14, 2), default=0)
    # manual | csv | sync — sync never touches the first two.
    source: Mapped[str] = mapped_column(
        String(8), default="manual", server_default="manual", nullable=False, index=True
    )
    # Currency reported by the platform, plus the pre-conversion figures and the
    # rate applied, so any AED value can be audited and recomputed.
    currency: Mapped[str | None] = mapped_column(String(3))
    spend_original: Mapped[float | None] = mapped_column(Numeric(14, 2))
    revenue_original: Mapped[float | None] = mapped_column(Numeric(14, 2))
    fx_rate: Mapped[float | None] = mapped_column(Numeric(18, 8))

    campaign: Mapped["Campaign"] = relationship(back_populates="metrics")

    __table_args__ = (
        # Partial on purpose: a blanket unique constraint would fail the
        # migration on existing duplicate manual rows and would break the
        # "Add row" form, which legitimately allows repeats.
        Index(
            "uq_campaign_metrics_sync_row",
            "campaign_id",
            "channel",
            "date",
            unique=True,
            postgresql_where=text("source = 'sync'"),
            sqlite_where=text("source = 'sync'"),
        ),
    )
```

- [ ] **Step 4: Add the AdSyncRun model**

Create `backend/app/models/ad_sync.py`:

```python
"""Per-provider record of each sync attempt, so the UI can show when data last
arrived and why a provider went quiet."""
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.base import TimestampMixin, UUIDMixin


class AdSyncRun(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "ad_sync_runs"

    provider: Mapped[str] = mapped_column(String(16), index=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    ok: Mapped[bool] = mapped_column(Boolean, default=False)
    campaigns_synced: Mapped[int] = mapped_column(Integer, default=0)
    metrics_upserted: Mapped[int] = mapped_column(Integer, default=0)
    error: Mapped[str | None] = mapped_column(Text)
```

Register it in `backend/app/models/__init__.py` alongside the existing imports, following whatever pattern that file already uses (an import plus an `__all__` entry if present):

```python
from app.models.ad_sync import AdSyncRun  # noqa: F401
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd backend && python -m pytest tests/test_ad_sync_model.py -v
```

Expected: 4 passed. If `test_sync_rows_are_unique_per_campaign_channel_date` fails to raise, the `sqlite_where=` kwarg is missing — SQLite silently accepts the index without it and the guarantee exists only in production.

- [ ] **Step 6: Write the migration**

Create `backend/alembic/versions/i4d5e6f7a8b9_add_ad_sync.py`:

```python
"""add ad sync columns, partial indexes and ad_sync_runs

Revision ID: i4d5e6f7a8b9
Revises: h3c4d5e6f7a8
"""
import sqlalchemy as sa
from alembic import op

revision = "i4d5e6f7a8b9"
down_revision = "h3c4d5e6f7a8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("campaigns", sa.Column("provider", sa.String(16), nullable=True))
    op.add_column("campaigns", sa.Column("external_id", sa.String(64), nullable=True))
    op.create_index("ix_campaigns_provider", "campaigns", ["provider"])
    op.create_index(
        "uq_campaigns_provider_external",
        "campaigns",
        ["provider", "external_id"],
        unique=True,
        postgresql_where=sa.text("provider IS NOT NULL"),
    )

    op.add_column(
        "campaign_metrics",
        sa.Column("source", sa.String(8), nullable=False, server_default="manual"),
    )
    op.create_index("ix_campaign_metrics_source", "campaign_metrics", ["source"])
    op.add_column("campaign_metrics", sa.Column("currency", sa.String(3), nullable=True))
    op.add_column(
        "campaign_metrics", sa.Column("spend_original", sa.Numeric(14, 2), nullable=True)
    )
    op.add_column(
        "campaign_metrics", sa.Column("revenue_original", sa.Numeric(14, 2), nullable=True)
    )
    op.add_column(
        "campaign_metrics", sa.Column("fx_rate", sa.Numeric(18, 8), nullable=True)
    )
    op.create_index(
        "uq_campaign_metrics_sync_row",
        "campaign_metrics",
        ["campaign_id", "channel", "date"],
        unique=True,
        postgresql_where=sa.text("source = 'sync'"),
    )

    op.create_table(
        "ad_sync_runs",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("provider", sa.String(16), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ok", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("campaigns_synced", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("metrics_upserted", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index("ix_ad_sync_runs_provider", "ad_sync_runs", ["provider"])


def downgrade() -> None:
    op.drop_index("ix_ad_sync_runs_provider", table_name="ad_sync_runs")
    op.drop_table("ad_sync_runs")
    op.drop_index("uq_campaign_metrics_sync_row", table_name="campaign_metrics")
    op.drop_column("campaign_metrics", "fx_rate")
    op.drop_column("campaign_metrics", "revenue_original")
    op.drop_column("campaign_metrics", "spend_original")
    op.drop_column("campaign_metrics", "currency")
    op.drop_index("ix_campaign_metrics_source", table_name="campaign_metrics")
    op.drop_column("campaign_metrics", "source")
    op.drop_index("uq_campaigns_provider_external", table_name="campaigns")
    op.drop_index("ix_campaigns_provider", table_name="campaigns")
    op.drop_column("campaigns", "external_id")
    op.drop_column("campaigns", "provider")
```

- [ ] **Step 7: Verify exactly one head**

```bash
cd backend && python -m alembic heads
```

Expected: a single line ending `i4d5e6f7a8b9 (head)`. If two lines appear, add a merge revision rather than editing shipped ancestry.

- [ ] **Step 8: Commit**

```bash
git add backend/app/models/campaign.py backend/app/models/ad_sync.py backend/app/models/__init__.py backend/alembic/versions/i4d5e6f7a8b9_add_ad_sync.py backend/tests/test_ad_sync_model.py
git commit -m "feat(campaigns): add ad-sync columns, partial indexes and run log"
```

---

### Task 2: Currency conversion

**Files:**
- Create: `backend/app/services/ad_sync/__init__.py`
- Create: `backend/app/services/ad_sync/fx.py`
- Test: `backend/tests/test_ad_sync_fx.py`

**Interfaces:**
- Consumes: `app.services.app_settings.get_all`.
- Produces: `FX_PREFIX: str`, `BASE_CURRENCY: str`, `MissingRateError`, `async get_rates(db) -> dict[str, Decimal]`, `convert(amount: Decimal, currency: str | None, rates: dict[str, Decimal]) -> tuple[Decimal, Decimal]` returning `(converted_aed, rate_applied)`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_ad_sync_fx.py`:

```python
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && python -m pytest tests/test_ad_sync_fx.py -v
```

Expected: FAIL — `ModuleNotFoundError: No module named 'app.services.ad_sync'`.

- [ ] **Step 3: Create the package and implementation**

Create `backend/app/services/ad_sync/__init__.py`:

```python
"""Pulling campaign performance from ad platforms into Campaign Studio."""
```

Create `backend/app/services/ad_sync/fx.py`:

```python
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
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd backend && python -m pytest tests/test_ad_sync_fx.py -v
```

Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/ad_sync/ backend/tests/test_ad_sync_fx.py
git commit -m "feat(ad-sync): add AED conversion from admin rate table"
```

---

### Task 3: Provider protocol and normalised row

**Files:**
- Create: `backend/app/services/ad_sync/base.py`
- Test: `backend/tests/test_ad_sync_base.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `CHANNELS: set[str]`, `NormalizedMetric` (frozen dataclass with fields `external_campaign_id: str`, `campaign_name: str`, `campaign_status: str`, `channel: str`, `date: date`, `spend: Decimal`, `impressions: int`, `clicks: int`, `conversions: int`, `revenue: Decimal`, `currency: str`), `AdProvider` Protocol with `key: str` and `async fetch(cfg: dict, since: date, until: date) -> list[NormalizedMetric]`, and helpers `to_decimal(v) -> Decimal`, `to_int(v) -> int`, `normalise_channel(v: str) -> str`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_ad_sync_base.py`:

```python
from decimal import Decimal

from app.services.ad_sync.base import normalise_channel, to_decimal, to_int


def test_to_decimal_handles_strings_none_and_junk():
    assert to_decimal("12.34") == Decimal("12.34")
    assert to_decimal(None) == Decimal("0")
    assert to_decimal("") == Decimal("0")
    assert to_decimal("not-a-number") == Decimal("0")


def test_to_int_handles_float_strings():
    """Platforms return counts as float-formatted strings such as "12.0"."""
    assert to_int("12.0") == 12
    assert to_int(None) == 0
    assert to_int("junk") == 0


def test_normalise_channel_maps_known_platforms():
    assert normalise_channel("facebook") == "facebook"
    assert normalise_channel("instagram") == "instagram"
    assert normalise_channel("google") == "google"
    assert normalise_channel("tiktok") == "tiktok"


def test_unknown_channel_falls_back_to_other():
    assert normalise_channel("audience_network") == "other"
    assert normalise_channel("messenger") == "other"
    assert normalise_channel("") == "other"
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && python -m pytest tests/test_ad_sync_base.py -v
```

Expected: FAIL — `ModuleNotFoundError: No module named 'app.services.ad_sync.base'`.

- [ ] **Step 3: Write the implementation**

Create `backend/app/services/ad_sync/base.py`:

```python
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
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd backend && python -m pytest tests/test_ad_sync_base.py -v
```

Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/ad_sync/base.py backend/tests/test_ad_sync_base.py
git commit -m "feat(ad-sync): add provider protocol and normalised row"
```

---

### Task 4: Meta client

**Files:**
- Create: `backend/app/services/ad_sync/meta.py`
- Test: `backend/tests/test_ad_sync_meta.py`

**Interfaces:**
- Consumes: `NormalizedMetric`, `to_decimal`, `to_int`, `normalise_channel` from `base.py`.
- Produces: `MetaProvider` class with `key = "meta"`, `GRAPH_VERSION`, `CONVERSION_ACTIONS: set[str]`, `REVENUE_ACTIONS: set[str]`, `parse_rows(payload: dict) -> list[NormalizedMetric]`.

**Background the implementer needs:** Meta returns `{"data": [...], "paging": {"next": "<full url>"}}`. Conversions and revenue are **not** flat fields — they are nested in `actions` and `action_values` arrays keyed by `action_type`. `breakdowns=publisher_platform` splits one ad account into `facebook` / `instagram` / `audience_network` / `messenger` rows.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_ad_sync_meta.py`:

```python
from datetime import date
from decimal import Decimal

import httpx
import pytest

from app.services.ad_sync.meta import MetaProvider

CFG = {"ad_account_id": "act_123", "access_token": "tok"}

PAGE_ONE = {
    "data": [
        {
            "date_start": "2026-08-01",
            "campaign_id": "111",
            "campaign_name": "Summer Sale",
            "publisher_platform": "facebook",
            "spend": "100.50",
            "impressions": "5000",
            "clicks": "250",
            "account_currency": "USD",
            "actions": [
                {"action_type": "purchase", "value": "10"},
                {"action_type": "link_click", "value": "250"},
            ],
            "action_values": [{"action_type": "purchase", "value": "900.00"}],
        },
        {
            "date_start": "2026-08-01",
            "campaign_id": "111",
            "campaign_name": "Summer Sale",
            "publisher_platform": "instagram",
            "spend": "40.00",
            "impressions": "2000",
            "clicks": "80",
            "account_currency": "USD",
            "actions": [{"action_type": "purchase", "value": "4"}],
            "action_values": [{"action_type": "purchase", "value": "300.00"}],
        },
    ],
    "paging": {"next": "https://graph.facebook.com/next-page"},
}

PAGE_TWO = {
    "data": [
        {
            "date_start": "2026-08-02",
            "campaign_id": "111",
            "campaign_name": "Summer Sale",
            "publisher_platform": "audience_network",
            "spend": "5.00",
            "impressions": "100",
            "clicks": "2",
            "account_currency": "USD",
        }
    ],
    "paging": {},
}


def _transport(pages):
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        page = pages[min(calls["n"], len(pages) - 1)]
        calls["n"] += 1
        return httpx.Response(200, json=page)

    return httpx.MockTransport(handler), calls


@pytest.mark.asyncio
async def test_parses_nested_actions_into_conversions_and_revenue():
    transport, _ = _transport([PAGE_ONE, PAGE_TWO])
    rows = await MetaProvider(transport=transport).fetch(
        CFG, date(2026, 8, 1), date(2026, 8, 2)
    )
    fb = next(r for r in rows if r.channel == "facebook")
    assert fb.spend == Decimal("100.50")
    assert fb.conversions == 10        # from actions[purchase], not clicks
    assert fb.revenue == Decimal("900.00")  # from action_values[purchase]
    assert fb.currency == "USD"
    assert fb.date == date(2026, 8, 1)


@pytest.mark.asyncio
async def test_publisher_platform_splits_facebook_and_instagram():
    transport, _ = _transport([PAGE_ONE, PAGE_TWO])
    rows = await MetaProvider(transport=transport).fetch(
        CFG, date(2026, 8, 1), date(2026, 8, 2)
    )
    assert {r.channel for r in rows} == {"facebook", "instagram", "other"}


@pytest.mark.asyncio
async def test_follows_pagination_to_the_end():
    """Ignoring paging.next silently truncates data and looks like success."""
    transport, calls = _transport([PAGE_ONE, PAGE_TWO])
    rows = await MetaProvider(transport=transport).fetch(
        CFG, date(2026, 8, 1), date(2026, 8, 2)
    )
    assert calls["n"] == 2
    assert len(rows) == 3


@pytest.mark.asyncio
async def test_rows_without_actions_report_zero_conversions():
    transport, _ = _transport([PAGE_TWO])
    rows = await MetaProvider(transport=transport).fetch(
        CFG, date(2026, 8, 2), date(2026, 8, 2)
    )
    assert rows[0].conversions == 0
    assert rows[0].revenue == Decimal("0")


@pytest.mark.asyncio
async def test_api_error_raises_with_the_platform_message():
    def handler(request):
        return httpx.Response(
            400, json={"error": {"message": "Invalid OAuth access token."}}
        )

    provider = MetaProvider(transport=httpx.MockTransport(handler))
    with pytest.raises(RuntimeError, match="Invalid OAuth access token"):
        await provider.fetch(CFG, date(2026, 8, 1), date(2026, 8, 1))
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && python -m pytest tests/test_ad_sync_meta.py -v
```

Expected: FAIL — `ModuleNotFoundError: No module named 'app.services.ad_sync.meta'`.

- [ ] **Step 3: Write the implementation**

Create `backend/app/services/ad_sync/meta.py`:

```python
"""Meta (Facebook + Instagram) Marketing API client.

Instagram is not a separate ad platform: IG ads are bought through the same
Meta ad account, so one credential feeds both channels. The
``publisher_platform`` breakdown is what splits them.

Conversions and revenue are nested inside ``actions`` / ``action_values``
arrays rather than being flat fields; which action types count as a conversion
is deliberately explicit below rather than guessed at.
"""
import json
from datetime import date
from decimal import Decimal

import httpx

from app.services.ad_sync.base import (
    NormalizedMetric,
    normalise_channel,
    to_decimal,
    to_int,
)

GRAPH_VERSION = "v21.0"
GRAPH_BASE = f"https://graph.facebook.com/{GRAPH_VERSION}"
TIMEOUT = 60

FIELDS = ",".join(
    [
        "campaign_id",
        "campaign_name",
        "spend",
        "impressions",
        "clicks",
        "actions",
        "action_values",
        "account_currency",
    ]
)

# What counts as a conversion. Kept explicit so the number in the UI has a
# defined meaning rather than depending on the account's default attribution.
CONVERSION_ACTIONS = {
    "purchase",
    "offsite_conversion.fb_pixel_purchase",
    "lead",
    "offsite_conversion.fb_pixel_lead",
    "complete_registration",
    "offsite_conversion.fb_pixel_complete_registration",
}
REVENUE_ACTIONS = {"purchase", "offsite_conversion.fb_pixel_purchase"}


def _sum_actions(rows, wanted: set[str]) -> Decimal:
    total = Decimal("0")
    for row in rows or []:
        if row.get("action_type") in wanted:
            total += to_decimal(row.get("value"))
    return total


def _error_message(response: httpx.Response) -> str:
    try:
        payload = response.json()
    except (json.JSONDecodeError, ValueError):
        return response.text[:200]
    return (payload.get("error") or {}).get("message") or response.text[:200]


def parse_rows(payload: dict) -> list[NormalizedMetric]:
    out: list[NormalizedMetric] = []
    for row in payload.get("data") or []:
        raw_date = row.get("date_start")
        if not raw_date:
            continue
        out.append(
            NormalizedMetric(
                external_campaign_id=str(row.get("campaign_id") or ""),
                campaign_name=row.get("campaign_name") or "Untitled campaign",
                campaign_status="active",
                channel=normalise_channel(row.get("publisher_platform", "")),
                date=date.fromisoformat(raw_date),
                spend=to_decimal(row.get("spend")),
                impressions=to_int(row.get("impressions")),
                clicks=to_int(row.get("clicks")),
                conversions=int(_sum_actions(row.get("actions"), CONVERSION_ACTIONS)),
                revenue=_sum_actions(row.get("action_values"), REVENUE_ACTIONS),
                currency=(row.get("account_currency") or "USD").upper(),
            )
        )
    return out


class MetaProvider:
    key = "meta"

    def __init__(self, transport: httpx.BaseTransport | None = None) -> None:
        # Injected only by tests, so the suite never makes a live call.
        self._transport = transport

    def _client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(timeout=TIMEOUT, transport=self._transport)

    async def fetch(
        self, cfg: dict, since: date, until: date
    ) -> list[NormalizedMetric]:
        account = (cfg.get("ad_account_id") or "").strip()
        token = (cfg.get("access_token") or "").strip()
        if not account or not token:
            raise RuntimeError("Meta needs an ad account ID and an access token")
        if not account.startswith("act_"):
            account = f"act_{account}"

        url = f"{GRAPH_BASE}/{account}/insights"
        params = {
            "level": "campaign",
            "time_increment": 1,
            "breakdowns": "publisher_platform",
            "fields": FIELDS,
            "time_range": json.dumps(
                {"since": since.isoformat(), "until": until.isoformat()}
            ),
            "limit": 500,
            "access_token": token,
        }

        rows: list[NormalizedMetric] = []
        async with self._client() as client:
            while url:
                response = await client.get(url, params=params)
                if response.status_code != 200:
                    raise RuntimeError(f"Meta: {_error_message(response)}")
                payload = response.json()
                rows.extend(parse_rows(payload))
                # The next URL already carries every parameter, including the token.
                url = (payload.get("paging") or {}).get("next") or ""
                params = None
        return rows

    async def verify(self, cfg: dict) -> dict:
        account = (cfg.get("ad_account_id") or "").strip()
        token = (cfg.get("access_token") or "").strip()
        if not account or not token:
            return {"ok": False, "error": "Ad account ID and access token required"}
        if not account.startswith("act_"):
            account = f"act_{account}"
        try:
            async with self._client() as client:
                response = await client.get(
                    f"{GRAPH_BASE}/{account}",
                    params={"fields": "name,currency", "access_token": token},
                )
        except httpx.HTTPError as e:
            return {"ok": False, "error": str(e)[:200]}
        if response.status_code != 200:
            return {"ok": False, "error": _error_message(response)}
        body = response.json()
        return {
            "ok": True,
            "account_name": body.get("name"),
            "currency": (body.get("currency") or "").upper() or None,
        }
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd backend && python -m pytest tests/test_ad_sync_meta.py -v
```

Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/ad_sync/meta.py backend/tests/test_ad_sync_meta.py
git commit -m "feat(ad-sync): add Meta client with publisher_platform split"
```

---

### Task 5: Google Ads client

**Files:**
- Create: `backend/app/services/ad_sync/google_ads.py`
- Test: `backend/tests/test_ad_sync_google.py`

**Interfaces:**
- Consumes: `base.py` helpers.
- Produces: `GoogleAdsProvider` with `key = "google_ads"`, `API_VERSION`, `parse_results(payload: dict) -> list[NormalizedMetric]`.

**Background:** Google Ads returns cost as **micros** (divide by 1,000,000). The customer ID must have dashes stripped. An access token is minted from the stored refresh token at `https://oauth2.googleapis.com/token`. The `search` endpoint paginates with `nextPageToken`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_ad_sync_google.py`:

```python
from datetime import date
from decimal import Decimal

import httpx
import pytest

from app.services.ad_sync.google_ads import GoogleAdsProvider

CFG = {
    "customer_id": "123-456-7890",
    "developer_token": "dev",
    "client_id": "cid",
    "client_secret": "secret",
    "refresh_token": "refresh",
}


def _result(campaign_id, day, cost_micros, page_token=None):
    body = {
        "results": [
            {
                "campaign": {
                    "id": campaign_id,
                    "name": "Search Brand",
                    "status": "ENABLED",
                },
                "segments": {"date": day},
                "metrics": {
                    "costMicros": cost_micros,
                    "impressions": "1000",
                    "clicks": "50",
                    "conversions": "5.0",
                    "conversionsValue": "750.25",
                },
                "customer": {"currencyCode": "AED"},
            }
        ]
    }
    if page_token:
        body["nextPageToken"] = page_token
    return body


def _transport(pages):
    calls = {"token": 0, "search": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        if "oauth2" in str(request.url):
            calls["token"] += 1
            return httpx.Response(200, json={"access_token": "at", "expires_in": 3600})
        page = pages[min(calls["search"], len(pages) - 1)]
        calls["search"] += 1
        return httpx.Response(200, json=page)

    return httpx.MockTransport(handler), calls


@pytest.mark.asyncio
async def test_cost_micros_are_converted_to_currency_units():
    transport, _ = _transport([_result("55", "2026-08-01", "12500000")])
    rows = await GoogleAdsProvider(transport=transport).fetch(
        CFG, date(2026, 8, 1), date(2026, 8, 1)
    )
    assert rows[0].spend == Decimal("12.50")  # 12_500_000 micros
    assert rows[0].revenue == Decimal("750.25")
    assert rows[0].conversions == 5
    assert rows[0].channel == "google"
    assert rows[0].currency == "AED"


@pytest.mark.asyncio
async def test_follows_next_page_token():
    pages = [
        _result("55", "2026-08-01", "1000000", page_token="tok"),
        _result("55", "2026-08-02", "2000000"),
    ]
    transport, calls = _transport(pages)
    rows = await GoogleAdsProvider(transport=transport).fetch(
        CFG, date(2026, 8, 1), date(2026, 8, 2)
    )
    assert calls["search"] == 2
    assert len(rows) == 2


@pytest.mark.asyncio
async def test_customer_id_dashes_are_stripped_from_the_url():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        if "oauth2" in str(request.url):
            return httpx.Response(200, json={"access_token": "at"})
        seen["url"] = str(request.url)
        return httpx.Response(200, json={"results": []})

    await GoogleAdsProvider(transport=httpx.MockTransport(handler)).fetch(
        CFG, date(2026, 8, 1), date(2026, 8, 1)
    )
    assert "customers/1234567890/" in seen["url"]


@pytest.mark.asyncio
async def test_token_refresh_failure_is_reported_clearly():
    def handler(request):
        return httpx.Response(400, json={"error_description": "Bad refresh token"})

    provider = GoogleAdsProvider(transport=httpx.MockTransport(handler))
    with pytest.raises(RuntimeError, match="Bad refresh token"):
        await provider.fetch(CFG, date(2026, 8, 1), date(2026, 8, 1))
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && python -m pytest tests/test_ad_sync_google.py -v
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `backend/app/services/ad_sync/google_ads.py`:

```python
"""Google Ads API client.

Two things differ from every other platform here: costs come back as micros
(1/1,000,000 of a currency unit), and the request needs a freshly minted access
token from the stored refresh token on every run.
"""
import json
from datetime import date
from decimal import Decimal

import httpx

from app.services.ad_sync.base import NormalizedMetric, to_decimal, to_int

API_VERSION = "v18"
API_BASE = f"https://googleads.googleapis.com/{API_VERSION}"
TOKEN_URL = "https://oauth2.googleapis.com/token"
TIMEOUT = 60
MICROS = Decimal("1000000")

GAQL = """
SELECT campaign.id, campaign.name, campaign.status, segments.date,
       metrics.cost_micros, metrics.impressions, metrics.clicks,
       metrics.conversions, metrics.conversions_value,
       customer.currency_code
FROM campaign
WHERE segments.date BETWEEN '{since}' AND '{until}'
"""

_STATUS = {"ENABLED": "active", "PAUSED": "paused", "REMOVED": "completed"}


def _error_message(response: httpx.Response) -> str:
    try:
        payload = response.json()
    except (json.JSONDecodeError, ValueError):
        return response.text[:200]
    if isinstance(payload, list) and payload:
        payload = payload[0]
    if "error_description" in payload:
        return payload["error_description"]
    error = payload.get("error")
    if isinstance(error, dict):
        return error.get("message") or response.text[:200]
    return response.text[:200]


def parse_results(payload: dict) -> list[NormalizedMetric]:
    out: list[NormalizedMetric] = []
    for row in payload.get("results") or []:
        campaign = row.get("campaign") or {}
        segments = row.get("segments") or {}
        metrics = row.get("metrics") or {}
        raw_date = segments.get("date")
        if not raw_date:
            continue
        cost = to_decimal(metrics.get("costMicros")) / MICROS
        out.append(
            NormalizedMetric(
                external_campaign_id=str(campaign.get("id") or ""),
                campaign_name=campaign.get("name") or "Untitled campaign",
                campaign_status=_STATUS.get(campaign.get("status", ""), "active"),
                channel="google",
                date=date.fromisoformat(raw_date),
                spend=cost.quantize(Decimal("0.01")),
                impressions=to_int(metrics.get("impressions")),
                clicks=to_int(metrics.get("clicks")),
                conversions=to_int(metrics.get("conversions")),
                revenue=to_decimal(metrics.get("conversionsValue")).quantize(
                    Decimal("0.01")
                ),
                currency=((row.get("customer") or {}).get("currencyCode") or "AED").upper(),
            )
        )
    return out


class GoogleAdsProvider:
    key = "google_ads"

    def __init__(self, transport: httpx.BaseTransport | None = None) -> None:
        self._transport = transport

    def _client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(timeout=TIMEOUT, transport=self._transport)

    async def _access_token(self, client: httpx.AsyncClient, cfg: dict) -> str:
        response = await client.post(
            TOKEN_URL,
            data={
                "client_id": cfg.get("client_id") or "",
                "client_secret": cfg.get("client_secret") or "",
                "refresh_token": cfg.get("refresh_token") or "",
                "grant_type": "refresh_token",
            },
        )
        if response.status_code != 200:
            raise RuntimeError(f"Google Ads auth: {_error_message(response)}")
        token = response.json().get("access_token")
        if not token:
            raise RuntimeError("Google Ads auth: no access token returned")
        return token

    @staticmethod
    def _customer_id(cfg: dict) -> str:
        return (cfg.get("customer_id") or "").replace("-", "").strip()

    async def fetch(
        self, cfg: dict, since: date, until: date
    ) -> list[NormalizedMetric]:
        customer = self._customer_id(cfg)
        developer_token = (cfg.get("developer_token") or "").strip()
        if not customer or not developer_token:
            raise RuntimeError("Google Ads needs a customer ID and developer token")

        rows: list[NormalizedMetric] = []
        async with self._client() as client:
            token = await self._access_token(client, cfg)
            headers = {
                "Authorization": f"Bearer {token}",
                "developer-token": developer_token,
            }
            body = {
                "query": GAQL.format(since=since.isoformat(), until=until.isoformat())
            }
            url = f"{API_BASE}/customers/{customer}/googleAds:search"
            while True:
                response = await client.post(url, headers=headers, json=body)
                if response.status_code != 200:
                    raise RuntimeError(f"Google Ads: {_error_message(response)}")
                payload = response.json()
                rows.extend(parse_results(payload))
                next_token = payload.get("nextPageToken")
                if not next_token:
                    break
                body = {**body, "pageToken": next_token}
        return rows

    async def verify(self, cfg: dict) -> dict:
        customer = self._customer_id(cfg)
        developer_token = (cfg.get("developer_token") or "").strip()
        if not customer or not developer_token:
            return {"ok": False, "error": "Customer ID and developer token required"}
        try:
            async with self._client() as client:
                token = await self._access_token(client, cfg)
                response = await client.post(
                    f"{API_BASE}/customers/{customer}/googleAds:search",
                    headers={
                        "Authorization": f"Bearer {token}",
                        "developer-token": developer_token,
                    },
                    json={
                        "query": (
                            "SELECT customer.descriptive_name, customer.currency_code "
                            "FROM customer LIMIT 1"
                        )
                    },
                )
        except (httpx.HTTPError, RuntimeError) as e:
            return {"ok": False, "error": str(e)[:200]}
        if response.status_code != 200:
            return {"ok": False, "error": _error_message(response)}
        results = response.json().get("results") or []
        info = (results[0].get("customer") if results else {}) or {}
        return {
            "ok": True,
            "account_name": info.get("descriptiveName"),
            "currency": (info.get("currencyCode") or "").upper() or None,
        }
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd backend && python -m pytest tests/test_ad_sync_google.py -v
```

Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/ad_sync/google_ads.py backend/tests/test_ad_sync_google.py
git commit -m "feat(ad-sync): add Google Ads client with micros and paging"
```

---

### Task 6: TikTok client

**Files:**
- Create: `backend/app/services/ad_sync/tiktok.py`
- Test: `backend/tests/test_ad_sync_tiktok.py`

**Interfaces:**
- Consumes: `base.py` helpers.
- Produces: `TikTokProvider` with `key = "tiktok"`, `parse_list(payload: dict, currency: str) -> list[NormalizedMetric]`.

**Background:** TikTok returns HTTP 200 even on failure; the real status is in the body's `code` field (0 means success). Report rows nest under `data.list[].dimensions` and `data.list[].metrics`, and paging is `data.page_info.total_page`. The account currency comes from a separate `/advertiser/info/` call.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_ad_sync_tiktok.py`:

```python
from datetime import date
from decimal import Decimal

import httpx
import pytest

from app.services.ad_sync.tiktok import TikTokProvider

CFG = {"advertiser_id": "999", "access_token": "tok"}

ADVERTISER = {
    "code": 0,
    "data": {"list": [{"name": "AG Holding", "currency": "AED"}]},
}


def _report(page, total_page, day):
    return {
        "code": 0,
        "message": "OK",
        "data": {
            "list": [
                {
                    "dimensions": {"campaign_id": "77", "stat_time_day": day},
                    "metrics": {
                        "campaign_name": "TikTok Awareness",
                        "spend": "250.75",
                        "impressions": "90000",
                        "clicks": "1200",
                        "conversion": "35",
                        "total_purchase_value": "5000.00",
                    },
                }
            ],
            "page_info": {"page": page, "total_page": total_page},
        },
    }


def _transport(pages):
    calls = {"report": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        if "advertiser/info" in str(request.url):
            return httpx.Response(200, json=ADVERTISER)
        page = pages[min(calls["report"], len(pages) - 1)]
        calls["report"] += 1
        return httpx.Response(200, json=page)

    return httpx.MockTransport(handler), calls


@pytest.mark.asyncio
async def test_parses_report_rows():
    transport, _ = _transport([_report(1, 1, "2026-08-01 00:00:00")])
    rows = await TikTokProvider(transport=transport).fetch(
        CFG, date(2026, 8, 1), date(2026, 8, 1)
    )
    assert rows[0].spend == Decimal("250.75")
    assert rows[0].conversions == 35
    assert rows[0].revenue == Decimal("5000.00")
    assert rows[0].channel == "tiktok"
    assert rows[0].date == date(2026, 8, 1)
    assert rows[0].currency == "AED"
    assert rows[0].campaign_name == "TikTok Awareness"


@pytest.mark.asyncio
async def test_walks_every_page():
    pages = [_report(1, 2, "2026-08-01 00:00:00"), _report(2, 2, "2026-08-02 00:00:00")]
    transport, calls = _transport(pages)
    rows = await TikTokProvider(transport=transport).fetch(
        CFG, date(2026, 8, 1), date(2026, 8, 2)
    )
    assert calls["report"] == 2
    assert len(rows) == 2


@pytest.mark.asyncio
async def test_non_zero_code_is_an_error_despite_http_200():
    """TikTok signals failure in the body, not the status line."""

    def handler(request):
        if "advertiser/info" in str(request.url):
            return httpx.Response(200, json=ADVERTISER)
        return httpx.Response(200, json={"code": 40001, "message": "Invalid token"})

    provider = TikTokProvider(transport=httpx.MockTransport(handler))
    with pytest.raises(RuntimeError, match="Invalid token"):
        await provider.fetch(CFG, date(2026, 8, 1), date(2026, 8, 1))
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && python -m pytest tests/test_ad_sync_tiktok.py -v
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `backend/app/services/ad_sync/tiktok.py`:

```python
"""TikTok Ads reporting client.

TikTok answers HTTP 200 even when the request failed; the real outcome is the
body's ``code`` field. Treating the status line as success is the easy mistake
here, and it turns an auth failure into a silent zero-row sync.
"""
import json
from datetime import date
from decimal import Decimal

import httpx

from app.services.ad_sync.base import NormalizedMetric, to_decimal, to_int

API_BASE = "https://business-api.tiktok.com/open_api/v1.3"
TIMEOUT = 60
PAGE_SIZE = 1000

METRICS = [
    "campaign_name",
    "spend",
    "impressions",
    "clicks",
    "conversion",
    "total_purchase_value",
]


def _check(payload: dict) -> dict:
    if payload.get("code") not in (0, None):
        raise RuntimeError(f"TikTok: {payload.get('message') or payload.get('code')}")
    return payload.get("data") or {}


def parse_list(payload: dict, currency: str) -> list[NormalizedMetric]:
    out: list[NormalizedMetric] = []
    for row in (payload.get("list") or []):
        dimensions = row.get("dimensions") or {}
        metrics = row.get("metrics") or {}
        raw_day = (dimensions.get("stat_time_day") or "").split(" ")[0]
        if not raw_day:
            continue
        out.append(
            NormalizedMetric(
                external_campaign_id=str(dimensions.get("campaign_id") or ""),
                campaign_name=metrics.get("campaign_name") or "Untitled campaign",
                campaign_status="active",
                channel="tiktok",
                date=date.fromisoformat(raw_day),
                spend=to_decimal(metrics.get("spend")).quantize(Decimal("0.01")),
                impressions=to_int(metrics.get("impressions")),
                clicks=to_int(metrics.get("clicks")),
                conversions=to_int(metrics.get("conversion")),
                revenue=to_decimal(metrics.get("total_purchase_value")).quantize(
                    Decimal("0.01")
                ),
                currency=currency,
            )
        )
    return out


class TikTokProvider:
    key = "tiktok"

    def __init__(self, transport: httpx.BaseTransport | None = None) -> None:
        self._transport = transport

    def _client(self, token: str) -> httpx.AsyncClient:
        return httpx.AsyncClient(
            timeout=TIMEOUT,
            transport=self._transport,
            headers={"Access-Token": token},
        )

    async def _advertiser(self, client: httpx.AsyncClient, advertiser_id: str) -> dict:
        response = await client.get(
            f"{API_BASE}/advertiser/info/",
            params={"advertiser_ids": json.dumps([advertiser_id])},
        )
        data = _check(response.json())
        items = data.get("list") or []
        return items[0] if items else {}

    async def fetch(
        self, cfg: dict, since: date, until: date
    ) -> list[NormalizedMetric]:
        advertiser_id = (cfg.get("advertiser_id") or "").strip()
        token = (cfg.get("access_token") or "").strip()
        if not advertiser_id or not token:
            raise RuntimeError("TikTok needs an advertiser ID and an access token")

        rows: list[NormalizedMetric] = []
        async with self._client(token) as client:
            info = await self._advertiser(client, advertiser_id)
            currency = (info.get("currency") or "AED").upper()

            page = 1
            while True:
                response = await client.get(
                    f"{API_BASE}/report/integrated/get/",
                    params={
                        "advertiser_id": advertiser_id,
                        "report_type": "BASIC",
                        "data_level": "AUCTION_CAMPAIGN",
                        "dimensions": json.dumps(["campaign_id", "stat_time_day"]),
                        "metrics": json.dumps(METRICS),
                        "start_date": since.isoformat(),
                        "end_date": until.isoformat(),
                        "page": page,
                        "page_size": PAGE_SIZE,
                    },
                )
                data = _check(response.json())
                rows.extend(parse_list(data, currency))
                page_info = data.get("page_info") or {}
                if page >= int(page_info.get("total_page") or 1):
                    break
                page += 1
        return rows

    async def verify(self, cfg: dict) -> dict:
        advertiser_id = (cfg.get("advertiser_id") or "").strip()
        token = (cfg.get("access_token") or "").strip()
        if not advertiser_id or not token:
            return {"ok": False, "error": "Advertiser ID and access token required"}
        try:
            async with self._client(token) as client:
                info = await self._advertiser(client, advertiser_id)
        except (httpx.HTTPError, RuntimeError, ValueError) as e:
            return {"ok": False, "error": str(e)[:200]}
        return {
            "ok": True,
            "account_name": info.get("name"),
            "currency": (info.get("currency") or "").upper() or None,
        }
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd backend && python -m pytest tests/test_ad_sync_tiktok.py -v
```

Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/ad_sync/tiktok.py backend/tests/test_ad_sync_tiktok.py
git commit -m "feat(ad-sync): add TikTok reporting client"
```

---

### Task 7: Sync orchestrator

**Files:**
- Create: `backend/app/services/ad_sync/service.py`
- Test: `backend/tests/test_ad_sync_service.py`

**Interfaces:**
- Consumes: `MetaProvider`, `GoogleAdsProvider`, `TikTokProvider`, `fx.get_rates`, `fx.convert`, `fx.MissingRateError`, `app_settings.get_integration`, models `Campaign`, `CampaignMetric`, `AdSyncRun`.
- Produces: `PROVIDERS: dict[str, AdProvider]`, `ROLLING_DAYS = 30`, `BACKFILL_DAYS = 90`, `async sync_provider(db, key, provider, since=None) -> dict`, `async sync_all(db, providers=None, since=None) -> list[dict]`, `async run_ad_sync(db) -> dict`.

This is the task where correctness actually lives. The tests below are the ones that catch silent data corruption.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_ad_sync_service.py`:

```python
from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy import select

from app.core.database import AsyncSessionLocal
from app.models.campaign import Campaign, CampaignMetric
from app.services.ad_sync.base import NormalizedMetric
from app.services.ad_sync.service import sync_provider
from app.services.app_settings import set_many


def row(day, spend="100.00", conversions=10, channel="facebook", currency="USD"):
    return NormalizedMetric(
        external_campaign_id="111",
        campaign_name="Summer Sale",
        campaign_status="active",
        channel=channel,
        date=day,
        spend=Decimal(spend),
        impressions=5000,
        clicks=250,
        conversions=conversions,
        revenue=Decimal("900.00"),
        currency=currency,
    )


class FakeProvider:
    """Stands in for a platform client; the orchestrator is what's under test."""

    key = "meta"

    def __init__(self, rows, error=None):
        self.rows = rows
        self.error = error

    async def fetch(self, cfg, since, until):
        if self.error:
            raise RuntimeError(self.error)
        return self.rows

    async def verify(self, cfg):
        return {"ok": True}


async def _configure(db):
    """Only the FX rate. Credentials go through set_integration so the secret is
    encrypted the same way production stores it."""
    await set_many(db, {"fx_rate_USD": "3.6725"})


async def _seed_token(db):
    from app.services.app_settings import set_integration

    await set_integration(
        db, "facebook", {"ad_account_id": "act_1", "access_token": "tok"}
    )


@pytest.mark.asyncio
async def test_sync_creates_campaign_and_converts_to_aed(client):
    async with AsyncSessionLocal() as db:
        await _configure(db)
        await _seed_token(db)
        result = await sync_provider(
            db, "meta", FakeProvider([row(date(2026, 8, 1))]), since=date(2026, 8, 1)
        )
        assert result["ok"] is True
        campaign = (await db.execute(select(Campaign))).scalars().one()
        assert campaign.provider == "meta"
        assert campaign.external_id == "111"
        metric = (await db.execute(select(CampaignMetric))).scalars().one()
        assert metric.source == "sync"
        assert Decimal(metric.spend) == Decimal("367.25")   # 100 USD * 3.6725
        assert Decimal(metric.spend_original) == Decimal("100.00")
        assert metric.currency == "USD"


@pytest.mark.asyncio
async def test_running_twice_does_not_double_count(client):
    """The single most important guarantee: re-running is idempotent."""
    async with AsyncSessionLocal() as db:
        await _configure(db)
        await _seed_token(db)
        rows = [row(date(2026, 8, 1))]
        await sync_provider(db, "meta", FakeProvider(rows), since=date(2026, 8, 1))
        await sync_provider(db, "meta", FakeProvider(rows), since=date(2026, 8, 1))
        metrics = (await db.execute(select(CampaignMetric))).scalars().all()
        assert len(metrics) == 1
        assert Decimal(metrics[0].spend) == Decimal("367.25")
        campaigns = (await db.execute(select(Campaign))).scalars().all()
        assert len(campaigns) == 1


@pytest.mark.asyncio
async def test_restated_conversions_update_in_place(client):
    """Platforms revise history for weeks; the row must move, not duplicate."""
    async with AsyncSessionLocal() as db:
        await _configure(db)
        await _seed_token(db)
        await sync_provider(
            db, "meta", FakeProvider([row(date(2026, 8, 1), conversions=10)]),
            since=date(2026, 8, 1),
        )
        await sync_provider(
            db, "meta", FakeProvider([row(date(2026, 8, 1), conversions=17)]),
            since=date(2026, 8, 1),
        )
        metric = (await db.execute(select(CampaignMetric))).scalars().one()
        assert metric.conversions == 17


@pytest.mark.asyncio
async def test_manual_rows_are_never_touched(client):
    async with AsyncSessionLocal() as db:
        await _configure(db)
        await _seed_token(db)
        await sync_provider(
            db, "meta", FakeProvider([row(date(2026, 8, 1))]), since=date(2026, 8, 1)
        )
        campaign = (await db.execute(select(Campaign))).scalars().one()
        db.add(
            CampaignMetric(
                campaign_id=campaign.id, channel="facebook", date=date(2026, 8, 1),
                spend=Decimal("5.00"), source="manual",
            )
        )
        await db.commit()
        await sync_provider(
            db, "meta", FakeProvider([row(date(2026, 8, 1))]), since=date(2026, 8, 1)
        )
        manual = (
            await db.execute(
                select(CampaignMetric).where(CampaignMetric.source == "manual")
            )
        ).scalars().all()
        assert len(manual) == 1
        assert Decimal(manual[0].spend) == Decimal("5.00")


@pytest.mark.asyncio
async def test_missing_fx_rate_fails_the_run_and_writes_nothing(client):
    async with AsyncSessionLocal() as db:
        await _seed_token(db)  # no fx_rate_EUR configured
        result = await sync_provider(
            db,
            "meta",
            FakeProvider([row(date(2026, 8, 1), currency="EUR")]),
            since=date(2026, 8, 1),
        )
        assert result["ok"] is False
        assert "EUR" in result["error"]
        assert (await db.execute(select(CampaignMetric))).scalars().all() == []
        # A rolled-back run must not report rows it never committed.
        assert result["metrics_upserted"] == 0


@pytest.mark.asyncio
async def test_provider_error_is_recorded_not_raised(client):
    async with AsyncSessionLocal() as db:
        await _configure(db)
        await _seed_token(db)
        result = await sync_provider(
            db, "meta", FakeProvider([], error="Invalid OAuth access token"),
            since=date(2026, 8, 1),
        )
        assert result["ok"] is False
        assert "Invalid OAuth" in result["error"]


@pytest.mark.asyncio
async def test_unconfigured_provider_is_skipped(client):
    async with AsyncSessionLocal() as db:
        result = await sync_provider(
            db, "meta", FakeProvider([row(date(2026, 8, 1))]), since=date(2026, 8, 1)
        )
        assert result["ok"] is False
        assert result["skipped"] is True
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && python -m pytest tests/test_ad_sync_service.py -v
```

Expected: FAIL — `ModuleNotFoundError: No module named 'app.services.ad_sync.service'`.

- [ ] **Step 3: Write the implementation**

Create `backend/app/services/ad_sync/service.py`:

```python
"""Orchestrates the pull: fetch, convert, upsert, record.

Providers stay ignorant of the database and of currency; everything that can
corrupt stored numbers is concentrated here so it can be tested in one place.

Two invariants matter most:
  * Re-running must not double-count. Rows are keyed on
    (campaign, channel, date) and updated in place.
  * Hand-entered data is untouchable. Only ``source='sync'`` rows are written.
"""
import logging
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.ad_sync import AdSyncRun
from app.models.campaign import Campaign, CampaignMetric
from app.services.ad_sync.base import NormalizedMetric
from app.services.ad_sync.fx import MissingRateError, convert, get_rates
from app.services.ad_sync.google_ads import GoogleAdsProvider
from app.services.ad_sync.meta import MetaProvider
from app.services.ad_sync.tiktok import TikTokProvider
from app.services.app_settings import get_integration

log = logging.getLogger("ad_sync")

# Ad platforms restate history: a conversion attributed to Monday can arrive
# days later and keeps changing for the length of the attribution window. So
# every run re-reads the recent past rather than appending to it.
ROLLING_DAYS = 30
BACKFILL_DAYS = 90

PROVIDERS = {
    "meta": MetaProvider(),
    "google_ads": GoogleAdsProvider(),
    "tiktok": TikTokProvider(),
}

# Which stored integration credentials feed each provider. Meta's ad metrics
# come from the "facebook" entry; the separate "instagram" entry cannot supply
# ad data and is not consulted.
CREDENTIAL_KEY = {
    "meta": "facebook",
    "google_ads": "google_ads",
    "tiktok": "tiktok",
}


async def _window_start(db: AsyncSession, key: str) -> date:
    """First run backfills; later runs re-read the rolling window."""
    previous = (
        await db.execute(
            select(AdSyncRun).where(AdSyncRun.provider == key, AdSyncRun.ok.is_(True))
        )
    ).scalars().first()
    days = ROLLING_DAYS if previous else BACKFILL_DAYS
    return date.today() - timedelta(days=days)


async def _upsert_campaign(
    db: AsyncSession, key: str, row: NormalizedMetric
) -> Campaign:
    campaign = (
        await db.execute(
            select(Campaign).where(
                Campaign.provider == key,
                Campaign.external_id == row.external_campaign_id,
            )
        )
    ).scalars().first()
    if campaign is None:
        campaign = Campaign(
            name=row.campaign_name,
            provider=key,
            external_id=row.external_campaign_id,
            status=row.campaign_status,
        )
        db.add(campaign)
        await db.flush()
    else:
        campaign.name = row.campaign_name
        campaign.status = row.campaign_status
    return campaign


async def _upsert_metric(
    db: AsyncSession, campaign: Campaign, row: NormalizedMetric, rates: dict
) -> None:
    spend_aed, rate = convert(row.spend, row.currency, rates)
    revenue_aed, _ = convert(row.revenue, row.currency, rates)

    existing = (
        await db.execute(
            select(CampaignMetric).where(
                CampaignMetric.campaign_id == campaign.id,
                CampaignMetric.channel == row.channel,
                CampaignMetric.date == row.date,
                CampaignMetric.source == "sync",
            )
        )
    ).scalars().first()

    target = existing or CampaignMetric(
        campaign_id=campaign.id,
        channel=row.channel,
        date=row.date,
        source="sync",
    )
    target.spend = spend_aed
    target.revenue = revenue_aed
    target.impressions = row.impressions
    target.clicks = row.clicks
    target.conversions = row.conversions
    target.currency = row.currency
    target.spend_original = row.spend
    target.revenue_original = row.revenue
    target.fx_rate = rate
    if existing is None:
        db.add(target)


async def sync_provider(
    db: AsyncSession, key: str, provider, since: date | None = None
) -> dict:
    """Sync one provider. Never raises — the outcome is the return value, so one
    platform failing cannot abort the others."""
    started = datetime.now(timezone.utc)
    result = {
        "provider": key,
        "ok": False,
        "skipped": False,
        "campaigns_synced": 0,
        "metrics_upserted": 0,
        "error": None,
    }

    integration = await get_integration(db, CREDENTIAL_KEY.get(key, key))
    if not integration or not integration["configured"]:
        result["skipped"] = True
        result["error"] = "Not configured"
        return result

    window_start = since or await _window_start(db, key)
    until = date.today()

    try:
        rows = await provider.fetch(integration["values"], window_start, until)
        rates = await get_rates(db)
        campaigns: dict[str, Campaign] = {}
        for row in rows:
            if not row.external_campaign_id:
                continue
            campaign = campaigns.get(row.external_campaign_id)
            if campaign is None:
                campaign = await _upsert_campaign(db, key, row)
                campaigns[row.external_campaign_id] = campaign
            await _upsert_metric(db, campaign, row, rates)
            result["metrics_upserted"] += 1
        result["campaigns_synced"] = len(campaigns)
        await db.commit()
        result["ok"] = True
    except MissingRateError as e:
        await db.rollback()
        # The rollback discarded every row, so the counters must not survive it
        # and claim work that was never committed.
        result["campaigns_synced"] = 0
        result["metrics_upserted"] = 0
        result["error"] = str(e)
    except Exception as e:  # noqa: BLE001 — recorded, never propagated
        await db.rollback()
        result["campaigns_synced"] = 0
        result["metrics_upserted"] = 0
        result["error"] = str(e)[:500]
        log.warning("ad sync %s failed: %s", key, e)

    db.add(
        AdSyncRun(
            provider=key,
            started_at=started,
            finished_at=datetime.now(timezone.utc),
            ok=result["ok"],
            campaigns_synced=result["campaigns_synced"],
            metrics_upserted=result["metrics_upserted"],
            error=result["error"],
        )
    )
    await db.commit()
    return result


async def sync_all(
    db: AsyncSession, providers: list[str] | None = None, since: date | None = None
) -> list[dict]:
    keys = providers or list(PROVIDERS)
    return [
        await sync_provider(db, key, PROVIDERS[key], since=since)
        for key in keys
        if key in PROVIDERS
    ]


async def run_ad_sync(db: AsyncSession) -> dict:
    """Scheduler entry point, matching the _periodic runner contract."""
    results = await sync_all(db)
    return {"created": sum(r["metrics_upserted"] for r in results)}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd backend && python -m pytest tests/test_ad_sync_service.py -v
```

Expected: 7 passed. If `test_running_twice_does_not_double_count` fails with two rows, `_upsert_metric` is not matching on `source == "sync"`.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/ad_sync/service.py backend/tests/test_ad_sync_service.py
git commit -m "feat(ad-sync): add orchestrator with idempotent upsert"
```

---

### Task 8: Scheduler registration

**Files:**
- Modify: `backend/app/services/scheduler.py`
- Test: `backend/tests/test_ad_sync_scheduler.py`

**Interfaces:**
- Consumes: `run_ad_sync` from `service.py`.
- Produces: `AD_SYNC_INTERVAL_SECONDS = 24 * 60 * 60` and a registered job.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_ad_sync_scheduler.py`:

```python
import pytest

from app.core.database import AsyncSessionLocal
from app.services.ad_sync.service import run_ad_sync


@pytest.mark.asyncio
async def test_run_ad_sync_matches_the_periodic_runner_contract(client):
    """_periodic reads result["created"]; a different shape breaks the loop."""
    async with AsyncSessionLocal() as db:
        result = await run_ad_sync(db)
    assert isinstance(result, dict)
    assert "created" in result
    assert result["created"] == 0  # nothing configured in a fresh test DB


def test_ad_sync_is_registered_in_the_scheduler():
    import app.services.scheduler as scheduler

    assert hasattr(scheduler, "AD_SYNC_INTERVAL_SECONDS")
    assert scheduler.AD_SYNC_INTERVAL_SECONDS == 24 * 60 * 60
    source = scheduler.start_scheduler.__doc__ or ""
    assert source is not None
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && python -m pytest tests/test_ad_sync_scheduler.py -v
```

Expected: FAIL — `AttributeError: module 'app.services.scheduler' has no attribute 'AD_SYNC_INTERVAL_SECONDS'`.

- [ ] **Step 3: Register the job**

In `backend/app/services/scheduler.py`, add the import beside the existing service imports:

```python
from app.services.ad_sync.service import run_ad_sync
```

Add the interval constant after `BACKUP_INTERVAL_SECONDS`:

```python
# Ad platforms restate the recent past, so a daily re-read of the rolling
# window is both sufficient and necessary. Warmup is late to keep startup
# free of outbound calls.
AD_SYNC_INTERVAL_SECONDS = 24 * 60 * 60
```

Add the job to the `jobs` list in `start_scheduler()`:

```python
        _periodic("ad sync", run_ad_sync, AD_SYNC_INTERVAL_SECONDS, 180),
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd backend && python -m pytest tests/test_ad_sync_scheduler.py -v
```

Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/scheduler.py backend/tests/test_ad_sync_scheduler.py
git commit -m "feat(ad-sync): run the pull nightly from the in-process scheduler"
```

---

### Task 9: API endpoints

**Files:**
- Modify: `backend/app/api/campaigns.py`
- Modify: `backend/app/api/settings.py`
- Modify: `backend/app/schemas/campaign.py`
- Test: `backend/tests/test_ad_sync_api.py`

**Interfaces:**
- Consumes: `sync_all`, `PROVIDERS`, `AdSyncRun`, `get_integration`, provider `.verify()`.
- Produces: `POST /api/campaigns/sync`, `GET /api/campaigns/sync/runs`, `POST /api/settings/integrations/{provider}/test`, `GET /api/settings/fx-rates`, `PUT /api/settings/fx-rates`. Schemas `SyncRequest`, `SyncResult`, `SyncRunOut`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_ad_sync_api.py`:

```python
import pytest


@pytest.mark.asyncio
async def test_sync_requires_admin(client):
    r = await client.post("/api/campaigns/sync")
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_sync_returns_a_result_per_provider(client, auth):
    r = await client.post("/api/campaigns/sync", headers=auth)
    assert r.status_code == 200
    body = r.json()
    assert {item["provider"] for item in body} == {"meta", "google_ads", "tiktok"}
    # Nothing is configured in a fresh test DB, so every provider is skipped.
    assert all(item["skipped"] for item in body)


@pytest.mark.asyncio
async def test_sync_can_target_one_provider(client, auth):
    r = await client.post(
        "/api/campaigns/sync", headers=auth, json={"providers": ["tiktok"]}
    )
    assert r.status_code == 200
    assert [item["provider"] for item in r.json()] == ["tiktok"]


@pytest.mark.asyncio
async def test_unknown_provider_is_rejected(client, auth):
    r = await client.post(
        "/api/campaigns/sync", headers=auth, json={"providers": ["myspace"]}
    )
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_runs_endpoint_lists_last_run_per_provider(client, auth):
    await client.post("/api/campaigns/sync", headers=auth)
    r = await client.get("/api/campaigns/sync/runs", headers=auth)
    assert r.status_code == 200
    providers = {item["provider"] for item in r.json()}
    assert providers == {"meta", "google_ads", "tiktok"}


@pytest.mark.asyncio
async def test_fx_rates_round_trip(client, auth):
    put = await client.put(
        "/api/settings/fx-rates", headers=auth, json={"rates": {"USD": "3.6725"}}
    )
    assert put.status_code == 200
    get = await client.get("/api/settings/fx-rates", headers=auth)
    assert get.json()["rates"]["USD"] == "3.6725"


@pytest.mark.asyncio
async def test_fx_rates_reject_non_positive_values(client, auth):
    r = await client.put(
        "/api/settings/fx-rates", headers=auth, json={"rates": {"USD": "0"}}
    )
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_integration_test_endpoint_reports_unconfigured(client, auth):
    r = await client.post("/api/settings/integrations/tiktok/test", headers=auth)
    assert r.status_code == 200
    assert r.json()["ok"] is False


@pytest.mark.asyncio
async def test_integration_test_rejects_unknown_provider(client, auth):
    r = await client.post("/api/settings/integrations/myspace/test", headers=auth)
    assert r.status_code == 404
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && python -m pytest tests/test_ad_sync_api.py -v
```

Expected: FAIL — 404 on `/api/campaigns/sync`.

- [ ] **Step 3: Add the schemas**

Append to `backend/app/schemas/campaign.py`:

```python
class SyncRequest(BaseModel):
    providers: list[str] | None = None
    since: DateType | None = None


class SyncResult(BaseModel):
    provider: str
    ok: bool
    skipped: bool = False
    campaigns_synced: int = 0
    metrics_upserted: int = 0
    error: str | None = None


class SyncRunOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    provider: str
    started_at: datetime
    finished_at: datetime | None = None
    ok: bool
    campaigns_synced: int
    metrics_upserted: int
    error: str | None = None
```

- [ ] **Step 4: Add the campaign sync routes**

In `backend/app/api/campaigns.py`, extend the imports:

```python
from app.auth.deps import get_current_admin, get_current_user
from app.models.ad_sync import AdSyncRun
from app.services.ad_sync.service import PROVIDERS, sync_all
from app.schemas.campaign import (
    ...,  # keep the existing names
    SyncRequest,
    SyncResult,
    SyncRunOut,
)
```

Add the routes. Place them **above** the existing `@router.get("/{campaign_id}/breakdown")` so the literal `/sync` path is not captured by the UUID route:

```python
@router.post("/sync", response_model=list[SyncResult])
async def trigger_sync(
    payload: SyncRequest | None = None,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    """Pull from every configured ad platform. Admin-only: it writes financial
    data across brands and consumes rate-limited API quota."""
    payload = payload or SyncRequest()
    if payload.providers:
        unknown = [p for p in payload.providers if p not in PROVIDERS]
        if unknown:
            raise HTTPException(
                status_code=422, detail=f"Unknown provider(s): {', '.join(unknown)}"
            )
    return await sync_all(db, providers=payload.providers, since=payload.since)


@router.get("/sync/runs", response_model=list[SyncRunOut])
async def sync_runs(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Most recent run per provider, for the status strip."""
    out = []
    for key in PROVIDERS:
        run = (
            await db.execute(
                select(AdSyncRun)
                .where(AdSyncRun.provider == key)
                .order_by(AdSyncRun.started_at.desc())
                .limit(1)
            )
        ).scalars().first()
        if run:
            out.append(SyncRunOut.model_validate(run))
    return out
```

- [ ] **Step 5: Add the settings routes**

In `backend/app/api/settings.py`, extend the imports:

```python
from decimal import Decimal, InvalidOperation

from app.services.ad_sync.fx import BASE_CURRENCY, FX_PREFIX
from app.services.ad_sync.service import CREDENTIAL_KEY, PROVIDERS
from app.services.app_settings import get_all, get_integration
```

Add the routes:

```python
class FxRatesIn(BaseModel):
    rates: dict[str, str] = {}


@router.get("/fx-rates")
async def get_fx_rates(
    db: AsyncSession = Depends(get_db), _: User = Depends(get_current_admin)
):
    """Currency to AED rates. AED itself is implicitly 1 and not stored."""
    stored = await get_all(db)
    rates = {
        key[len(FX_PREFIX):].upper(): value
        for key, value in stored.items()
        if key.startswith(FX_PREFIX) and value
    }
    return {"base": BASE_CURRENCY, "rates": rates}


@router.put("/fx-rates")
async def put_fx_rates(
    payload: FxRatesIn,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    values: dict[str, str | None] = {}
    for currency, raw in payload.rates.items():
        code = (currency or "").strip().upper()
        if len(code) != 3 or not code.isalpha():
            raise HTTPException(status_code=422, detail=f"Invalid currency: {currency}")
        text = (raw or "").strip()
        if not text:
            values[f"{FX_PREFIX}{code}"] = None
            continue
        try:
            rate = Decimal(text)
        except InvalidOperation:
            raise HTTPException(status_code=422, detail=f"Invalid rate for {code}")
        if rate <= 0:
            raise HTTPException(status_code=422, detail=f"Rate for {code} must be > 0")
        values[f"{FX_PREFIX}{code}"] = text
    if values:
        await set_many(db, values)
    stored = await get_all(db)
    return {
        "base": BASE_CURRENCY,
        "rates": {
            key[len(FX_PREFIX):].upper(): value
            for key, value in stored.items()
            if key.startswith(FX_PREFIX) and value
        },
    }


@router.post("/integrations/{provider}/test")
async def test_integration(
    provider: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    """Make a cheap read call so "Connected" means the account was reached,
    rather than merely that a field was filled in."""
    key = next((k for k, v in CREDENTIAL_KEY.items() if v == provider), provider)
    client = PROVIDERS.get(key)
    if client is None:
        raise HTTPException(status_code=404, detail="Unknown integration")
    integration = await get_integration(db, provider)
    if not integration or not integration["configured"]:
        return {"ok": False, "error": "Not configured"}
    return await client.verify(integration["values"])
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
cd backend && python -m pytest tests/test_ad_sync_api.py -v
```

Expected: 9 passed. If `/api/campaigns/sync` returns 422 about a UUID, the `/sync` routes were placed below `/{campaign_id}/...` and are being shadowed.

- [ ] **Step 7: Run the whole backend suite**

```bash
cd backend && python -m pytest
```

Expected: all pass, including the pre-existing `test_marketing_enhancements.py` and `test_rbac.py`.

- [ ] **Step 8: Commit**

```bash
git add backend/app/api/campaigns.py backend/app/api/settings.py backend/app/schemas/campaign.py backend/tests/test_ad_sync_api.py
git commit -m "feat(ad-sync): add sync trigger, run log, FX rate and test endpoints"
```

---

### Task 10: Frontend types and Campaign Studio sync UI

**Files:**
- Modify: `frontend/src/api/types.ts`
- Create: `frontend/src/components/SyncStatusStrip.tsx`
- Modify: `frontend/src/pages/CampaignsPage.tsx`

**Interfaces:**
- Consumes: `GET /api/campaigns/sync/runs`, `POST /api/campaigns/sync`.
- Produces: types `SyncResult`, `SyncRun`; component `SyncStatusStrip` with props `{ runs: SyncRun[] }`.

- [ ] **Step 1: Add the API types**

Append to `frontend/src/api/types.ts`:

```ts
export interface SyncResult {
  provider: string;
  ok: boolean;
  skipped: boolean;
  campaigns_synced: number;
  metrics_upserted: number;
  error?: string | null;
}

export interface SyncRun {
  provider: string;
  started_at: string;
  finished_at?: string | null;
  ok: boolean;
  campaigns_synced: number;
  metrics_upserted: number;
  error?: string | null;
}
```

Extend the existing `Campaign` interface (around `frontend/src/api/types.ts:338`) with:

```ts
  provider?: string | null;
  external_id?: string | null;
```

Extend the existing `CampaignMetric` interface (around line 351) with:

```ts
  source?: string;
  currency?: string | null;
  spend_original?: string | null;
  fx_rate?: string | null;
```

- [ ] **Step 2: Add `provider` to the campaign response**

The type change above is only honest if the API sends it. In `backend/app/schemas/campaign.py`, add to `CampaignOut`:

```python
    provider: str | None = None
    external_id: str | None = None
```

And to `MetricOut`:

```python
    source: str = "manual"
    currency: str | None = None
    spend_original: Decimal | None = None
    fx_rate: Decimal | None = None
```

- [ ] **Step 3: Write the sync status strip**

Create `frontend/src/components/SyncStatusStrip.tsx`:

```tsx
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type { SyncRun } from "../api/types";

const PROVIDER_LABEL: Record<string, string> = {
  meta: "Meta (Facebook + Instagram)",
  google_ads: "Google Ads",
  tiktok: "TikTok Ads",
};

function when(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

/** Per-provider outcome of the last pull. Rendered only when a provider has
 *  actually run, so it stays invisible for teams not using the integrations. */
export default function SyncStatusStrip({ runs }: { runs: SyncRun[] }) {
  if (runs.length === 0) return null;
  return (
    <Card className="py-0">
      <CardContent className="flex flex-col gap-2 p-(--card-spacing) sm:flex-row sm:flex-wrap">
        {runs.map((run) => (
          <div key={run.provider} className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex items-center gap-2">
              {run.ok ? (
                <CheckCircle2 className="text-success" aria-hidden="true" />
              ) : (
                <AlertCircle className="text-destructive" aria-hidden="true" />
              )}
              <span className="truncate font-semibold">
                {PROVIDER_LABEL[run.provider] ?? run.provider}
              </span>
              <Badge variant={run.ok ? "success" : "destructive"}>
                {run.ok ? "OK" : "Failed"}
              </Badge>
            </div>
            <div className="text-xs text-muted-foreground">
              Last synced {when(run.started_at)}
              {run.ok && ` · ${run.metrics_upserted} rows`}
            </div>
            {!run.ok && run.error && (
              <div className="text-xs break-words text-destructive">{run.error}</div>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 4: Wire the button and strip into Campaign Studio**

In `frontend/src/pages/CampaignsPage.tsx`:

Add to the imports:

```tsx
import { RefreshCw } from "lucide-react";
import type { SyncResult, SyncRun } from "../api/types";
import SyncStatusStrip from "../components/SyncStatusStrip";
```

Inside `CampaignsPage`, after the existing `useFetch` calls, add:

```tsx
  const syncRuns = useFetch<SyncRun[]>("/api/campaigns/sync/runs");
  const [syncing, setSyncing] = useState(false);

  async function runSync() {
    setSyncing(true);
    try {
      const results = await api<SyncResult[]>("/api/campaigns/sync", { method: "POST" });
      const ran = results.filter((r) => !r.skipped);
      if (ran.length === 0) {
        notify("No ad accounts are connected yet. Add credentials in Settings.", "error");
      } else {
        const rows = ran.reduce((total, r) => total + r.metrics_upserted, 0);
        const failed = ran.filter((r) => !r.ok);
        notify(
          failed.length
            ? `Synced ${rows} rows. ${failed.length} provider(s) failed — see status below.`
            : `Synced ${rows} rows from ${ran.length} provider(s).`,
          failed.length ? "error" : undefined,
        );
      }
      reloadAll();
      syncRuns.reload();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Sync failed", "error");
    } finally {
      setSyncing(false);
    }
  }
```

Replace the `PageHead` action prop with both buttons:

```tsx
      action={
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={runSync} disabled={syncing}>
            <RefreshCw data-icon="inline-start" />
            {syncing ? "Syncing…" : "Sync now"}
          </Button>
          <Button type="button" onClick={() => setCreating(true)}>+ New campaign</Button>
        </div>
      }
```

Render the strip immediately after `<PageHead … />`:

```tsx
      {syncRuns.data && syncRuns.data.length > 0 && (
        <div className="mb-4">
          <SyncStatusStrip runs={syncRuns.data} />
        </div>
      )}
```

In the campaigns table body, show which platform a row came from. Replace the campaign-name `TableCell` content with:

```tsx
            <TableCell className="max-w-[28rem] whitespace-normal">
              <div className="flex items-center gap-2">
                <div className="truncate font-semibold" title={campaign.name}>{campaign.name}</div>
                {campaign.provider && <Badge variant="secondary">{campaign.provider}</Badge>}
              </div>
              {campaign.objective && <div className="line-clamp-2 text-xs text-muted-foreground">{campaign.objective}</div>}
            </TableCell>
```

In `CampaignDetail`'s rows table, add a source column so synced and manual data are distinguishable. Add `<TableHead>Source</TableHead>` after the Channel header, and in the body after the channel cell:

```tsx
<TableCell><Badge variant={metric.source === "sync" ? "secondary" : "outline"}>{metric.source ?? "manual"}</Badge></TableCell>
```

- [ ] **Step 5: Typecheck and build**

```bash
cd frontend && npm run typecheck && npm run build
```

Expected: both succeed.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/api/types.ts frontend/src/components/SyncStatusStrip.tsx frontend/src/pages/CampaignsPage.tsx backend/app/schemas/campaign.py
git commit -m "feat(campaigns): add sync trigger, status strip and source badges"
```

---

### Task 11: Settings UI — connection test and FX rates

**Files:**
- Modify: `frontend/src/components/IntegrationsSettings.tsx`
- Create: `frontend/src/components/FxRatesSettings.tsx`
- Modify: the settings page that renders `IntegrationsSettings` (find it with the grep in Step 1)

**Interfaces:**
- Consumes: `POST /api/settings/integrations/{provider}/test`, `GET`/`PUT /api/settings/fx-rates`.
- Produces: component `FxRatesSettings` (no props).

- [ ] **Step 1: Find where integrations settings are rendered**

```bash
grep -rn "IntegrationsSettings" frontend/src
```

Note the parent page — `FxRatesSettings` goes beside it in Step 4.

- [ ] **Step 2: Add the connection test**

In `frontend/src/components/IntegrationsSettings.tsx`, add a module-level constant
above the component. Instagram is deliberately absent: its ad metrics come
through the Meta ad account, so it has no client to test and the endpoint would
answer 404.

```tsx
// Providers with an ad-sync client behind them. Instagram is excluded by
// design — IG ad spend arrives via the Facebook/Meta credential.
const TESTABLE = new Set(["facebook", "google_ads", "tiktok"]);
```

Add state beside the existing `saving` state:

```tsx
  const [testing, setTesting] = useState<string | null>(null);
  const [tested, setTested] = useState<Record<string, { ok: boolean; label: string }>>({});

  async function testConnection(provider: string) {
    setTesting(provider);
    try {
      const result = await api<{ ok: boolean; account_name?: string; currency?: string; error?: string }>(
        `/api/settings/integrations/${provider}/test`,
        { method: "POST" },
      );
      setTested((current) => ({
        ...current,
        [provider]: {
          ok: result.ok,
          label: result.ok
            ? [result.account_name, result.currency].filter(Boolean).join(" · ") || "Reached"
            : result.error ?? "Failed",
        },
      }));
      notify(result.ok ? "Connection verified." : result.error ?? "Connection failed", result.ok ? undefined : "error");
    } catch (e) {
      notify(e instanceof Error ? e.message : "Test failed", "error");
    } finally {
      setTesting(null);
    }
  }
```

Replace the save `Button` with both buttons, and show the test outcome:

```tsx
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" disabled={saving === it.provider} onClick={() => save(it.provider)}>
                {saving === it.provider ? "Saving…" : `Save ${it.label}`}
              </Button>
              {TESTABLE.has(it.provider) && (
                <Button type="button" variant="outline" disabled={testing === it.provider || !it.configured}
                  onClick={() => testConnection(it.provider)}>
                  {testing === it.provider ? "Testing…" : "Test connection"}
                </Button>
              )}
              {tested[it.provider] && (
                <span className={tested[it.provider].ok ? "text-xs text-success" : "text-xs text-destructive"}>
                  {tested[it.provider].label}
                </span>
              )}
            </div>
```

Update the card description so the badge is not overclaiming:

```tsx
        <CardDescription>
        Connect your ad accounts so campaign data can be pulled in. Tokens are
        stored encrypted and never shown again. "Not set" only reports whether a
        field is filled — use Test connection to confirm the account is reachable.
        </CardDescription>
```

- [ ] **Step 3: Write the FX rates card**

Create `frontend/src/components/FxRatesSettings.tsx`:

```tsx
import { useEffect, useState } from "react";
import { Coins } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { api } from "../api/client";
import { useToast } from "./ui";

interface FxRates {
  base: string;
  rates: Record<string, string>;
}

// The currencies AG's ad accounts realistically bill in. Others can be added by
// typing a code; the backend validates the format.
const COMMON = ["USD", "EUR", "GBP", "SAR"];

/** Exchange rates used to convert ad spend into the reporting currency. A
 *  currency with no rate fails its provider's sync rather than importing a
 *  wrong number. */
export default function FxRatesSettings() {
  const { notify } = useToast();
  const [base, setBase] = useState("AED");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api<FxRates>("/api/settings/fx-rates")
      .then((data) => {
        setBase(data.base);
        const next: Record<string, string> = {};
        for (const code of COMMON) next[code] = data.rates[code] ?? "";
        for (const [code, value] of Object.entries(data.rates)) next[code] = value;
        setDrafts(next);
      })
      .catch(() => {});
  }, []);

  async function save() {
    setSaving(true);
    try {
      await api("/api/settings/fx-rates", { method: "PUT", body: { rates: drafts } });
      notify("Exchange rates saved.");
    } catch (e) {
      notify(e instanceof Error ? e.message : "Save failed", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Coins aria-hidden="true" /> Exchange rates
        </CardTitle>
        <CardDescription>
          How much 1 unit of each currency is worth in {base}. Ad spend is converted
          on sync. A currency with no rate here will stop that account syncing rather
          than import an unconverted figure.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <FieldGroup className="grid gap-2 sm:grid-cols-2">
          {Object.keys(drafts).sort().map((code) => (
            <Field key={code}>
              <FieldLabel htmlFor={`fx-${code}`}>{`1 ${code} = ? ${base}`}</FieldLabel>
              <Input id={`fx-${code}`} inputMode="decimal" placeholder="0.0000"
                value={drafts[code] ?? ""}
                onChange={(e) => setDrafts((d) => ({ ...d, [code]: e.target.value }))}
              />
            </Field>
          ))}
        </FieldGroup>
        <Button type="button" disabled={saving} onClick={save}>
          {saving ? "Saving…" : "Save rates"}
        </Button>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 4: Render it beside the integrations card**

In the parent found in Step 1, import and render `<FxRatesSettings />` directly after `<IntegrationsSettings />`, matching the surrounding layout.

- [ ] **Step 5: Typecheck and build**

```bash
cd frontend && npm run typecheck && npm run build
```

Expected: both succeed.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/IntegrationsSettings.tsx frontend/src/components/FxRatesSettings.tsx frontend/src
git commit -m "feat(settings): add connection test and AED exchange-rate table"
```

---

### Task 12: End-to-end coverage and quality gates

**Files:**
- Create: `frontend/e2e/campaign-sync.spec.ts`
- Test: full backend suite, React Doctor

- [ ] **Step 1: Write the E2E spec**

The suite's auth helper is `login(page)`, exported from `frontend/e2e/auth.ts:3`.
Read `frontend/e2e/marketing-tools.spec.ts` first for its API-mocking style — it
stubs endpoints with `page.route`, which this spec needs for the sync response.

Create `frontend/e2e/campaign-sync.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

import { login } from "./auth";

test.describe("Campaign Studio sync", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto("/campaigns");
  });

  test("exposes a sync control", async ({ page }) => {
    await expect(page.getByRole("button", { name: /sync now/i })).toBeVisible();
  });

  test("reports when nothing is connected", async ({ page }) => {
    await page.getByRole("button", { name: /sync now/i }).click();
    await expect(page.getByText(/no ad accounts are connected/i)).toBeVisible();
  });

  test("keeps the page usable at mobile width", async ({ page }) => {
    await expect(page.getByRole("button", { name: /sync now/i })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflow).toBe(false);
  });
});
```

- [ ] **Step 2: Run the E2E spec on both projects**

```bash
cd frontend && npx playwright test e2e/campaign-sync.spec.ts
```

Expected: passes on both the configured desktop and mobile projects.

- [ ] **Step 3: Run React Doctor**

```bash
cd frontend && npm run typecheck && npm run build && npm run doctor
```

Read every diagnostic and fix the code. Do not weaken `doctor.config.json` to improve the score.

- [ ] **Step 4: Run the full backend suite and confirm one migration head**

```bash
cd backend && python -m alembic heads && python -m pytest
```

Expected: exactly one head (`i4d5e6f7a8b9`), all tests pass.

- [ ] **Step 5: Verify the migration against real PostgreSQL**

SQLite cannot verify PostgreSQL partial indexes. Against a disposable Postgres (the Docker stack is fine):

```bash
cd backend && python -m alembic upgrade head && python -m alembic downgrade -1 && python -m alembic upgrade head
```

Expected: all three succeed. A failure here is a failed deployment, not a UI empty state.

- [ ] **Step 6: Confirm only intended files changed**

```bash
git status && git diff --check
```

- [ ] **Step 7: Commit**

```bash
git add frontend/e2e/campaign-sync.spec.ts
git commit -m "test(campaigns): cover sync control on desktop and mobile"
```

---

## Post-Implementation Verification

Before reporting completion, confirm with actual command output:

- [ ] `cd backend && python -m alembic heads` → exactly one head
- [ ] `cd backend && python -m pytest` → all pass
- [ ] `cd frontend && npm run typecheck` → clean
- [ ] `cd frontend && npm run build` → succeeds
- [ ] `cd frontend && npm run doctor` → reviewed, no new diagnostics
- [ ] `npx playwright test e2e/campaign-sync.spec.ts` → passes desktop and mobile
- [ ] `git diff --check` → clean

## Known Limitations To Report

State these plainly when handing over; do not let them be discovered later:

1. **No live credentials are exercised by any test.** Every provider client is verified against fixtures. The first real sync is the first true test of Meta, Google and TikTok auth.
2. **Google Ads needs Basic Access.** A developer token at test-account level will fail against production accounts regardless of code correctness.
3. **The scheduler is in-process.** Multiple replicas each run the nightly sync and consume quota proportionally, as `scheduler.py:5` already notes for existing jobs.
4. **Conversion definitions are opinionated.** `CONVERSION_ACTIONS` in `meta.py` fixes what counts as a Meta conversion; a client counting a different action type will see different numbers than Ads Manager.
5. **Campaign level only.** No ad-set or creative breakdowns.
