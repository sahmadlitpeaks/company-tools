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
| 10 | **Asset Tracker** | Track physical/IT assets (tag, category, location), assign & check-out/check-in to employees, record purchase/warranty info, straight-line depreciation and a maintenance log. |
| 11 | **Routine Checks** | Recurring daily/weekly rounds for IT, Facilities and any other team: the system issues each day's checklist, staff record OK/Issue (with photos where required), issues open service-desk tickets automatically, and a manager verifies and signs off. Compliance reporting shows completion, lateness and repeat-offender checkpoints. |

Digital cards can also be downloaded as a **vCard (.vcf)**, **QR PNG**, **card image (PNG)** or **print-ready PDF**.

**On a phone:** the platform installs as an app. Add it to your home screen and
it runs full-screen, opens with the last data it loaded when the signal drops,
stays signed in, and can send push notifications for approvals, tickets and
overdue checks. Routine checks, expense receipts and ticket photos use the
camera directly, and asset QR labels can be scanned in-app. See
[Mobile app](#mobile-app).

**Multi-brand:** the platform is brand-aware. Define each company brand (AG Holding,
Agiomix, Timepiece, …) in **Admin → Brands** with its logo, colours and contact
details; a brand switcher in the header sets the active brand, which themes email
signatures (and progressively the other modules). Content tables carry a
`brand_id` so items can be scoped and filtered per brand.

## Tech stack

- **Backend:** FastAPI, SQLAlchemy 2 (async), Alembic, PostgreSQL, Authlib (OIDC).
- **Frontend:** React 18 + Vite + TypeScript, Tailwind CSS, MSAL (Azure auth), TanStack Query, React Router.
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

Deploying to a server? Just point a browser at `http://<your-server-ip>:8080`
(or map port 80). Public links (QR codes, short links, card pages) and SSO
redirects **auto-derive from the host you reach the app on**, so no extra config
is needed. To pin a fixed domain or force https behind TLS, set
`PUBLIC_BASE_URL` / `FRONTEND_BASE_URL` (see `.env.example`).

On a fresh database a **default administrator** is created automatically so you
can sign in without Azure:

- **Email:** `admin@agholding.net`
- **Password:** `admin`

You'll be prompted to change this password on first login. Override the seed via
`DEFAULT_ADMIN_EMAIL` / `DEFAULT_ADMIN_PASSWORD` (see `.env.example`). There is no
public sign-up: after the first admin exists, new users are either **added by an
admin** (Employee Directory → *Add user*) or provisioned via **Azure SSO**
(landing as *pending* until an admin approves them).

To customise the port, secrets, Azure SSO or SMTP, copy `.env.example` to `.env`
and edit it before running compose.

## Mobile app

The phone app is the same web app, so there is nothing extra to deploy.

**Install it (no app store needed).** Open the platform in the phone's browser
and choose *Add to Home Screen*. It then runs as a standalone app: full screen,
offline-tolerant, and it stays signed in instead of asking for a password
daily.

**Push notifications** (optional). Create a Firebase project, then set on the
backend:

```bash
PUSH_ENABLED=true
FCM_PROJECT_ID=your-firebase-project
FCM_SERVICE_ACCOUNT_JSON=/path/to/service-account.json   # or the JSON inline
```

Every notification the platform already raises — approvals, tickets, SLA
breaches, late routine checks, leave decisions — is pushed automatically, and
each person's existing muted categories are respected. For web push, also set
`VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_SENDER_ID`,
`VITE_FIREBASE_APP_ID` and `VITE_FIREBASE_VAPID_KEY` at build time; without
them the app simply doesn't offer web push.

**Store builds (iOS / Android).** The same build is wrapped by Capacitor:

```bash
cd frontend
npm run mobile:add        # generate the ios/ and android/ projects (once)
npm run mobile:sync       # build the web app and copy it into them
npm run mobile:ios        # or: npm run mobile:android
```

The native projects are generated rather than checked in — they need Xcode /
Android Studio to build, and the parts that vary per company (Firebase's
`google-services.json`, the APNs capability, signing certificates) come from
your own Apple and Google accounts.

Because one binary has to work against whatever host the platform is deployed
on, the app asks for the **server address** on first launch and remembers it.
Add that origin to `BACKEND_CORS_ORIGINS` — unlike the browser, the app is a
cross-origin client.

For an internal tool, prefer **Apple Business Manager** custom app distribution
and **Google Play** internal/managed distribution over public store listings.

## Azure app registration

1. Entra ID → App registrations → New registration.
2. Redirect URIs (SPA): `http://localhost:5173` and your prod origin.
3. Expose Microsoft Graph delegated `User.Read`, and (for the Directory sync)
   application permission `User.Read.All` with admin consent.
4. Copy **Tenant ID**, **Client ID**, and a **Client secret** into the `.env`
   files (see `.env.example`).

See `docs/ARCHITECTURE.md` for the full module/endpoint breakdown.
