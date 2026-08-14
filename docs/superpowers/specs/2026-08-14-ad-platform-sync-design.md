# Ad Platform Sync for Campaign Studio — Design

Date: 2026-08-14
Status: Approved for planning

## Problem

Campaign Studio shows zeros. Users enter credentials for Facebook, Google Ads
and TikTok under Settings → Marketing integrations, see a "Connected" badge, and
expect campaign data to appear. Nothing arrives.

The integrations feature is credential storage only:

- `INTEGRATIONS` in `backend/app/services/app_settings.py:124` declares field
  specs to encrypt and store. No endpoints, API versions, or field mappings.
- `get_integration()` (`app_settings.py:163`) is defined but never called from
  anywhere. The only consumer of the module is `backend/app/api/settings.py:145`,
  which renders the settings form.
- No ad-platform HTTP client exists. The backend's only outbound calls are
  Microsoft Graph, BambooHR, captcha verification, and AI help.
  `backend/app/services/integrations.py` is HR provisioning despite its name.
- `CampaignMetric` rows only enter via manual `POST /metrics` or CSV import.

The "Connected" badge is computed as `any(field is non-empty)`
(`app_settings.py:212`). It means a field was filled in — not that the token is
valid, correctly scoped, or that the account was ever reached.

## Decisions

| Decision | Choice |
|---|---|
| Credentials | Long-lived / System User tokens. No OAuth flow needed. |
| Campaign mapping | Mirror — one local campaign per remote campaign. |
| Trigger | Manual "Sync now" button plus a nightly scheduled job. |
| Currency | Convert to AED at sync time, storing the original for audit. |
| FX source | Admin-editable rate table in Settings. No external FX dependency. |

## Scope Correction: Instagram

Instagram is not a separate ad platform. Instagram ads are bought through Meta
ad accounts; there is no independent Instagram Ads API for spend. The existing
`instagram` entry in `app_settings.py:132` (`ig_account_id` + `access_token`)
cannot produce ad metrics.

The Meta client queries insights with `breakdowns=publisher_platform`, which
splits facebook and instagram spend out of the same ad account. One Meta
credential therefore feeds two channels.

The standalone `instagram` integration entry is left in place (unused for ads)
rather than removed, since it may serve organic social later.

**Three provider clients (Meta, Google Ads, TikTok) covering four channels.**

## Architecture

```
POST /api/campaigns/sync ─┐
                          ├─→ ad_sync/service.py ─→ ad_sync/meta.py       → facebook, instagram
nightly scheduler job ────┘         │                ad_sync/google_ads.py → google
                                    │                ad_sync/tiktok.py     → tiktok
                                    │
                                    ├─→ ad_sync/fx.py   (AED rates from app_settings)
                                    └─→ upsert Campaign + CampaignMetric
```

New package `backend/app/services/ad_sync/`:

- `base.py` — `NormalizedMetric` dataclass and the `AdProvider` protocol:
  `fetch(cfg, since, until) -> list[NormalizedMetric]`. Providers return
  normalised rows and know nothing about the database, currency conversion, or
  upserting.
- `meta.py`, `google_ads.py`, `tiktok.py` — one module per platform. Each
  follows API pagination cursors to completion; ignoring them silently truncates
  data at the first page.
- `fx.py` — resolves a currency's AED rate from the admin table.
- `service.py` — orchestrator. Iterates configured providers, converts currency,
  upserts, records a run. One provider failing must not abort the others.

Rejected alternatives:

- **Monolithic sync service with per-provider branches** — currency, upsert and
  error logic tangles with four API shapes in one module; testing one platform
  requires loading all of them.
- **External worker (Celery/RQ)** — adds a broker and a second deployable to a
  single-container stack, unjustified for four nightly API calls.

## Data Model

One Alembic revision containing three changes, to keep a single migration head.

### `campaigns`

| Column | Type | Notes |
|---|---|---|
| `provider` | `String(16)` nullable | `meta`\|`google_ads`\|`tiktok`; NULL for manual campaigns |
| `external_id` | `String(64)` nullable | Remote campaign id |

Partial unique index on `(provider, external_id) WHERE provider IS NOT NULL`.
Manually-created campaigns keep both NULL and are unaffected.

`provider` is the source platform and lives at campaign level; `channel` stays at
metric level. These are deliberately distinct: one `meta` campaign produces both
`facebook` and `instagram` metric rows via the `publisher_platform` breakdown, so
a synced Meta campaign is the one case where the by-channel table is genuinely
multi-channel.

### `campaign_metrics`

| Column | Type | Notes |
|---|---|---|
| `source` | `String(8)` not null, default `manual` | `manual`\|`csv`\|`sync` |
| `currency` | `String(3)` nullable | Currency reported by the platform |
| `spend_original` | `Numeric(14,2)` nullable | Pre-conversion spend |
| `revenue_original` | `Numeric(14,2)` nullable | Pre-conversion revenue |
| `fx_rate` | `Numeric(18,8)` nullable | Rate applied at sync time |

Existing rows backfill to `source='manual'`.

**The idempotency index must be partial:**

```sql
CREATE UNIQUE INDEX ... ON campaign_metrics (campaign_id, channel, date)
WHERE source = 'sync';
```

A blanket unique constraint on `(campaign_id, channel, date)` would fail the
migration on any existing campaign holding two manual rows for the same channel
and date, and would permanently break the "Add row" form, which allows exactly
that. The partial index makes sync rows idempotent while leaving manual entry
unrestricted.

