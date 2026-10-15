# Performance audit — 14 October 2026

Baseline: remote `master`, commit `1c6d5414b5ff97f1702063110c1c423acc3a5753`.
The proposed changes were benchmarked locally. Production has not been deployed
or measured as part of this audit.

## What was measured

The largest costs were unnecessary work: materializing every analytics event,
loading all SharePoint tabs together, fetching feeds for inactive tabs, and
shipping uncompressed build assets without a durable cache policy. The UI
already had lazy top-level routes; adding more top-level route wrappers would
not address these costs.

Measurements use production Vite builds, local Chromium 149.0.7827.55, five
fresh browser processes per route and viewport, 4× CPU throttling, and the
configured Desktop Chrome/Pixel 5 devices. API responses are deterministic
offline fixtures. Third-party requests are counted and aborted; no Microsoft,
mail, or AI requests are sent. The browser server is local, uncompressed, and
uncached so that route/code changes can be compared independently of nginx.
Readiness means the route's actual fixture content has rendered, rather than
the shell or a loading indicator. Timing ranges are retained in raw results.

Analytics measurements use seven warmed calls with allocation tracing, a
disposable SQLite database, and 50,000 clicks plus 50,000 scans. The trace adds
overhead to timings; its purpose is a controlled comparison and memory/query
counts, not a prediction of PostgreSQL production latency. Asset tables are
empty in this volume benchmark; behavior tests cover asset calculations.

Delivery measurements use a real portable nginx 1.30.5 executable, the checked
in server block, and seven requests per asset. Only its local port, static root,
and backend upstream are substituted. Before and after use the same build.
Docker and production network behavior have not been measured.

## Changes measured separately

| Change | Before | After | Evidence and decision |
| --- | --- | --- | --- |
| Group click/scan days in SQL | 615.33 ms; 17,469,240 B traced peak | 82.92 ms; 36,131 B | Kept. Daily totals remain 50,000 for each event table; Python receives daily counts instead of every timestamp. |
| Batch overview scalar totals | 82.92 ms; 14 SELECTs | 72.50 ms; 5 SELECTs | Kept. Independent scalar subqueries avoid joins and preserve empty-table totals. |
| Disposable test DB in memory | Three identical tests: 9.13 s | 1.77 s | Kept. About 5.2× faster without deleting tests; per-test schema recreation remains. |
| Split SharePoint tabs/dialog | Home: 1,065,074 B JavaScript | 774,214 B before subsequent shell changes | Kept. Other tabs and document preview load when needed. |
| Preload the active SharePoint tab alongside status | First lazy-only document run: 1,394/1,298 ms desktop/mobile | 1,059/1,112 ms | Kept to remove the new code/status waterfall. These exploratory timing runs are noisy; final comparisons below are the timing evidence. |
| Enable only active SharePoint feeds | Admin: 1 search, 1 source-options, 2 reminders; Assistant: 2 searches | Admin: 0 searches/options, 1 shell reminder; Assistant: 1 search | Kept. Request reductions are deterministic. Focus/poll access checks remain for active data and status. |
| Defer React Flow and its CSS | Org default list: 914,139 B JS; 209,720 B global CSS | 739,773 B JS; 194,308 B CSS before shell change | Kept. Tree loads on selection; zoom, expand/collapse, themes and mobile behavior remain covered. |
| Defer command palette/password dialog | Security after chart change: 695,189 B JS | 633,802 B | Kept. Canonical navigation replaces runtime injection that forced the palette into the shell. |
| Remove unconditional Inter stylesheet | One third-party stylesheet on every startup | Zero on default startup | Kept. Companies selecting Inter still load it after startup. No font-latency claim is made because external requests are aborted in benchmarks. |
| Compress/cache hashed nginx assets | Entry JS + global CSS: 471,966 B body transfer | 118,606 B | Kept. 74.9% less cold transfer for these assets; immutable hashed assets can be reused on later visits. |

The early SharePoint lazy-only change reduced bytes but introduced a status/code
waterfall on several routes. That implementation was revised before acceptance.
Intermediate interrupted runs are not used to claim complete timing results.
Each retained optimization has byte, request, query, allocation, or test-time
evidence; a small or overlapping timing difference is not treated as proof.

