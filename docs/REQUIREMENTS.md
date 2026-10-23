# Requirements workflow

Open **My Work → Requirements** (`/requirements`) to find requests across the
projects you can access. A project's first view is also **Requirements**.
Requirements hold the complete brief. Boards, issues and sprints organize its
implementation; decisions explain supporting choices.

1. Create a requirement in an active project. For a new project request, an
   administrator can choose **New project for this request** inside Requirements
   and continue straight to the brief. Record the original request,
   context, functional and technical requirements, scope, expected outcome,
   acceptance criteria and supporting information. Assign an owner if known.
2. Save incomplete work as **Draft**. **Ready**, **In progress** and **Delivered**
   require the original request, context, functional requirements, scope,
   expected outcome and acceptance criteria. Technical details may be filled
   in as the approach becomes known; they are not an artificial readiness gate.
3. Attach supporting files in the brief. Existing document and meeting URLs
   can be included in supporting information. Project viewers can download;
   members can upload. Uploaders and project admins can remove files.
4. In **Work & decisions**, create as many tasks as needed. Each task is saved
   with its requirement link in the same database transaction. Link existing
   tasks when work already exists. Tasks retain normal assignment, workflow,
   board, sprint and epic behavior.
5. Record a supporting decision from the requirement, or link an existing
   decision. Decisions created here link automatically to the requirement.
   A task also offers **Record decision**, with that task preselected. Existing
   decision submission, revision history and named approval rules still apply.
6. Review task completion and acceptance criteria before marking a requirement
   **Delivered**. Task progress is calculated from current linked issue statuses;
   completion does not automatically certify that the requirement is delivered.
7. Archive obsolete requests instead of deleting the brief. Archived briefs,
   attachments and links are readable. Restore through **Restore / edit** before
   making changes. Archived projects remain read-only.

Task and decision details link back to their requirements. Records can support
multiple requirements in the same project. Links describe current traceability;
changing them does not rewrite an approved decision's submitted snapshot or
revoke its approval. Existing epics and decision records are retained, without
guessing new requirement content from them.

## Persistence and access

`pm_requirements` stores structured content, project sequence number, owner,
status and optimistic version. Keys are `<PROJECT>-REQ-<number>`. Link tables
connect requirements to existing `pm_issues` and `pm_decisions`.
`pm_requirement_events` retains original content, before/after edits, link
events and attachment changes with actor attribution. There are no requirement
or history deletion APIs. Conflict responses preserve unsaved form input.

All routes are behind the **projects** module permission and project membership.
Viewers read; members and project admins write. Platform administrators retain
their existing project access. An unrelated manager has no special access.
Links, owners and automatic creation contexts are checked on the server.
Writes lock the project before the requirement, matching project archive and
membership changes. The migration is `b4f5a6b7c8d9`, after `a3e4f5a6b7c8`.

API: `GET /api/pm/requirements` (project/status/search/pagination),
`POST /api/pm/projects/{id}/requirements`, `GET/PATCH /api/pm/requirements/{id}`,
and `POST/DELETE /api/pm/requirements/{id}/links/{issues|decisions}[/{target}]`.
Issue and decision creation accept an optional `requirement_id`. Reverse links
use `GET /api/pm/{issues|decisions}/{id}/requirements`. Files use the existing
attachment API with entity type `pm_requirement`.

## Verification

- API behavior and access: `backend/tests/test_pm_requirements.py`.
- Migration round trips, numbering, duplicate links and stale writes:
  `backend/tests/test_pm_requirements_postgres.py`, using the disposable local
  `PM_TEST_DATABASE_URL` described in [Project tracker](PROJECT_TRACKER.md).
- Desktop/Pixel 5, accessibility, failure and viewer states:
  `frontend/e2e/requirements.spec.ts`.
- Actual cookie-authenticated API, PostgreSQL, files, multiple tasks, decisions
  and edit history: `frontend/e2e/requirements-live.spec.ts`. Opt in with
  `PM_STACK_E2E=1`, a localhost `PLAYWRIGHT_BASE_URL` and local test account
  `E2E_EMAIL`/`E2E_PASSWORD`; never run this fixture against production.
