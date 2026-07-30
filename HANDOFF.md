# Handoff: Routine Checks module — context for a local agent session

Paste this into a fresh Claude Code session in the repo, or save it as
`HANDOFF.md` and tell the agent to read it. Everything below is already
committed and pushed — nothing is in-flight.

---

## Repo & branch

- **Repo:** `sahmadlitpeaks/company-tools`
- **Branch:** `claude/recurring-tasks-management-k9os6n` (branched from `master`)
- **PR:** #6 — <https://github.com/sahmadlitpeaks/company-tools/pull/6> (open, mergeable, green)
- **Commits on the branch** (oldest first):
  - `fd2f3dc` — plan document
  - `0451929` — backend
  - `ea424f4` — frontend + docs
- 25 files changed, +4,844 / −21.

```bash
git fetch origin
git checkout claude/recurring-tasks-management-k9os6n
```

## What the work is

Replaces a paper form (the *Morning IT Checks Report* — ~95 checkpoints across
four buildings, filled in daily by an IT engineer and signed off by the IT
manager) with a scheduled, auditable module: **Routine Checks**.

It is deliberately **not** IT-specific. Team, sections, response types, photo
rules, schedule and routing are all template configuration, so Facilities or any
other department adopts it by authoring a template, not by shipping code.

### The flow

1. An admin authors a **checklist template** (or seeds the starters).
2. The scheduler generates that day's **run** and notifies the assignee.
3. The assignee walks the buildings on a phone, tapping **OK / Issue / N/A**
   per checkpoint, adding notes, readings and photos.
4. Marking **Issue** auto-opens a service-desk ticket carrying the asset.
5. **Submit** is refused while anything is unanswered or a required photo is
   missing.
6. The reviewer **verifies** or **sends it back** — the digital equivalent of
   the form's two signature blocks.
7. A **Compliance** tab reports completion, lateness and repeat-offender
   checkpoints.

## Architecture in one paragraph

A **run is an ordinary `Task`** carrying `template_id` + `run_date` (unique
together), so it reuses tasks' comments, attachments, activity log and
notifications rather than duplicating them. `TaskItem` gained the response
fields (`status`, `note`, `value`, `section`, `photo_required`, `asset_id`,
`ticket_id`, …). Generation is **calendar-driven** (hourly job), not chained off
completion — so a skipped day leaves a visible unsubmitted run instead of
silently ending the series. Runs are hidden from `GET /api/tasks` unless
`include_runs=true`, and refuse mutation through the tasks API.

## Files

**New**
```
backend/app/models/checklist.py              ChecklistTemplate, ChecklistTemplateItem
backend/app/schemas/checklist.py
backend/app/api/checklists.py                two routers: templates + runs
backend/app/services/checklist_runs.py       schedule maths, generation, issue->ticket
backend/app/services/checklist_seed.py       IT / Facilities / Lab starter templates
backend/alembic/versions/a1f7c3d92b64_routine_checks.py
backend/tests/test_routine_checks.py         31 tests
frontend/src/pages/RoutineChecksPage.tsx     runs, run detail, compliance
frontend/src/pages/ChecklistTemplatesPage.tsx  template authoring
docs/RECURRING_CHECKS_PLAN.md                design rationale + §9 "what was built"
```

**Modified**
```
backend/app/models/workplace.py    Task + TaskItem run/response fields
backend/app/api/tasks.py           exclude runs; copy items on recurrence; block run edits
backend/app/api/attachments.py     "task_item" entity; use effective_permissions
backend/app/core/permissions.py    new "routine_checks" module
backend/app/main.py                register both routers
backend/app/services/scheduler.py  hourly generation + late-run alerts
frontend/src/components/Attachments.tsx   accept/capture props for camera
frontend/src/{App,components/Layout,components/CommandPalette,api/types}.tsx
docs/ARCHITECTURE.md, README.md
```

## API surface

```
GET    /api/checklist-templates
POST   /api/checklist-templates                 (manager/admin)
GET    /api/checklist-templates/{id}
PATCH  /api/checklist-templates/{id}            items:[...] replaces the whole list
DELETE /api/checklist-templates/{id}
POST   /api/checklist-templates/samples         seed IT / Facilities / Lab
POST   /api/checklist-templates/{id}/generate   {on: date}  idempotent
POST   /api/checklist-templates/generate-due    run the job now

GET    /api/checklist-runs        ?mine&template_id&status&team&awaiting_verification&from&to
GET    /api/checklist-runs/summary                compliance (manager/admin)
GET    /api/checklist-runs/{id}
PATCH  /api/checklist-runs/items/{item_id}        {status|note|value}
POST   /api/checklist-runs/{id}/claim
POST   /api/checklist-runs/{id}/submit
POST   /api/checklist-runs/{id}/verify            {decision: verify|reject, note}
```

