# Architecture

## Overview

```
┌────────────┐       OIDC        ┌──────────────────┐   SQLAlchemy   ┌────────────┐
│ Azure      │◀─────────────────▶│ FastAPI backend  │◀─────────────▶│ PostgreSQL │
│ Entra ID   │                   │                  │   (async)      │            │
└────────────┘                   └─────────▲────────┘                └────────────┘
                                          │
                              same-origin /api/*
                              HttpOnly session cookie
                                          │
                                ┌─────────▼────────┐
                                │ React SPA       │
                                │ Vite or nginx   │
                                └──────────────────┘
```

## Authentication flow

SharePoint Intelligence has a separate delegated Microsoft connection. Its
module gate does not grant document access: every content response checks current
workspace assignments/team scope, live delegated Graph metadata/content access,
and the configured folder scope. Employees see their assigned documents,
managers see their team's documents and department review inbox, and admins
have global workspace scope. The Assistant uses the same boundary and never
falls back to raw indexed records when Microsoft access is unavailable. An
app-only read grant powers ingestion only. Microsoft tokens are encrypted,
direct AI analysis creates owned compliance tasks when facts are clear, and a
database lease owns durable sync runs. See [SharePoint setup and architecture](SHAREPOINT_INTELLIGENCE.md)
for the data boundary, failure handling, configuration and operational limits.

1. SPA sends the user to `GET /api/auth/login`.
2. Backend redirects to Azure Entra ID (Authlib OIDC).
3. Azure redirects back to `GET /api/auth/callback` with an auth code.
4. Backend exchanges the code, calls Microsoft Graph `/me`, **upserts** the
   user into PostgreSQL, and mints a short-lived signed application session.
5. Backend sets the session in the HttpOnly, SameSite=Lax
   `ag_platform_session` cookie (`Secure` in production) and redirects to
   `FRONTEND_BASE_URL/auth/callback`.

### Who may sign in through SSO

Membership is governed in Azure, not in this application. The app registration
is restricted to an approved group ("User assignment required" = Yes), so
completing SSO *is* the approval step: a `pending` account is activated during
the callback rather than waiting for an administrator.

Two gates still apply in the backend, in this order:

- the **email-domain allowlist** (`allowed_email_domains`), checked before any
  account is provisioned;
- the **account status** — anything other than `active` is refused a session
  and redirected to `/login?error=account_inactive`.

Only `pending` is cleared automatically. Use `disabled` to revoke someone's
access: setting an account back to `pending` would be undone by their next SSO
sign-in. Local password login is unchanged and still requires an `active`
account, so accounts that never use SSO keep the administrator approval step.
6. The SPA stores no credential in browser storage. Its same-origin `/api/*`
   requests use `credentials: "include"`; `get_current_user` validates the
   cookie and loads the `User` row. A Bearer credential remains supported for
   non-browser API clients.

Local password login uses the same application session cookie. In development,
Vite proxies `/api`, media, and redirect routes to FastAPI so the browser keeps
one cookie origin. Production nginx provides the equivalent same-origin proxy.

Authlib stores temporary OIDC authorization state in Starlette's signed,
HttpOnly, SameSite=Lax `session` cookie. That cookie is also `Secure` in
production. Production must therefore be browser-facing HTTPS, even when a
proxy terminates TLS in front of FastAPI.

Module-scoped feature routers are protected server-side by the catalogue in
`backend/app/core/permissions.py`; other sensitive routes enforce role or
ownership checks in their handlers. The frontend uses matching module keys for
module-scoped route and navigation visibility, but hidden UI is never the
authorization boundary.

### Two independent layers

Access answers two separate questions, and they are deliberately kept apart:

1. **May this person use it?** Role, access department and per-user grants,
   resolved by `resolve_permissions` into `User.effective_permissions`.
   Administered in Departments & Access, per team.
2. **Is it switched on at all?** An org-wide set of disabled module and feature
   keys, stored as one JSON list under the `disabled_features` key in the
   `app_settings` table — so adding a switch needs no migration. Administered in
   Settings -> Modules & features, for the whole company at once.

