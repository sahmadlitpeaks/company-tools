# HR Platform Roadmap — BambooHR Parity

Status: **planning** (no code yet). Build order reflects agreed priority.
Each wave ships as its own increment(s): models + migration + gated API +
tests + frontend, suite green, committed and pushed — same rhythm as the
existing HR module (records, documents, leave, compensation, performance,
HR dashboard).

Conventions reused across every wave:
- **Storage**: `app/services/storage.py` (resumes, signed PDFs, offer letters).
- **PDF**: existing report renderer for signed docs / report exports.
- **Notifications**: `notify_user` (+ dedup) for invites, approvals, reminders.
- **Activity log**: `record(...)` on every mutation.
- **Approvals pattern**: reuse for timesheet + offer sign-off where natural.
- **People journeys**: onboarding conversion + packets hook in here.
- **Permissions**: new module keys gate routers; sensitive data uses the
  `is_hr()` helper + reporting-line manager checks (as today).

---

## Wave 1 — Time tracking / attendance  (priority 1, ~5–7d)

**Goal.** Daily hours / clock in–out, weekly timesheets with submit→approve,
overtime vs. expected hours, holiday- and leave-aware.

**Permission:** new module `attendance`.

**Data model** (`app/models/timekeeping.py`)
- `WorkSchedule` — `user_id?` (null = company default), `hours_per_week`,
  `days` (json: which weekdays), `daily_hours`. One default seeded.
- `Timesheet` — `user_id`, `period_start`, `period_end` (weekly),
  `status` (open|submitted|approved|rejected), `submitted_at`,
  `decided_by_id`, `decided_at`, `note`.
- `TimeEntry` — `user_id`, `timesheet_id?`, `work_date`, `clock_in`,
  `clock_out`, `break_minutes`, `hours` (stored), `kind` (work|overtime|
  remote), `note`, `source` (clock|manual).

**API** (`/time`)
- `POST /time/clock-in`, `POST /time/clock-out` (toggle open entry for today).
- `GET /time/entries?from&to&user_id`, `POST/PATCH/DELETE /time/entries`.
- `GET /time/timesheets?user_id&status`, `POST /time/timesheets/submit`
  (current week), `POST /time/timesheets/{id}/decision` (approve|reject).
- `GET /time/summary` — hours this week, overtime, missing days, and (for
  managers) timesheets awaiting approval.

**Visibility.** Self manages own entries; reporting-line manager approves
reports' timesheets; `is_hr()` sees all. Leave days + company holidays are
excluded from "expected hours" so they don't read as missing.

**Integrations.** HR dashboard tiles (avg hours, unsubmitted timesheets);
feeds Wave 4 reporting; notifications on submit/decision.

**Frontend.** "Time" page under People: weekly grid + clock widget + submit;
manager "to approve" queue. Profile shows a small hours summary.

**Tests.** clock toggle, weekly totals, holiday/leave exclusion, submit→approve
flow, manager-only approval, self vs other visibility.

**Open questions.** (a) Clock in/out *and* manual entry, or manual only?
(b) Weekly or bi-weekly/monthly periods? (c) Track against projects/tasks
(link to existing worklog) or plain hours?

---

## Wave 2 — Recruiting / ATS  (priority 2, ~2–3wk — split in two)

**Goal.** Job openings → candidate pipeline → interviews & feedback → offer →
convert to employee (+ onboarding).

**Permission:** new module `recruiting`. Candidate PII treated as sensitive.

### 2a. Jobs, candidates, pipeline (~1–1.5wk)
**Data model** (`app/models/recruiting.py`)
- `JobOpening` — title, `department_id`, location, `employment_type`,
  description, `status` (draft|open|on_hold|closed|filled), `openings`,
  `hiring_manager_id`, `created_by_id`, `posted_at`.
- `Candidate` — `job_id`, name, email, phone, `resume_path`, source,
  `stage` (applied|screen|interview|offer|hired|rejected), `status`
  (active|hired|rejected|withdrawn), `rating`, `created_at`.
- `CandidateActivity` — `candidate_id`, type (note|stage_change), body,
  `author_id`, `created_at`.

**API** (`/recruiting`): jobs CRUD; candidates CRUD + résumé upload; move
stage; activity notes. `GET /recruiting/jobs/{id}/pipeline` returns
candidates grouped by stage (kanban).

**Frontend.** Recruiting section: jobs list, job detail with **kanban**
pipeline (drag across stages), candidate drawer (résumé, activity, rating).

### 2b. Interviews, offers, conversion, public board (~1–1.5wk)
**Data model**
- `Interview` — `candidate_id`, `scheduled_at`, duration, mode, location/link.
- `InterviewFeedback` — `interview_id`, `reviewer_id`, rating,
  recommendation (yes|no|maybe), notes.
