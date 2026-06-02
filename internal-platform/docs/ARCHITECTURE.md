# Architecture

## Overview

```
┌────────────┐     OIDC (auth code)      ┌──────────────────┐
│  Azure     │◀──────────────────────────│  FastAPI backend │
│  Entra ID  │──────────────────────────▶│  (this app)      │
└────────────┘   id_token + Graph token  └──────────────────┘
                                              │  ▲
                       app JWT (8h)           │  │ SQLAlchemy (async)
                                              ▼  │
┌────────────┐   Bearer app JWT          ┌──────────────────┐
│  React SPA │◀─────────────────────────▶│   PostgreSQL     │
│  (Vite)    │      /api/*               └──────────────────┘
└────────────┘
```

## Authentication flow

1. SPA sends the user to `GET /api/auth/login`.
2. Backend redirects to Azure Entra ID (Authlib OIDC).
3. Azure redirects back to `GET /api/auth/callback` with an auth code.
4. Backend exchanges the code, calls Microsoft Graph `/me`, **upserts** the
   user into PostgreSQL, and mints a short-lived app JWT (`HS256`).
5. Backend redirects to `FRONTEND_BASE_URL/auth/callback#token=...`.
6. SPA stores the token and sends it as `Authorization: Bearer` on every
   `/api/*` call. `get_current_user` validates it and loads the `User` row.

`POST /api/auth/dev-login?email=...` is a development-only shortcut that
bypasses Azure (returns 404 when `ENVIRONMENT != development`).

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
with `alembic revision --autogenerate -m "..."` and apply with
`alembic upgrade head`. `scripts/init_db.py` is a no-Alembic shortcut for quick
local spin-ups and seeds the default signature template.

## Roadmap / nice-to-haves

- Role-based access beyond the `is_admin` flag (per-module permissions).
- Background directory sync (Celery/APScheduler) instead of on-demand.
- Object-storage backend (S3/Azure Blob) for uploads.
- Audit log for admin actions.