## Final browser comparison

Final values are recorded in `qa-out/performance/baseline-final.json` and
`qa-out/performance/final.json`. Both have `complete: true`. These repeat the untouched build and final
build sequentially using the same harness. They isolate browser work and API
request counts, rather than live provider/network latency.

All byte columns below are decoded JavaScript, in decimal kB. Timing columns
show the median content-ready time in milliseconds, before → after.

| Route | JS kB | Desktop ms | Pixel 5 ms |
| --- | ---: | ---: | ---: |
| Security | 690.8 → 634.1 | 873 → 749 | 770 → 707 |
| SharePoint home | 1,065.1 → 718.2 | 1,024 → 924 | 949 → 801 |
| Documents | 1,065.1 → 727.7 | 1,145 → 945 | 1,087 → 874 |
| Assistant | 1,065.1 → 852.9 | 1,026 → 1,137 | 1,011 → 1,063 |
| Source administration | 1,065.1 → 702.5 | 1,356 → 1,305 | 1,077 → 1,134 |
| Organization list | 914.1 → 682.7 | 1,104 → 1,017 | 806 → 854 |

Home and Documents improve in both viewports. Assistant startup is slower in
this zero-latency API fixture, by 111 ms desktop and 52 ms mobile, despite less
script CPU work (633 → 546 ms and 592 → 522 ms). Its delayed feature import has a
startup cost; retaining it saves 20% of JavaScript and cuts startup API requests
from nine to six. The retained tradeoff is less code/provider work across the
module, not a claim that every route starts faster. First use of the tree,
palette, password dialog, or document preview must also download its chunk.

Small changes in source administration/organization timings overlap sample
ranges and are inconclusive. For example, the mobile organization baseline
ranges from 798–1,460 ms, versus 791–1,041 ms after. No production timing or
Core Web Vitals improvement is inferred from these local measurements.
All 120 final comparison samples render without page errors or horizontal
overflow. Global CSS drops from 209,720 to 194,308 bytes on these routes, and
the default external font stylesheet request drops from one to zero.

The final harness waits for observed startup requests to finish and remain idle
for 500 ms. A navigation `networkidle` wait timed out after mocked responses in
an earlier run; that interrupted run was discarded. Per-sample watchdogs and a
completion flag prevent an interrupted run from being mistaken for a full one.

## Static delivery

Rechecked on the same final build using the original and optimized nginx server
configurations (`nginx-baseline-final.json` and `nginx-final.json`):

| Asset | Before body bytes | After body bytes | Reduction |
| --- | ---: | ---: | ---: |
| Entry JavaScript | 277,658 | 87,676 | 68.4% |
| Global CSS | 194,308 | 30,930 | 84.1% |
| PDF module worker | 1,255,067 | 374,560 | 70.2% |
| Already compressed DM Sans WOFF2 | 36,932 | 36,932 | 0% |

nginx uses gzip only within `/assets/`, sets `Vary: Accept-Encoding`, and sends
`Cache-Control: public, max-age=31536000, immutable` for Vite fingerprints.
`index.html` revalidates with `no-cache`. Missing build assets return 404 instead
of an HTML success response. The `.mjs` worker retains `application/javascript`.
API responses and uploaded media retain their existing policies.