- `Offer` — `candidate_id`, amount, currency, `start_date`,
  `status` (draft|sent|accepted|declined), `letter_path`.

**API.** interviews CRUD + feedback; offers CRUD; **`POST /recruiting/candidates/{id}/convert`** → creates a `User` (status invited, dept/title carried over), links `candidate.user_id`, optionally starts an onboarding journey (Wave links to people module + packets from Wave 3).

**Public (optional sub-phase).** Public job board (`/careers`) + apply form
writing a `Candidate` (mirrors existing public card/landing pattern).

**Integrations.** Conversion → Users + onboarding journeys; offer letter via
storage/e-sign (Wave 3); reporting funnel + time-to-hire (Wave 4).

**Tests.** pipeline moves, résumé upload, interview feedback aggregation,
offer lifecycle, convert-creates-user + journey, recruiting-permission gating.

---

## Wave 3 — Custom fields + e-signature + onboarding packets  (priority 3, ~1.5–2wk)

**Permission:** `hr` (reuse) for definitions/templates; signing is self-service.

### 3a. Custom fields (~3–4d)
- `CustomFieldDef` — entity (employee), key, label, `field_type`
  (text|number|date|select|bool), `options` (json), section, sort, required,
  `sensitive`.
- `CustomFieldValue` — `def_id`, `user_id`, value (json).
- API: admin CRUD defs; values read/written through the profile (respecting
  `sensitive` + edit rules). Profile renders dynamic "custom" sections.
- *Stretch:* repeatable "custom tables" (education, prior employment) — phase 2.

### 3b. E-signature (~3–4d)
- `SignatureRequest` — `document_id?` / template, `user_id` (signer),
  `status` (pending|signed|declined), `signed_at`, `typed_name`,
  `signature_audit` (ip, user-agent, timestamp).
- Flow: HR sends a document to sign → signer notified → signs (typed name +
  consent checkbox + timestamp; non-PKI e-sign with audit trail, BambooHR-style)
  → optional stamped PDF via the pdf service.
- Profile shows "Documents to sign"; HR sees status per request.

### 3c. Onboarding packets / templates (~3–4d)
- `OnboardingTemplate` — name, optional dept/role scoping.
- `TemplateItem` — template_id, kind (task|document|signature), title,
  category, sort.
- Starting an onboarding journey can pick a template → auto-creates checklist
  tasks + signature requests (replaces the hardcoded `DEFAULT_ONBOARDING`,
  which becomes a seeded template).

**Integrations.** Packets ⇄ people journeys + hr_documents/signatures; custom
fields appear on profile + in Wave 4 reports.

**Tests.** field def/value round-trip + sensitivity, sign flow + audit + access,
template → journey materialisation.

---

## Wave 4 — Reporting + surveys  (priority 4, ~1.5–2wk)

**Permission:** `hr`.

### 4a. Report builder (~1–1.5wk)
- `SavedReport` — name, entity (employees|leave|time|compensation|recruiting),
  `columns` (json), `filters` (json), `group_by`, owner, shared, `schedule`.
- Engine over a **whitelisted** field set per entity → tabular results + CSV.
  Canned reports first (headcount, turnover, leave usage, hours, hiring funnel),
  then custom column/filter selection; scheduled reports → emailed digest.

### 4b. Surveys / eNPS (~3–5d)
- `Survey` — title, type (enps|custom), `questions` (json: scale|text|choice),
  `anonymous`, audience (all|department), status, open/close dates.
- `SurveyResponse` — survey_id, `user_id?` (omitted when anonymous),
  answers (json), submitted_at.
- Results: eNPS score, distribution, per-question aggregates, export.

**Integrations.** Dashboard tiles (eNPS, turnover); invites via notifications;
exports via pdf/csv.

**Tests.** report query + filter + CSV, schedule record; survey lifecycle,
anonymity, eNPS calculation.

---

## Sequencing & estimate

| Wave | Module(s) | Increments | Rough effort |
|---|---|---|---|
| 1 Time/attendance | `attendance` | 1 | ~5–7d |
| 2 Recruiting/ATS | `recruiting` | 2 (2a, 2b) | ~2–3wk |
| 3 Custom/e-sign/packets | `hr` | 3 (3a–3c) | ~1.5–2wk |
| 4 Reporting/surveys | `hr` | 2 (4a, 4b) | ~1.5–2wk |

Total ≈ **6–9 weeks** of increments. ATS is the long pole and is split in two.

## Decisions needed before Wave 1
1. Attendance: clock in/out **and** manual entry, or manual only?
2. Timesheet period: weekly (default) / bi-weekly / monthly?
3. Link time to projects/tasks (existing worklog) or plain hours?
4. ATS later: do we want a **public careers page**, or internal-only intake?
5. E-sign: typed-name + audit trail acceptable (non-PKI), or need provider
   integration (DocuSign/etc.)?
