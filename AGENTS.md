# Repository Instructions

This file is the canonical source of repository instructions for Codex,
OpenCode, Claude, Copilot, and other coding agents. Read it before changing
code. `CLAUDE.md` and `.github/copilot-instructions.md` are adapters, not
separate rule sets.

## Start Here

1. Read `README.md` and the relevant file under `docs/`.
2. For frontend work, read `docs/FRONTEND_COMPONENTS.md` and load the tracked
   `company-tools-shadcn` skill from
   `.agents/skills/company-tools-shadcn/SKILL.md`.
3. Inspect the nearest similar implementation before designing a new pattern.
4. Check `git status` and preserve unrelated work. Never revert another
   contributor's changes to make your task easier.
5. Implement the smallest complete change, including tests and documentation.

`HANDOFF.md` and roadmap documents are historical planning context unless a
task explicitly says otherwise. Current code, migrations, tests, this file, and
`docs/ARCHITECTURE.md` take precedence.

## Repository Map

- `frontend/src/App.tsx`: lazy routes and module protection.
- `frontend/src/main.tsx`: global provider order.
- `frontend/src/components/Layout.tsx`: authenticated application shell.
- `frontend/src/components/navigation.ts`: navigation and route labels.
- `frontend/src/components/ui/`: installed shadcn/Base UI primitive source.
- `frontend/src/components/ui.tsx`: temporary compatibility and product-level
  compositions; it is not the primitive directory or a barrel export.
- `frontend/src/api/client.ts`: same-origin cookie-authenticated HTTP client.
- `frontend/src/api/types.ts`: shared API response and payload types.
- `frontend/src/hooks/useApi.ts`: abort-safe GET state through `useFetch`.
- `frontend/src/styles.css`: Tailwind v4 theme and semantic tokens.
- `backend/app/main.py`: FastAPI application, router gates, and lifespan jobs.
- `backend/app/api/`: HTTP route handlers.
- `backend/app/models/`, `schemas/`, `services/`: persistence, contracts, and
  business logic.
- `backend/alembic/versions/`: the only supported production schema history.
- `backend/tests/`: backend behavior and permission tests.
- `frontend/e2e/`: Playwright desktop/mobile and accessibility coverage.

## Architecture Invariants

- The SPA normally authenticates with the HttpOnly `ag_platform_session`
  cookie. It does not store a bearer token in browser storage.
- Browser API calls use same-origin relative paths and
  `credentials: "include"`. In development, Vite proxies API and media paths.
  Do not default the frontend to `http://localhost:8000`; that breaks the cookie
  boundary.
- Many feature routers are gated with module permissions; other sensitive
  routes enforce role or ownership checks inside their handlers. New protected
  UI needs matching navigation, route protection, backend authorization, and
  tests. Never rely on a hidden button as authorization.
- Production schema changes require Alembic. Keep exactly one migration head;
  run `python -m alembic heads` after adding or rebasing migrations. If parallel
  branches create multiple heads, add a merge revision rather than editing
  already-shipped migration ancestry.
- The Docker backend runs `alembic upgrade head` before serving requests. A
  failed migration is a failed deployment, not a recoverable UI empty state.
- Never commit real credentials, local `.env` files, uploads, backups, database
  files, or generated build/test artifacts.

## Frontend Rules

- The UI is React 19, Vite, TypeScript, Tailwind CSS v4, shadcn `base-lyra`,
  Base UI, Lucide, and DM Sans.
- Reuse installed components and project compositions. Read
  `docs/FRONTEND_COMPONENTS.md` for the inventory and examples.
- Import primitives directly from `@/components/ui/<component>`; do not add new
  primitive wrappers to `frontend/src/components/ui.tsx`.
- Use semantic tokens. Do not hardcode ordinary chrome colors. Company branding
  and user-configurable content are the limited exceptions.
- Keep rectangular app surfaces square. Do not add rounded cards, controls,
  dialogs, tables, or badges; avatars, switches, and circular indicators are
  intentional shape exceptions.
- Use shadcn fields, controls, cards, tables, feedback, overlays, and menus. Do
  not introduce native page-level `<select>`, raw styled buttons, custom modal
  overlays, `window.alert`, `window.confirm`, or `window.prompt`.
- Never restore or copy removed legacy classes such as `.card`, `.row`,
  `.spread`, `.badge`, `.btn`, `.btn-primary`, `.btn-danger`, `.field`,
  `.modal`, `.empty`, or `.muted`.
- Forms use `FieldGroup` and `Field`; grouped option sets use `ToggleGroup`;
  selects contain `SelectItem` inside `SelectGroup`; dialogs and sheets always
  have accessible titles.
- Icons inside buttons use `data-icon="inline-start"` or
  `data-icon="inline-end"`; do not apply routine size classes to them.
- Every page must work at desktop and Pixel 5 width. Complex list workflows
  should use a mobile card/list presentation and a desktop table when a table
  would overflow or lose meaning on mobile.
- Add only generated shadcn files that shipped code uses. Preview upstream
  changes and never use the shadcn CLI's `--overwrite` without explicit user
  approval.

## React Quality Gate

Use `.agents/skills/company-tools-react-doctor/SKILL.md` after every substantial
frontend change and before every substantial frontend commit or pull request. This
includes new pages/workflows, broad refactors, routing/provider changes,
component-system changes, dependencies, or changes across several React files.

From `frontend/`, run:

```bash
npm run typecheck
npm run build
npm run doctor
```

Read every React Doctor diagnostic and re-run it after fixes. Do not weaken
`doctor.config.json` merely to improve the score. Run focused Playwright tests
for changed behavior; include both configured desktop and mobile projects for a
new or substantially changed page.

## Backend And Migration Gate

From `backend/`, run:

```bash
python -m alembic heads
python -m pytest
```

There must be one Alembic head. Add focused backend tests for route contracts,
permissions, validation, and data mutations. Use a disposable PostgreSQL
database or Docker stack for migration testing; SQLite cannot verify all
PostgreSQL migrations.

## Definition Of Done

- Behavior is complete across API, permissions, loading/error/empty states, and
  responsive UI where applicable.
- Types and API contracts agree; no frontend-only authorization assumptions.
- Required migrations and focused tests exist.
- Typecheck, build, relevant backend tests, focused E2E, and React Doctor pass or
  documented blockers are reported.
- Documentation reflects any new architectural or reusable component pattern.
- `git diff --check` passes and only intended files are changed.