A disabled key is closed to **everybody, administrators included**; only the
settings routes, which are admin-gated rather than module-gated, stay reachable
so it can be switched back on. `dashboard` cannot be switched off. Nothing is
deleted, so re-enabling restores the module untouched.

`FEATURES` in `backend/app/core/permissions.py` names the parts of a module that
can be switched off on their own, keyed `module.feature`. A feature is listed
there only when it maps to a whole router or a small explicit set of routes plus
a page, so the switch is enforced on both ends. A feature is also unreachable
whenever its module is off.

Three dependencies apply the layers, all in `permissions.py`:

- `require_module("tasks")` — module switched on **and** held by the user.
- `require_feature("hr.payroll")` — module and feature switched on, module held.
  Features are never granted separately; they narrow what a module offers.
- `require_enabled("hr.benefits")` — the switch only, leaving the router's own
  in-handler authorization alone. Used where employees reach their own records
  (payslips, benefit enrolments) and a module gate would take that away.

Handlers that fan out across modules — global search, the calendar feed,
attachments — use `active_permissions(user, db)` rather than
`effective_permissions`, so a switched-off module cannot leak content through a
surface belonging to a different module.

The SPA learns the state from `/api/auth/me`, which adds `disabled_modules` and
`disabled_features` alongside the unchanged `effective_permissions`; `can()` in
`AuthContext` subtracts them for navigation and route guards. Reads are cached
in-process for 30 seconds and invalidated on write, so a single-process
deployment sees a change at once and additional replicas within the TTL.

Department membership mutations lock only the employee row (`FOR UPDATE OF
users`), including when an admin changes their own membership. The optional
manager is eagerly loaded through an outer join and must not be locked with
the employee. Permission changes and their audit entry share one transaction.
SQLite does not exercise PostgreSQL row locks. To run the membership regression
tests, set `DEPARTMENT_TEST_DATABASE_URL` to a disposable local PostgreSQL URL
using the `postgresql+psycopg` driver and database name `department_lock_test`,
then run `python -m pytest tests/test_departments_postgres.py` from `backend/`.
The tests use a temporary schema, clean it up afterwards, and reject remote
hosts or other database names.

## Task assignment and oversight

Ordinary task routes share an ownership/team boundary with their attachments.
The Tasks page also adapts authorized compliance tasks without duplicating
records. Assignment notifications and email delivery entries commit together;
a retry worker checks current ownership and live SharePoint access before
sending document details. See [Tasks](TASKS.md) for permissions, progress,
email configuration, and delivery guarantees.

The project tracker (`/api/pm`, `app/api/pm.py`) is separate from ordinary
tasks. It is gated by the `projects` module and then by per-project membership
(`app/services/pm_access.py`); being a manager elsewhere grants nothing there.
It also serves read-only public share links (`/api/public/pm-shares/`) and an
MCP endpoint for AI assistants at `/api/mcp/`, authenticated by personal access
tokens rather than the session cookie. See [Project tracker](PROJECT_TRACKER.md).

## Modules & key endpoints

| Feature | Module | Auth endpoints | Public endpoints |
|---|---|---|---|
| 1. Directory | `api/users.py` | `GET /api/users`, `GET /api/users/{id}`, `PATCH /api/users/{id}`, `POST /api/users/sync` | – |
| 2. Digital cards | `api/cards.py` | `CRUD /api/cards`, `GET /api/cards/{id}/qr.png`, `GET /api/cards/{id}/leads` | `GET /api/public/cards/{slug}`, `POST /api/public/cards/{slug}/leads` |
| 3. Marketing assets | `api/assets.py` | folders + `POST/GET/DELETE /api/assets`, `/download` | – |
| 4. Brand center | `api/branding.py` | kits + `/assets` upload/download | – |
| 5. QR & brochures | `api/qrcodes.py`, `api/products.py` | QR CRUD + `/image.png` + `/preview.png`; products + brochures | `GET /api/public/brochures/{id}/download` |
| 6. Landing pages | `api/landing.py` | `CRUD /api/landing-pages` | `GET /api/public/landing-pages/{slug}` |
| 7. Email signatures | `api/signatures.py` | templates + `POST /api/signatures/render` | – |
| 8. URL shortener | `api/shortener.py` | `CRUD /api/short-links` | `GET /s/{code}` (302 redirect) |
| 9. Secure transfers | `api/transfers.py` | `POST/GET /api/transfers`, `DELETE /api/transfers/{id}` | `GET /api/public/transfers/{token}/meta`, `POST /api/public/transfers/{token}/download` |
| 10. Routine checks | `api/checklists.py` | `CRUD /api/checklist-templates` + `/generate`, `/generate-due`, `/samples`; `/api/checklist-runs` + `/{id}/claim`, `/submit`, `/verify`, `/items/{id}`, `/summary` | – |