Photos use the existing generic endpoint with `entity_type="task_item"`:
`POST /api/attachments/by/task_item/{item_id}`.

## Design decisions — please don't re-litigate these

- **Routing supports both** a fixed `assignee_id` and an
  `assignee_department_id` rota (unassigned run, visible to the department,
  taken with *Claim*). The paper form showed two different names on one day, so
  both patterns are needed.
- **Template edits don't rewrite live runs.** Replacing a template's items
  affects future runs only; a round in flight keeps what it was generated with.
- **A run needing verification never self-approves.** With no reviewer resolved
  it still parks in `submitted`; any admin can sign it off.
- **`submitted` is a `Task` status**, not a separate state machine.
- **Photo requirement is per checkpoint**, off by default (the IT round sets it
  only on camera sweeps). Enforced server-side at submit.
- **Asset linking is optional.** Checkpoints work without an `asset_id`; linking
  one just enriches the ticket raised from an Issue.

## Two pre-existing bugs fixed along the way

Both in plain-task recurrence, in `backend/app/api/tasks.py`:

1. Checklist items were **not** copied into the next occurrence, so a recurring
   task's subtasks vanished after the first completion.
2. Ticking a subtask left the new `status` column stale.

## State of verification

- **205 backend tests pass** (31 new). `cd backend && pytest -q`
- Migration `a1f7c3d92b64` **applies, downgrades and re-applies** cleanly on
  PostgreSQL 16; no ORM drift on the new tables.
- Frontend typechecks and builds (`npm run build`).
- Driven end-to-end in Chromium: seed templates → generate the 95-item IT round
  → submit refused while unanswered → Issue raises ticket #1001 → complete →
  submit → verify → compliance rollup.

## Running it

```bash
docker compose up --build       # http://localhost:8080 ; migrations run automatically
```

Or split:

```bash
docker compose up -d db
cd backend && python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt && alembic upgrade head && uvicorn app.main:app --reload
cd ../frontend && npm install && npm run dev
```

First login: **admin@agholding.net** / **admin** (forced password change).

**Gotcha:** `BACKEND_CORS_ORIGINS` defaults to `http://localhost:5173`. Opening
the SPA on `127.0.0.1:5173` fails the login preflight with a 400 and no visible
error. Use `localhost` consistently.

Then: Admin → Departments → tick **Routine Checks** for IT/Facilities →
Checklists → *Add starter checklists* → Routine Checks → *Generate due*.

## Open issue right now

The module doesn't appear in the departments dialog on the user's local
machine. It is **not** a database problem — the module list is the hardcoded
`MODULES` list in `backend/app/core/permissions.py`, served by
`GET /api/users/modules`. It means the running backend is old code.

Auth-free probe (`/openapi.json` is nginx-proxied and needs no token — note
`/api/users/modules` requires an **admin** token, so curling it bare returns 401
and proves nothing):

```bash
curl -s http://localhost:8080/openapi.json | grep -c checklist    # >0 = backend current
docker compose exec backend alembic current                       # want a1f7c3d92b64 (head)
```

Most likely causes, in order: not actually on the branch; Docker layer cache
serving the old `COPY . .` (fix with `docker compose build --no-cache backend
frontend`); `git checkout` done in a different clone from `docker compose up`;
stale SPA bundle in the browser.

## Known gaps / good next tasks

1. **Drag-to-reorder in the template editor.** There's a `GripVertical` icon on
   each row that implies dragging and does nothing — either wire it up or
   remove it. Worth doing properly on a 95-item template. *(The PR body claims
   this exists; it doesn't.)*
2. **Client-side image downscaling** before upload — a phone photo is 4–8 MB.
   Do this before wide rollout.
3. **Rota runs notify nobody until claimed** — they appear in the team's list
   but no personal ping goes out. Prefer a fixed assignee until fixed.
4. **Per-tenant timezone.** `due_time` is evaluated against the server clock, so
   the backend must run in the business's timezone.
5. CSV/print export of a single run and of the compliance report.
6. A "rounds awaiting you" card on the My Work home panel.
7. QR labels that jump to a room's section.
