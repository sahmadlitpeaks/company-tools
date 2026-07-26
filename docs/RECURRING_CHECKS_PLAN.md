# Recurring Daily Checks — Implementation Plan

> **Status:** phases 1–6 are implemented and shipped as the **Routine Checks**
> module (`routine_checks`). See §9 for exactly what landed, what changed from
> this plan, and what is left. The rest of the document is the original
> analysis, kept because it explains *why* the design looks the way it does.


**Goal:** replace the paper *Morning IT Checks Report* (and the equivalent forms
used by Facilities and other teams) with a scheduled, auditable workflow inside
this platform: the system hands each team their checklist every morning, staff
tick items off (with photos where required), issues become real tickets, and the
manager verifies and reports on it.

---

## 1. What the paper form actually is

The attached scan (`Morning IT Checks Report`, 24/07/2026) is one **daily run**
of a structured checklist. Its anatomy:

| Element on the form | Meaning |
|---|---|
| Date + "Checked By" | One run per day, one performer |
| `HQ BUILDING` / `DNA BUILDING` / `AGIOMIX BUILDING` / `PRECISION WELLNESS` | **Section** (building) |
| `Dr T's Office`, `HQ Meeting Room`, `Genomics Meeting Room`, … | **Sub-section** (room / area) |
| `TV`, `Yealink WPP30 Pod`, `Windows + K`, `WiFi Connection TV`, `Desk Phone`, `Printer`, `iOS Shared` | **Checkpoints**, each answered `OK` / `Issue` |
| `Check All Printers` / `Access Points` / `Cameras` + Notes | Building-level checkpoints with a free-text note |
| Page 5 `PRINTER CHECK — ALL LOCATIONS` table | A checkpoint **per physical asset** (Department, Printer Name, Location, OK/Issue) |
| `General Notes / Follow-up` | Run-level note |
| `Checked By (IT Engineer)` + `Verified By (IT Manager)` signatures | **Two-stage sign-off** |
| Handwritten `in → 3:05 PM / out → 3:26 PM` | Time spent on the round |

Roughly **100 checkpoints per run**, three levels deep, with per-item notes and a
manager verification step. Real issues captured that day — *"Dr T printer needs
black ink"*, *"CS & engineering room printers need supplies"*, *"Geno server
fault on drive 2 in disc drive bay 1"* — currently live only on that sheet of
paper.

---

## 2. What the existing system already gives us

This is the important part: **most of the machinery exists.** Nothing here needs
a new product — it needs one new layer stitching existing modules together.

| Need | Already in the codebase |
|---|---|
| Tasks with assignee, due date, status, priority | `Task` — `backend/app/models/workplace.py:18` |
| Checklist items inside a task | `TaskItem` (`title`, `done`, `sort`) — `workplace.py:58` |
| Comments / discussion on a task | `TaskComment` — `workplace.py:73` |
| **Photo upload against a task** | `Attachment` (`entity_type="task"`) — `workplace.py:238`, API `api/attachments.py`, UI `components/Attachments.tsx` |
| Daily/weekly/monthly recurrence flag | `Task.recurrence` + `_advance()` — `api/tasks.py:36` |
| Reusable "template → instantiate a checklist" pattern | `OnboardingTemplate` / `OnboardingTemplateItem` — `models/people.py:114` |
| Background scheduled jobs | `services/scheduler.py` + admin UI at `/hr/automations` |
| Notifications (in-app + email/Slack/Teams, with dedup) | `services/notify.py`, `services/dispatch.py` |
| Tickets with SLA, category (`it`/`facilities`/…) **and an `asset_id` FK** | `Ticket` — `workplace.py:128`, `services/sla.py` |
| Physical inventory: printers, TVs, pods, locations | `TrackedAsset`, `AssetLocation`, `AssetEvent` — `models/tracked_asset.py` |
| Per-module RBAC + departments as access groups | `core/permissions.py`, `models/department.py` |
| Manager relationship for rollups / sign-off routing | `User.manager_id` — `models/user.py:50` |
| Audit trail | `services/activity.py`, `models/field_audit.py` |
| Saved filters, CSV/report export | `components/SavedViews.tsx`, `api/reports.py` |