### Website intake (WordPress / Contact Form 7 → CRM)

`api/intake.py` receives form submissions from connected websites and turns them
into CRM leads, recruiting candidates or tickets.

- Public: `POST /api/intake/ingest`, `POST /api/intake/ingest/schema`,
  `GET /api/intake/ingest/ping` — authenticated by a per-site key, optionally
  HMAC-signed with a timestamp replay window.
- Managed (`crm` module): `/api/intake/submissions`, `/api/intake/sources`,
  `/api/intake/forms` (+ `/mapping`, `/preview-mapping`, `/remap`),
  `/api/intake/routing-rules`, `/api/intake/blocklist`. Reads are open to CRM
  users; anything that changes how data is interpreted is admin-only.

Three ideas carry the design, and are worth knowing before changing anything
here:

1. **The submitted body is stored verbatim** (`Submission.raw_payload`). Every
   other column is derived from it, so a mapping can be corrected and replayed
   rather than the data being lost. Do not weaken this.
2. **Field mapping is per form** (`IntakeForm.mapping`), because form builders
   let each site name its fields freely — there is no shape to hardcode.
   `services/intake_mapping.py` is pure, so replay produces exactly what live
   ingestion produced.
3. **Screening is layered** (`services/spam/`): blocklist, captcha, content,
   cross-site correlation, and a filter that learns from the team's own
   quarantine decisions. Content matching alone cannot catch a well-formed bot
   submission.

Job applications route to `Candidate` in Recruiting and never create a CRM lead,
which also keeps CVs behind the HR-only `recruiting` module.

Full payload contract, mapping model and plugin notes: `docs/INTAKE_CF7.md`.

### CRM pipeline (`crm` module)

`api/crm.py` serves leads (`CrmLead`) and their timeline (`CrmActivity`); every
route sits behind the `crm` module gate.

- Stages, in order: `new`, `contacted`, `qualified`, `proposal`, `negotiation`,
  `won`, `lost` (`LEAD_STATUSES` in `models/crm.py`; the first five are open).
  Moving a lead into `lost` requires `lost_reason`; leads lost before reasons
  existed stay editable. Leaving `lost` clears the reason.
- Qualification fields: `priority` (high/medium/low), `tags` (lowercase JSON
  list, filtered as a whole quoted entry), `follow_up_date`, `next_step`,
  `expected_close_date` and `last_contacted_at`, which is set when a call, email
  or meeting is logged.
- Timeline: `GET|POST /api/crm/leads/{id}/activities`. People log `note`,
  `call`, `email` and `meeting` entries and may delete their own (admins any).
  The API writes `created`, `change` (stage, owner, value, priority, follow-up)
  and `import` entries itself; those can't be deleted.
- Authorization: any CRM user can view and edit leads; only an admin or the
  lead's owner can delete it (`can_delete` on each lead). `POST
  /api/crm/leads/bulk` assigns, re-stages or deletes up to 500 leads all or
  nothing. Assigning a lead to someone else sends them an in-app notification.
- `GET /api/crm/leads/page` adds `priority`, `tag`, `follow_up=overdue|today|
  upcoming|none` (open leads only) and `sort=follow_up`. `GET
  /api/crm/leads/export` downloads the same filtered list as CSV (up to 20,000
  rows), prefixing formula-like cells with `'` so spreadsheet apps don't run
  text from public web forms; the import strips that prefix again.