### `ad_sync_runs` (new)

`id`, `provider`, `started_at`, `finished_at`, `ok`, `campaigns_synced`,
`metrics_upserted`, `error` (Text, nullable). Without this table the UI cannot
show "last synced" or explain why a provider went quiet.

## Sync Semantics

**Rolling 30-day re-fetch, not append.** Ad platforms restate history: a
conversion attributed to Monday can land in the API days later, and Monday's
numbers keep changing for up to the 28-day attribution window. An append-only
sync would freeze incorrect numbers and double-count on re-run. Each run
re-fetches the last 30 days and upserts over them.

**First run per provider backfills 90 days**, then settles into the rolling
window.

**Sync writes only `source='sync'` rows.** Existing manual and CSV data is never
read, modified, or deleted by the sync. Both coexist within a campaign.

**Campaigns upsert on `(provider, external_id)`**, refreshing name and status. A
campaign deleted on the platform is not deleted locally — that would destroy
spend history. It retains its rows and stops updating.

**Currency.** Each provider reports its account currency; `fx.py` resolves the
AED rate from app settings, stored as `fx_rate_<CUR>` keys (e.g. `fx_rate_USD`)
via the existing `app_settings` mechanism. No new table is introduced for rates.
`AED` itself resolves to `1.0` implicitly and needs no configuration. A currency with no configured rate fails that
provider's run with an explicit error and writes nothing. There is no 1:1
fallback: a silent 1:1 on a USD account would understate spend by 3.67x and look
entirely plausible.

Each metric row stores `spend_original`, `currency`, and `fx_rate` alongside the
converted AED value, so any conversion can be audited and recomputed if a rate
was wrong.

**Failures isolate per provider.** Meta being unavailable must not stop Google
and TikTok. Each outcome is recorded independently in `ad_sync_runs`, with the
platform's error text truncated and surfaced verbatim — matching the existing
convention in `services/integrations.py`.

## Scheduler

`run_ad_sync(db) -> dict` conforms to the existing `_periodic(name, runner,
interval, warmup)` contract in `backend/app/services/scheduler.py:39`, returning
a `created` count. Registered in `start_scheduler()` at a 24-hour interval.

Operational caveat: the scheduler is in-process, so a multi-replica deployment
runs the sync once per replica and consumes API quota proportionally.
`scheduler.py:5` already documents this tradeoff for existing jobs and
recommends external cron against the manual endpoints; the same applies here.

## API

| Endpoint | Auth | Purpose |
|---|---|---|
| `POST /api/campaigns/sync` | admin | Trigger a pull. Optional `providers[]`, `since`. Returns per-provider results. |
| `GET /api/campaigns/sync/runs` | module | Last run per provider for the status strip. |
| `POST /api/settings/integrations/{provider}/test` | admin | Cheap read call; returns account name + currency, or verbatim error. |
| `GET`/`PUT /api/settings/fx-rates` | admin | Currency to AED rate table. |

The sync trigger is admin-gated on top of the existing module gate: it writes
financial data across brands and consumes rate-limited quota.

The test endpoint makes the badge honest — "Connected" comes to mean the account
was reached, not that a field is non-empty.

## Frontend

- **"Sync now"** in the `PageHead` action slot beside "+ New campaign"; toast
  reports rows upserted per provider.
- **Sync status strip** — per-provider last-synced time with inline error text on
  failure. Rendered only when at least one integration is configured, so it stays
  invisible to users who do not use it.
- **Provider badge** on synced campaigns in the table, and a `source` column in
  the metric rows table so synced and manual data are distinguishable.
- **"Test connection"** per provider in `IntegrationsSettings`, showing resolved
  account name and currency on success.
- **FX rate table** in Settings, admin-only.
- Card presentation at Pixel 5 width for the status strip and campaigns list, per
  the responsive requirement in `AGENTS.md`.

All UI uses installed shadcn primitives imported from `@/components/ui/<name>`,
semantic tokens, and square surfaces, per `AGENTS.md` and
`docs/FRONTEND_COMPONENTS.md`.

## Testing

Provider clients are tested against recorded fixture JSON through a stubbed httpx
transport. No live API calls in the suite.

The tests that matter are the ones catching silent data corruption:

| Test | Catches |
|---|---|
| Idempotency — run same fixture twice, totals unchanged | Double-counted spend |
| Restatement — second run with changed conversions updates in place | Duplicate rows |
| Pagination — two-page fixture, both consumed | Truncation passing as success |
| Missing FX rate — run fails, zero rows written | Silent 1:1 conversion |
| Manual rows untouched by sync | Sync clobbering hand-entered data |
| Non-admin gets 403 on sync trigger | Authorization gap |

Plus per-platform parsing tests (Meta `actions`/`action_values` nesting, Google
Ads micros division, TikTok response envelope).

Gates per `AGENTS.md`: `python -m alembic heads` returning exactly one head,
`python -m pytest`, focused Playwright specs on desktop and mobile projects, and
`npm run typecheck && npm run build && npm run doctor`.

## Out of Scope

- Grouping multiple remote campaigns under one local campaign (mirroring only).
- OAuth connect flows (long-lived tokens are supplied manually).
- Automatic FX rate fetching from an external provider.
- Organic social metrics; this covers paid ad performance only.
- Ad-set or creative level breakdowns; campaign level only.