### What you could do on Monday with **zero code**

Create a Task titled "Morning IT Checks", set `recurrence = daily`, assign it to
the on-duty engineer, add the checkpoints as checklist items, and let staff
attach photos via the existing Attachments panel. That works today.

### Why that isn't good enough — four verified gaps

1. **Checklist items are not carried into the next occurrence.** The recurrence
   spawn at `api/tasks.py:242-260` copies title, description, priority,
   assignee and due date — but **not** `TaskItem` rows. Day 2's task is empty.
   This alone makes the no-code route unusable for a 100-item form.
2. **Recurrence only fires on completion.** The next occurrence is created when
   someone marks the current one `done`. Skip a day and the chain stops dead —
   the exact failure the paper process has, reproduced in software. There is
   also no record that a day was *missed*.
3. **`TaskItem` has no OK/Issue, no note, no photo, no asset link.** It is a
   `done` boolean (`workplace.py:58-70`). The form's core semantic —
   *"checked, and it's broken"* — cannot be expressed. Attachments hang off the
   whole task, so a photo can't be tied to the checkpoint it evidences.
4. **No verification stage.** `Task.status` is `todo|in_progress|blocked|done`
   with no reviewer, no `verified_at`, no send-back. The "Verified By (IT
   Manager)" signature block has no counterpart.

Everything below closes those four gaps and nothing more.

---

## 3. Recommended approach

**Extend the Tasks module with a "Routine Checks" layer.** Do not build a
separate silo.

Rationale:

- One run = one `Task`. It inherits assignment, due dates, comments,
  attachments, activity logging, saved views and the notification fan-out for
  free.
- The template → instantiate pattern is already proven in this codebase by
  `OnboardingTemplate`; we mirror it rather than inventing a shape.
- Issues route into the **existing** service desk with its SLA clock and
  `Ticket.asset_id` link, so a broken printer is tracked the same way as any
  other IT ticket.
- Managers get one row per team per day instead of 100 rows — the paper form's
  granularity, preserved.

**The one structural change:** the form is three levels deep
(Building → Room → Checkpoint) while `TaskItem` is flat. Add a `section` string
to `TaskItem` (e.g. `"HQ Building / Dr T's Office"`) and group by it in the UI.
That keeps one run = one task without a third table.

---

## 4. Phased plan

Phases 1–4 are the minimum viable replacement for the paper form. 5–7 are the
payoff.

### Phase 0 — Model the buildings and equipment (configuration, no code)

Populate **Asset Tracker** with the real world: `AssetLocation` rows for each
building and room; `TrackedAsset` rows for the printers on page 5
(`HP-DXB-AGMX-RL`, `HQ-RICOH-CS Printer`, …), the meeting-room TVs and the
Yealink pods, each with its location and asset tag.

This is what turns *"Issue"* into something actionable: the checkpoint points at
an asset, the ticket inherits `asset_id`, and you can finally ask "how often does
the Agiomix corridor printer fail?"

*Owner: IT. Effort: ~half a day of data entry. No dependency on the code below.*

### Phase 1 — Checklist templates

New tables, mirroring `OnboardingTemplate` / `OnboardingTemplateItem`:

`checklist_templates`
- `name`, `description`, `company_id`, `active`
- `team` — `it | facilities | hr | ops | other` (drives ticket category)
- `schedule` — `daily | weekdays | weekly | monthly`, plus `days_of_week` / `day_of_month`
- `time_of_day`, `timezone`, `grace_minutes` (after which a run is "late")
- `assignee_id` (fixed) **or** `assignee_department_id` (rota / whoever is on duty)
- `reviewer_id` — the manager who verifies (defaults to the assignee's `User.manager_id`)

`checklist_template_items`
- `section` (`"HQ Building / Dr T's Office"`), `title`, `sort`
- `response_type` — `ok_issue | done | text | number`
- `photo_required` (bool), `photo_min` (int)
- `asset_id` → `tracked_assets` (nullable)
- `auto_ticket_on_issue` (bool), `ticket_category`, `ticket_priority`

Admin UI: template list + item editor, modelled on the existing onboarding
templates screen. Seed the *Morning IT Checks* template from the attached PDF
verbatim so IT can validate it against paper on day one.

*Backend ~2 d · Frontend ~2 d · Alembic revision*

### Phase 2 — Scheduled generation of runs

New `services/checklist_runs.py`, registered in `services/scheduler.py` beside
the existing asset/SLA/HR jobs, using the same `_periodic` helper.

Each tick materialises the due runs: create a `Task` from the template, copy
every template item into a `TaskItem`, set `due_date` and assignee, notify the
assignee via `notify_user`.

- Add `template_id` and `run_date` to `tasks`, with a **unique constraint on
  `(template_id, run_date)`** — the job becomes idempotent and safe to re-run
  or trigger manually.
- A run not submitted by `due + grace` is flagged `missed` and the reviewer is
  notified. *Missed days become visible instead of invisible.*
- Expose a manual "generate now" endpoint for admins, matching the existing
  automations page pattern.

This also fixes gaps #1 and #2 for the whole Tasks module, not just checklists.

*Backend ~2 d · Alembic revision*

### Phase 3 — Item-level responses and photos

Extend `TaskItem`:
- `section` (String) — grouping
- `status` — `pending | ok | issue | na`
- `note` (Text)
- `photo_required` (bool), `asset_id` (FK)
- `responded_by_id`, `responded_at`

Extend the generic attachment map in `api/attachments.py:24` with
`"task_item": (TaskItem, "tasks")` so a photo attaches to **the checkpoint**,
not the whole run. `components/Attachments.tsx` already handles the rest — its
`entityType` prop just gains a value.

Server-side submit guard: a run cannot be submitted while any item is still
`pending`, or while any `photo_required` item has zero attachments. This is what
makes "they take pictures and mark it done" enforceable rather than optional.

*Backend ~2 d · Frontend ~1 d · Alembic revision*

### Phase 4 — Manager verification

Extend `Task`: `reviewer_id`, `submitted_at`, `verified_at`, `verified_by_id`,
`review_note`; add `submitted` to the status set.

Flow: engineer completes → **Submit** → reviewer notified → manager reviews the
run (all items, notes and photos on one screen) → **Verify** or **Send back**
with a note. Verification is written to the activity log — the digital
equivalent of the two signature blocks, with a timestamp and no ambiguity about
who signed.

Manager queue: `/tasks?awaiting_verification=1`, plus a card in `MyWork.tsx`.

*Backend ~1.5 d · Frontend ~2 d · Alembic revision*

### Phase 5 — Issues become tickets

Marking an item `issue` creates a `Ticket` (when the template says so):
- `category` from the template's team, `priority` from the item
- `asset_id` from the checkpoint → the printer's own history
- `subject` = checkpoint title, `description` = note + link back to the run
- Item photos copied across as ticket attachments

The existing SLA engine (`services/sla.py`, `sla_alerts.py`) then owns it.
*"Dr T printer needs black ink"* stops being a note on a page and starts being a
ticket with a due time. The run detail shows a live ticket status per issue, so
tomorrow's checker knows what's already in hand.

*Backend ~1.5 d · Frontend ~1 d*

### Phase 6 — Compliance reporting for managers

A **Routine Checks** dashboard:
- Completion rate per template / team / person / date range
- On-time vs late vs missed runs
- Open issues grouped by asset, location and building
- **Repeat offenders** — checkpoints failing N days running (the signal paper
  can never give you: three separate days of "needs black ink" is a supply
  problem, not three printer problems)
- Average round duration (from `submitted_at − started_at`, replacing the
  handwritten in/out times)
- CSV export + a printable PDF run report, reusing `api/reports.py` and the
  existing PDF helpers (`services/payslip_pdf.py`, `onboarding_pdf.py`)

*Backend ~2 d · Frontend ~2 d*

### Phase 7 — Mobile run view

The person doing this is walking between four buildings with a phone.

- Mobile-first run screen: collapsible sections, large OK/Issue toggles, one tap
  per checkpoint
- Native camera capture — `<input type="file" accept="image/*" capture="environment">`
- Client-side image downscaling before upload (a phone photo is 4–8 MB; target
  ~300 KB)
- Sticky progress bar, autosave per item, resumable
- Optional: print QR labels for each room/printer (the `qrcodes` module and
  `services/asset_label.py` already do this) so scanning a printer jumps
  straight to its checkpoint

*Frontend ~3 d*

---

## 5. Access control

Add a `routine_checks` module key to `core/permissions.py:MODULES` and gate the
router with `require_module`, matching every other module.

- **Member** (IT engineer, facilities staff): see and complete runs assigned to
  them or their department
- **Manager**: everything above, plus the verification queue and reporting for
  their teams
- **Admin**: template authoring and schedules

Grant it to the IT and Facilities departments via the existing Departments
screen. Note that `routine_checks` should **not** be in `MEMBER_DEFAULTS` — only
teams that actually run rounds need it.

---

## 6. Rollout

| Step | Detail |
|---|---|
| 1 | Phase 0 data entry (buildings, rooms, printers, TVs, pods) |
| 2 | Ship phases 1–4 behind the new module key, granted to IT only |
| 3 | Seed the *Morning IT Checks* template from the PDF, verbatim |
| 4 | **Two-week parallel run** — paper *and* app, daily. Compare; fix the template where the form and reality disagree |
| 5 | Drop the paper for IT. Ship phases 5–7 |
| 6 | Onboard Facilities with their own template; then other teams |

Each phase is independently shippable and useful on its own.

**Rough total: 4–5 weeks of one full-stack developer** for all seven phases;
**~2 weeks** to reach the point where paper can be retired (phases 1–4).

---

## 7. Decisions needed before phase 1

1. **Rota or fixed assignee?** The scan shows two different names (Ahmed
   Shabana, Christakis Vlahakis) on the same day's pages — so the round is
   either split between people or handed over mid-way. If runs are shared, we
   need either multiple assignees per run or one run split by section. This
   changes the phase 1 schema, so it's worth settling early.
2. **One template or several?** The current form is one ~100-item sheet covering
   four buildings. Splitting it per building would give shorter, parallel runs
   and cleaner per-building reporting. Recommendation: split.
3. **Which other teams, and what do their forms look like?** Facilities is
   named; the template model above should cover them without change, but their
   actual forms are worth checking against it before we lock the schema.
4. **Are photos required per checkpoint, or only when raising an issue?**
   Requiring a photo on all ~100 checkpoints would make the round significantly
   slower. Recommendation: photo required on `issue` only, plus a handful of
   specific checkpoints (e.g. server room, cameras).
5. **Should a missed run auto-escalate** to the manager's manager after N days?

---

## 8. Summary of code touch points

| Area | Change |
|---|---|
| `backend/app/models/workplace.py` | `Task`: `template_id`, `run_date`, `reviewer_id`, `submitted_at`, `verified_at`, `verified_by_id`, `review_note`. `TaskItem`: `section`, `status`, `note`, `photo_required`, `asset_id`, `responded_by_id`, `responded_at` |
| `backend/app/models/checklist.py` *(new)* | `ChecklistTemplate`, `ChecklistTemplateItem` |
| `backend/app/api/checklists.py` *(new)* | Template CRUD, run generation, submit/verify, item responses |
| `backend/app/api/tasks.py` | Copy items on recurrence; submit/verify transitions; `awaiting_verification` filter |
| `backend/app/api/attachments.py` | Add `task_item` to the `ENTITY` map |
| `backend/app/services/checklist_runs.py` *(new)* | Scheduled generation, missed-run detection, issue → ticket |
| `backend/app/services/scheduler.py` | Register the new periodic job |
| `backend/app/core/permissions.py` | Add the `routine_checks` module |
| `backend/alembic/versions/` | 4 revisions (one per phase 1–4) |
| `frontend/src/pages/RoutineChecksPage.tsx` *(new)* | Run list, mobile run view, verification queue |
| `frontend/src/pages/ChecklistTemplatesPage.tsx` *(new)* | Template authoring |
| `frontend/src/components/Attachments.tsx` | Accept `task_item` as an entity type |
| `frontend/src/components/{Layout,MyWork,CommandPalette}.tsx` | Nav entry, "runs awaiting you" card, palette actions |
| `backend/tests/test_routine_checks.py` *(new)* | Generation idempotency, submit guards, verification, issue → ticket |

---

## 9. What was built

Phases 1–6 are implemented. The feature ships as the **Routine Checks** module
(permission key `routine_checks`), with two screens: *Routine Checks* (the
rounds themselves) and *Checklists* (template authoring).

### Delivered

| Phase | Status | Notes |
|---|---|---|
| 1 — Checklist templates | ✅ | `checklist_templates` + `checklist_template_items`, admin UI at `/checklists` |
| 2 — Scheduled generation | ✅ | Hourly job in `services/scheduler.py`; idempotent on `(template_id, run_date)`; late-run alerts to the reviewer |
| 3 — Item responses + photos | ✅ | OK / Issue / N/A / readings, notes, `entity_type="task_item"` attachments, submit guards |
| 4 — Manager verification | ✅ | `submitted` → verify / send back, with the decision written to the activity log |
| 5 — Issues → tickets | ✅ | Ticket inherits the team's category, the checkpoint's asset and the checker's note; SLA engine unchanged |
| 6 — Compliance reporting | ✅ | `GET /api/checklist-runs/summary` + a Compliance tab: completion, lateness, repeat-offender checkpoints |
| 7 — Mobile run view | ◐ | The run screen is mobile-shaped (collapsible sections, big OK/Issue targets, `capture="environment"` camera input). Client-side image downscaling and QR-jump-to-section are **not** done. |

### Decisions taken (the §7 questions, resolved)

The five open questions were answered in the design rather than blocking on
them, in a way that leaves each reversible by configuration:

1. **Rota or fixed assignee — both.** A template routes to a fixed
   `assignee_id` *or* an `assignee_department_id`. Department runs start
   unclaimed, are visible to the whole department, and are taken with
   **Claim**. That covers the two different names appearing on one day's paper
   form without forcing a choice now.
2. **One template or several — several supported, one seeded.** The starter IT
   round is the full 95-item form so it can be validated against paper
   verbatim. Splitting it per building is now an editing exercise, not a
   migration.
3. **Other teams — no code needed.** Team, sections, response types, photo
   rules and schedule are all template configuration. Facilities and Lab
   starter templates ship as proof.
4. **Photos — per checkpoint, off by default.** `photo_required` is a per-item
   flag; the IT round sets it only on the camera sweeps. Submission is blocked
   when a required photo is missing, so it is a real control rather than a
   convention.
5. **Missed-run escalation — notify, don't escalate.** A run past
   `due_time + grace_minutes` is flagged late, counted in compliance, and the
   reviewer is notified once (deduped). Escalation to the manager's manager was
   left out deliberately — worth adding once there is a month of real data.

### Deviations from the plan above

- **`submitted` is a `Task` status**, not a separate state machine. Runs are
  filtered out of `GET /api/tasks` by default (`include_runs=true` to include
  them) and refuse mutation through the tasks API, so the Kanban board is
  unaffected by a 95-item daily round.
- **Template edits don't rewrite live runs.** Replacing a template's items
  affects future runs only; a round already in flight keeps what it was
  generated with, so the day's evidence stays coherent.
- **A run with verification required never self-approves.** If no reviewer
  resolves, it still parks in `submitted` and any admin can sign it off.
- **Phase 0 (asset inventory) is optional, not a prerequisite.** Checkpoints
  work without an `asset_id`; linking one just enriches the ticket. The printer
  table from page 5 is seeded as plain checkpoints, ready to be linked once the
  printers exist in Asset Tracker.

### Not done

- Client-side image downscaling before upload (a phone photo is 4–8 MB).
- QR labels that jump to a room's section.
- Printable/CSV export of a single run and of the compliance report.
- A "rounds awaiting you" card on the My Work home panel.
- Per-tenant timezone: `due_time` is evaluated against the server clock, so the
  backend should run in the business's timezone.

### Rollout from here

1. Grant `routine_checks` to the IT and Facilities departments
   (Admin → Departments).
2. **Checklists → Add starter checklists**, then edit the IT round to match
   reality and set its assignee/rota and reviewer.
3. Optionally add the printers and meeting-room AV to Asset Tracker and link
   them to their checkpoints.
4. Run two weeks in parallel with paper, then drop the paper.