Compression has a CPU cost: median localhost JS/CSS/worker request times were
7.66/5.09/23.41 ms before and 12.25/7.15/41.93 ms after. These loopback requests
make bandwidth effectively free. The accepted gain is fewer transferred bytes
and reusable immutable assets, not lower loopback server latency. See the
[nginx gzip documentation](https://nginx.org/en/docs/http/ngx_http_gzip_module.html).

## Code, design, and test audit

- Reviewed route loading, shell dependencies, navigation, SharePoint async
  state/polling, analytics SQL/response semantics, static delivery, and test
  fixtures. Kept the existing square component system, responsive layouts,
  permission gates, same-origin cookies, and document search POST bodies.
- A static import graph reached all 209 frontend implementation files from
  `main.tsx`, including dynamic imports. This finds no whole-file deletion
  candidates; it does not prove that every exported symbol or feature is used.
  TypeScript's existing `noUnusedLocals` and `noUnusedParameters` also pass.
- Removed duplicate routine-navigation injection/fallback code, the redundant
  authenticated login route, and replaced the analytics per-row bucket/count
  helpers with aggregate queries. No speculative component/dependency deletion
  or blanket memoization was applied.
- Retained the test suite. The expensive repeated schema setup was the clear
  test-performance cost, not unnecessary assertions. Added behavior coverage
  for analytics auth/empty/history/assets/query count and active-feed requests,
  and extended UI journeys to verify deferred features still open.
- `npm audit` recorded 23 existing dependency findings (5 moderate, 17 high,
  1 critical). No dependency versions were changed in this performance patch.
  Major/transitive upgrades require a separate compatibility review; the audit
  report is saved locally in `qa-out/audit.json`.

## Validation and limits

- Backend: 655 passed, 9 skipped, 433.60 seconds. Skips require disposable
  PostgreSQL environments or a local OCR binary. No migrations changed;
  Alembic has one head, `y1c2d3e4f5a6`.
- Frontend typecheck/build pass; React Doctor: 100/100, no diagnostics.
  Its existing configuration was not weakened.
- All 80 focused desktop/mobile cases have passing results. The first final
  run passed 78; two new font cases had incorrect test assumptions about the
  desktop-only switcher and the independent brand editor. After correcting
  those assumptions, all eight marketing/brand cases passed on rerun. No app
  code changed between these runs. Logs: `qa-out/final-e2e.log` and
  `qa-out/font-e2e-fixed.log`. Coverage includes deferred feature imports,
  dialogs, tree interaction, search/navigation/polling, revoked access,
  Arabic/RTL document details, responsive layouts and accessibility checks.
- Real nginx compression/cache/MIME/404 assertions pass on the final build;
  see `qa-out/performance/nginx-final.json`. `git diff --check` passes.
- Browser tests use mocked APIs. They verify layouts, interactions, error/access
  states, and request behavior, not live Microsoft connectivity or production
  response times. Docker's daemon is unavailable locally. No deployment occurred.
- Analytics still reads tracked assets to calculate depreciation/warranty
  details. The event-volume fix does not claim to eliminate that separate cost.
  Live PostgreSQL query plans, database/network latency, large real document
  collections, and field Core Web Vitals remain the next measurement targets.

## Reproduce

Keep before and after builds separate. Run measurements serially without builds,
test suites, or other browser benchmarks competing for CPU. Raw measurements,
screenshots, logs, dependencies, and temporary servers stay under ignored
`qa-out/`, `dist/`, and `.venv/`; do not commit them.

From `frontend/` (PowerShell):

```powershell
npm ci
npm run build
$env:BENCHMARK_RUNS = '5'
$env:BENCHMARK_SCREENSHOTS = '1' # optional
node scripts/benchmark.mjs after
# An existing untouched build can be measured without overwriting dist:
$env:BENCHMARK_DIST = '../qa-out/performance/baseline-dist'
node scripts/benchmark.mjs before
Remove-Item Env:BENCHMARK_DIST
# Optional route subset: BENCHMARK_PATHS=/security,/org-chart
```

For real nginx delivery, provide an installed/local executable; the script
never downloads one or calls the backend. On Windows it uses `conf/mime.types`
next to that executable:

```powershell
$env:NGINX_BINARY = 'C:/path/to/nginx.exe'
$env:BENCHMARK_EXPECT_OPTIMIZED = '1'
node scripts/benchmark-nginx.mjs after
# BENCHMARK_NGINX_CONFIG may point to a saved original server configuration.
# Clear BENCHMARK_EXPECT_OPTIMIZED when measuring the original configuration.
```

From `backend/`, using the project's dependency environment:

```powershell
python scripts/benchmark_analytics.py after
python -m pytest tests/test_analytics.py --durations=10
python -m pytest
python -m alembic heads
```

The analytics script creates and deletes its own temporary SQLite DB, never a
configured production DB. `BENCHMARK_EVENTS` optionally controls volume. The
test fixture still unconditionally selects a disposable database before app
singletons are imported.
