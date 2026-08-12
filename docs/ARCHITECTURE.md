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
