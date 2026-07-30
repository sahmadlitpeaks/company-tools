# AG Holding Internal Company Platform

A local-first internal operations platform for AG Holding employees. It combines
people operations, daily work, company services, documents, approvals, and
administration in one permission-aware application.

## What is included

The platform retains its original tools—employee directory, digital cards,
marketing assets, brand center, brochures, landing pages, email signatures,
short links, secure transfers, CRM, service desk, asset tracking, HR, payroll,
training, recruiting, documents, notifications, audit history, and reporting—
and now also includes:

- Simple time tracking with two primary actions (clock and break), a live
  `HH:MM:SS` timer that retains exact seconds after clock-out, a daily
  work/break timeline, weekly timesheets, corrections,
  schedules, approvals, reminders, and audit history. Employees can clear
  today's entries and breaks themselves; doing so safely reopens a submitted
  current week without changing earlier days.
- QR-based TOTP setup in the existing account security settings.
- Role-aware, reorderable dashboard widgets with hide, restore, and reset
  controls.
- Permission-aware global search across people, work, files, tickets, knowledge,
  feedback, products, and lost-and-found reports.
- Lightweight projects linked to the existing task, assignment, recurrence,
  comment, and subtask workflows.
- Internal café ordering, meeting-room and desk booking, visitor invitations,
  purchase requests, and the aggregated company calendar.
- Admin backup creation, daily scheduling, archive import, authenticated
  download, checksums, and retention history.
- Employee ideas/issues with comments, votes, attachments, a displayed username,
  and an anonymous-submission option.
- A published-Knowledge-Base-only AI assistant with citations and a disabled
  state when no provider is configured.
- Lost-and-found reporting, claiming, notification, attachment, and resolution
  workflows.
- Recurring daily and weekly routine checks for IT, Facilities, and other teams.
  The system issues each checklist, supports OK/Issue results and required photos,
  opens service-desk tickets for issues, provides manager verification and sign-off,
  and reports completion, lateness, and repeat-offender checkpoints.

The excluded “Last things” section from the feature brief is not implemented.

## Design system

The React UI uses the shadcn `base-lyra` design system, backed by Base UI,
Tailwind CSS v4, Lucide icons, and DM Sans.
Buttons, inputs, textareas, selects, checkboxes, labels, forms, cards, badges,
tables, dialogs, alerts, loading/empty states, notifications, the application
sidebar, and account menus render through shadcn primitives. A compatibility
adapter preserves the existing event handlers and payloads on older screens;
new screens should import components directly from `frontend/src/components/ui`.

The default primary is yellow (`#FACC15`) with zinc foreground (`#18181B`), and
the active company may supply its own accent. The shell uses semantic tokens in
`frontend/src/styles.css`, supports light and neutral dark modes, and keeps
normal rectangular surfaces square. Do not reapply an old preset: the installed
component source contains project-specific accessibility and layout changes.

Only add generated shadcn components that are used by the application; unused
generated files are intentionally omitted. Read
[`docs/FRONTEND_COMPONENTS.md`](docs/FRONTEND_COMPONENTS.md) before frontend
work. Coding agents must also follow [`AGENTS.md`](AGENTS.md) and the tracked
`company-tools-shadcn` and `company-tools-react-doctor` skills under
`.agents/skills/`.

## Tech stack

- Backend: FastAPI, SQLAlchemy 2 async, Alembic, PostgreSQL 16, Pydantic.
- Frontend: React 19, TypeScript 7, Vite 8, Tailwind CSS 4, shadcn/Base UI.
- Authentication: local password or Azure Entra ID OIDC, with an HttpOnly
  application session and optional TOTP MFA.
- Storage: PostgreSQL plus persistent media and backup Docker volumes.
- Testing: Pytest, Playwright, axe-core, React Doctor, TypeScript, and Vite.

## Run locally

### Day-to-day development (recommended — Vite HMR)

The production Docker frontend is a **static nginx build**. Editing `frontend/src`
does **not** hot-reload there; you must rebuild the image. For normal UI work,
run Vite on the host instead:

```bash
# API + database (rebuild only when backend deps/Dockerfile change)
docker compose up -d db backend

# Frontend with instant HMR
cd frontend
npm ci
npm run dev
```

Open **[http://localhost:5173](http://localhost:5173)**. Vite proxies `/api`,
`/media`, `/s`, and related paths to the backend on port `8000`. Save a file →
the browser updates automatically. No frontend Docker rebuild.

Optional full-stack dev compose (Vite + uvicorn `--reload` in containers):

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up
```

Then open [http://localhost:5173](http://localhost:5173).

### Production-style Docker (static SPA)

```bash
docker compose up -d --build
```

Open [http://localhost:8080](http://localhost:8080). The frontend nginx service
serves a **built** SPA and reverse-proxies the API on the same origin. Alembic
migrations run automatically when the backend starts. Use this for a release-like
smoke test; use Vite for iterative UI work.

On a fresh database, bootstrap credentials come from
`DEFAULT_ADMIN_EMAIL` and `DEFAULT_ADMIN_PASSWORD`. Defaults are documented in
`backend/.env.example`; override them in a local `.env` and do not commit real
credentials.

Useful local checks:

```bash
cd frontend
npm ci
npm run typecheck
npm run build
npm run doctor
npm audit
npm outdated

cd ../
docker compose run --rm -T backend sh -c \
  "pip install -q -r requirements-dev.txt && python -m pytest -q"

cd frontend
E2E_EMAIL=your-admin-email \
E2E_PASSWORD=your-local-password \
npm run test:e2e
```

Playwright credentials are read from environment variables; passwords are not
hardcoded in the test suite.

## Backup behavior

Admins can create, import, list, and download backups from Settings. Created
archives combine `database.dump` and `media.tar.gz` in a ZIP, store a SHA-256
checksum, run daily at 02:00 Asia/Dubai by default, and retain 30 days. The
schedule, retention, and maximum import size can be overridden with:

- `BACKUP_HOUR_DUBAI`
- `BACKUP_RETENTION_DAYS`
- `BACKUP_IMPORT_MAX_BYTES`
- `BACKUP_ROOT`

Import validates and registers a previously downloaded platform ZIP in the
protected backup list. It deliberately does **not** overwrite or restore the
running database. Follow [docs/backup-recovery.md](docs/backup-recovery.md) for
the CLI recovery procedure.

## AI help configuration

AI Help is disabled until these server-only variables are present:

- `AI_BASE_URL`
- `AI_API_KEY`
- `AI_MODEL`

The key is never sent to the browser. Retrieval is limited to published
Knowledge Base articles; chats remain ephemeral and unsupported answers are
refused.

## Additional documentation

- [Coding-agent instructions](AGENTS.md)
- [Architecture and API map](docs/ARCHITECTURE.md)
- [Frontend components and AI usage](docs/FRONTEND_COMPONENTS.md)
- [Backup recovery](docs/backup-recovery.md)
- [HR roadmap](docs/HR_ROADMAP.md)
