# AG Holding — Internal Company Platform

An internal, SSO-protected platform for AG Holding employees. Authentication is
handled by **Azure Entra ID (Azure AD)**; user profiles are synced into the
platform's own PostgreSQL database on first login.

## Features

| # | Module | Description |
|---|--------|-------------|
| 1 | **Directory** | Pull every user's profile from Entra ID and store it locally (`/api/users`). |
| 2 | **Digital Cards** | Per-employee digital business cards with a public share page + QR. Scans are tracked and visitors can optionally submit a **lead**. |
| 3 | **Marketing Assets** | Folder tree + file uploads to organise all marketing material. |
| 4 | **Brand Center** | Central store for brand guidelines, logos, fonts, colours and downloadable assets. |
| 5 | **QR & Brochures** | Generate QR codes for products/links and host downloadable brochures. |
| 6 | **Landing Pages** | Lightweight builder for marketing landing pages with a public URL. |
| 7 | **Email Signatures** | Generate branded HTML email signatures from a template + user data. |
| 8 | **URL Shortener** | Branded short links with click analytics for campaigns. |
| 9 | **Secure Transfers** | Send a file via an encrypted, single-use link that self-destructs after download (optional password + expiry). |

## Tech stack

- **Backend:** FastAPI, SQLAlchemy 2 (async), Alembic, PostgreSQL, Authlib (OIDC).
- **Frontend:** React 18 + Vite + TypeScript, MSAL (Azure auth), TanStack Query, React Router.
- **Auth:** Azure Entra ID OIDC → backend issues a short-lived app JWT session.

## Quick start (local dev)

```bash
# 1. Start Postgres
docker compose up -d db

# 2. Backend
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env        # fill in Azure + DB values
alembic upgrade head
uvicorn app.main:app --reload

# 3. Frontend
cd ../frontend
cp .env.example .env        # fill in VITE_AZURE_* values
npm install
npm run dev
```

Backend runs on http://localhost:8000 (docs at `/docs`), frontend on
http://localhost:5173.

## Or run everything with Docker (one command, one URL)

```bash
docker compose up --build
```

Then open **http://localhost:8080** — that's it. nginx serves the built SPA and
reverse-proxies the API, so the whole app lives on a single origin (no CORS, no
`.env` editing). Data persists in the `pgdata` and `media` volumes.

In `development` (the default) a local **dev-login** is available without Azure.
To customise the port, secrets, Azure SSO or SMTP, copy `.env.example` to `.env`
and edit it before running compose.

## Azure app registration

1. Entra ID → App registrations → New registration.
2. Redirect URIs (SPA): `http://localhost:5173` and your prod origin.
3. Expose Microsoft Graph delegated `User.Read`, and (for the Directory sync)
   application permission `User.Read.All` with admin consent.
4. Copy **Tenant ID**, **Client ID**, and a **Client secret** into the `.env`
   files (see `.env.example`).

See `docs/ARCHITECTURE.md` for the full module/endpoint breakdown.