- Import: `POST /api/crm/import/preview` reads a CSV or XLSX (5 MB, 5,000 rows),
  suggests a column mapping, picks the first sheet that looks like contacts, and
  reports errors, warnings and duplicate emails without saving. `POST
  /api/crm/import` takes the same file plus optional `mapping`, `sheet` and
  `on_duplicate=skip|merge`. Duplicates match emails case-insensitively, against
  the CRM and earlier rows of the file. Merge fills only empty fields, unions
  tags and adds the row's notes to the timeline. Parsing lives in
  `services/crm_import.py`.

### Routine checks (recurring checklists)

Replaces paper daily rounds. A `ChecklistTemplate` describes the round —
sections, checkpoints, response types, photo rules, schedule and routing — and
is department-agnostic, so a new team adopts the feature by authoring a
template rather than by shipping code.

A **run** is an ordinary `Task` carrying `template_id` + `run_date`, unique
together. `services/checklist_runs.py` materialises runs from the calendar (via
the scheduler, hourly) instead of chaining them off completion, so a skipped day
leaves a visible unsubmitted run rather than silently ending the series. Runs
are excluded from `GET /api/tasks` unless `include_runs=true`, and cannot be
mutated through the tasks API.

`TaskItem` carries the response: `status` (`pending|ok|issue|na|done`), a note,
a reading, a `section` heading, an optional `asset_id` and `photo_required`.
Photos attach through the generic attachments endpoint with
`entity_type="task_item"`. Submission is refused while anything is unanswered
or a required photo is missing; a template with `requires_verification` then
waits for the reviewer to verify or send it back — the digital counterpart of
the form's "Checked By" / "Verified By" signatures.

Marking an item `issue` opens a `Ticket` in the owning team's category carrying
the checkpoint's asset, so the existing SLA engine owns the follow-up.
`GET /api/checklist-runs/summary` reports completion, lateness and the
checkpoints that fail most often.

### Secure transfer encryption (feature #9)

Files are encrypted at rest with **Fernet (AES-128-CBC + HMAC)**. The key is
derived with **HKDF-SHA256** from a high-entropy URL token (32 bytes) plus an
optional password and a per-transfer random salt. The database stores only:

- `token_hash` — `sha256(token)` for lookup (not reversible to the token), and
- `salt` + `password_hash` (PBKDF2-SHA256).

The token itself lives **only in the share link**, so a database compromise
alone cannot decrypt the payload. On download the ciphertext is decrypted and —
for one-time transfers — the file is deleted and the record marked consumed
(burn-after-read). Expired transfers are purged lazily on access. If SMTP is
configured the share link is emailed to the recipient; otherwise the sender
copies it from the UI.

## Data model highlights

- All tables use UUID primary keys + `created_at`/`updated_at` (see
  `app/models/base.py`).
- `User.azure_oid` is the stable Entra identity used for upserts; email is the
  fallback match key.
- Analytics: `card_scans`, `link_clicks`, `Brochure.download_count`,
  `LandingPage.view_count`, `QRCode.scan_count`.
- Landing pages store their layout as a JSON block list in `LandingPage.blocks`
  (rendered by the SPA builder/public page) plus a self-contained static HTML
  snapshot in `LandingPage.html` for portability/embedding.
- Website intake keeps the inbound body untouched in `Submission.raw_payload`;
  `payload` holds only the fields no mapping rule claimed, and field *labels*
  live on `IntakeForm.fields` rather than the submission, so relabelling a form
  retro-fixes every past record without a migration.

## Storage

Uploaded files are written under `MEDIA_ROOT` and served at `MEDIA_URL`
(dev only). In production, point these at an object store / CDN and front the
`/api/*/download` endpoints with signed URLs.

## Migrations

Schema changes are managed by Alembic (`backend/alembic`). Generate a revision
with `python -m alembic revision --autogenerate -m "..."` and apply with
`python -m alembic upgrade head`. Production Docker runs `alembic upgrade head`
before FastAPI starts. The repository must therefore have exactly one migration
head; check with `python -m alembic heads` after adding or rebasing migrations.
When parallel work creates multiple heads, add an explicit merge revision.

`scripts/init_db.py` is a no-Alembic shortcut for disposable development only.
It is not a production migration path.

## Current Extension Points

- Object-storage backend (S3/Azure Blob) for uploads.
- Additional background workers if lifespan scheduler jobs outgrow one process.
- More domain-specific audit coverage on top of the existing activity/audit
  records.
