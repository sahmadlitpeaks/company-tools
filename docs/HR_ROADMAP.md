# HR Platform — BambooHR Parity Program

Status: **planning**. Goal: full functional parity with BambooHR so we can
replace it. This supersedes the earlier 4-wave draft, which was only a subset.

Each wave ships as its own increment(s): models + migration + permission-gated
API + tests + frontend, suite green, committed & pushed — same rhythm as the
HR module already delivered (records, documents, leave, compensation,
performance, HR dashboard, `hr` permission).

Legend: ✅ done · ⚠️ partial · ❌ missing

---

## 1. Full capability matrix (every BambooHR area)

### Core HRIS
| Capability | Status | Wave |
|---|---|---|
| Employee records / database | ✅ | — |
| Employee self-service portal | ✅ | — |
| Org chart | ✅ | — |
| Company directory | ✅ | — |
| **Custom fields** (admin-defined) | ❌ | P1 |
| **Custom tables** (education, dependents, prior employment, visas…) | ❌ | P1 |
| **Field-level permissions / custom access levels** | ❌ | P1 |
| **Standard profile tabs** (Personal/Job/Time-off/Docs/Benefits/Training/Notes/Assets) | ⚠️ | P1 |
| Employee bulk import/export | ⚠️ (some CSV) | P1 |
| Audit trail | ✅ (activity log) | P1 (field-level) |
| **Configurable approval workflows** (multi-step routing) | ⚠️ (single approver) | P1 |
| Notes & private manager notes | ❌ | P1 |

### Time off
| Capability | Status | Wave |
|---|---|---|
| Multiple leave policies & types | ✅ | — |
| **Accrual schedules** (monthly/anniversary, waiting period, caps) | ⚠️ (annual default) | P2 |
| **Carryover automation / year-end rollover** | ⚠️ (field only) | P2 |
| **Half-day / hourly leave** | ❌ | P2 |
| Holiday calendar | ✅ | — |
| **Blackout dates / policy assignment by group** | ❌ | P2 |
| Balances + history + projected balance | ⚠️ | P2 |
| Team calendar / iCal feed | ⚠️ (who's-out) | P2 |

### Time tracking
| Capability | Status | Wave |
|---|---|---|
| Clock in/out, daily hours | ❌ | P3 |
| Weekly **timesheets** + submit/approve | ❌ | P3 |
| Overtime, expected-hours schedules | ❌ | P3 |
| Project/task hours | ⚠️ (worklog) | P3 |
| Reminders for missing time | ❌ | P3 |

### Documents & signing
| Capability | Status | Wave |
|---|---|---|
| Employee document storage | ✅ | — |
| Expiry tracking & alerts | ✅ | — |
| **Folders / categories / company files** | ⚠️ | P4 |
| **E-signature + audit trail** | ❌ | P4 |
| **Document templates + bulk send / acknowledgements** | ❌ | P4 |

### Hiring / Onboarding
| Capability | Status | Wave |
|---|---|---|
| Onboarding / offboarding checklists | ✅ | — |
| Auto-provision suggestions | ✅ | — |
| **Onboarding packets / templates** (tasks+docs+signatures) | ❌ | P5 |
| **Preboarding / new-hire self-onboarding** (fill info before day 1) | ❌ | P5 |
| Welcome emails / "get to know you" | ❌ | P5 |
| **ATS**: job openings | ❌ | P6 |
| **ATS**: careers site + applications | ❌ | P6 |
| **ATS**: candidate pipeline (kanban) | ❌ | P6 |
| **ATS**: interview scheduling + scorecards | ❌ | P6 |
| **ATS**: offer letters + e-sign → hire→onboard | ❌ | P6 |
| Job-board distribution (Indeed/LinkedIn) | ❌ | P6 (adapter, optional) |

### Compensation & Payroll
| Capability | Status | Wave |
|---|---|---|
| Salary history & pay changes | ✅ | — |
| Pay bands / ranges | ✅ | — |
| Bonuses / allowances | ✅ | — |
| **Total compensation / total-rewards statement** | ❌ | P7 |
| **Pay-change approval workflow** | ❌ | P7 |
| **Payslips / pay stubs** (generate+store PDF, YTD) | ❌ | P8 |
| **Earnings & deductions, pay schedules** | ❌ | P8 |
| Payroll export to provider (CSV/API) | ❌ | P8 |
| Tax calculation & filing | ❌ | out of scope (integrate) |

### Benefits
| Capability | Status | Wave |
|---|---|---|
| **Benefit plans & classes** | ❌ | P9 |
| **Enrollment + open-enrollment windows** | ❌ | P9 |
| **Dependents / beneficiaries** | ❌ | P9 (table in P1) |
| **Costs (employer/employee) + deductions → payroll** | ❌ | P9 |

### Performance & Engagement
| Capability | Status | Wave |
|---|---|---|
| Goals + progress | ✅ | — |
| Review cycles + manager reviews | ✅ (light) | P10 |
| **Self + peer + 360 assessments** | ❌ | P10 |
| **1:1 meeting notes** | ❌ | P10 |
| **Continuous feedback / kudos / praise** | ❌ | P10 / P12 |
| Performance trends / heatmap | ❌ | P10 |
| **eNPS + custom surveys** | ❌ | P12 |

### Reporting & Analytics
| Capability | Status | Wave |
|---|---|---|
| HR dashboard | ✅ | — |
| **Standard report library** (headcount, turnover, tenure, comp, time-off, time, hiring funnel, EEO/diversity) | ❌ | P11 |
| **Custom report builder** + saved/shared | ❌ | P11 |
| **Scheduled & exported reports** (CSV/PDF/email) | ❌ | P11 |
| Workforce planning / headcount trends | ❌ | P11 |

### Experience & Platform
| Capability | Status | Wave |
|---|---|---|
| Announcements / company feed | ✅ | — |
| **Company calendar** (birthdays, work anniversaries, holidays, who's-out) | ⚠️ | P12 |
| **Kudos / shoutouts** | ❌ | P12 |
| **Learning / training + certifications & renewals** | ❌ | P13 |
| **Email notifications / digests** | ⚠️ (in-app) | P14 (cross-cutting) |
| **Slack/Teams outbound** | ❌ | P14 |
| **Public API + webhooks** | ⚠️ | P14 |
| Multi-entity / multi-currency | ⚠️ (currency on records) | P14 |
| Mobile | responsive web only (no native app) |

---

## 2. Build program (parity waves)

> Reusing throughout: storage service, PDF renderer, notify + activity log,
> approvals pattern, people journeys, and the `hr` permission + `is_hr()`.

**P1 — Records platform & access control**
Custom fields + custom tables (dependents, education, prior employment, visas);
field-level permission scheme (per-field view/edit by role/relationship);
standard BambooHR-style profile tabs; private notes; configurable multi-step
approval-workflow engine (reused by leave, pay changes, offers); full employee
import/export; per-field audit. *(~2–2.5 wk)*

**P2 — Time off maturity**
Accrual schedules (monthly/anniversary, waiting periods, caps), carryover/
year-end rollover job, half-day & hourly requests, policy assignment by group,
blackout dates, projected balances, team calendar + iCal feed. *(~1.5 wk)*

**P3 — Time tracking / attendance**
Clock in/out + manual entries, weekly timesheets submit→approve, schedules &
overtime, project hours, missing-time reminders, leave/holiday-aware. *(~1 wk)*

**P4 — Documents & e-signature**
Folders/company files, e-signature with audit trail + stamped PDF, document
templates, bulk send & acknowledgement tracking. *(~1.5 wk)*

**P5 — Onboarding packets & preboarding**
Configurable packet templates (tasks + docs-to-sign + welcome emails);
new-hire preboarding portal to self-complete info/sign before start; offboarding
templates. Replaces hardcoded default checklist. *(~1.5 wk)*

**P6 — Recruiting / ATS** *(largest; 2–3 increments)*
Job openings, public careers site + application intake, candidate kanban
pipeline, interview scheduling + scorecards, email templates, offers + e-sign,
hire→create-user→onboarding packet; optional job-board adapters. *(~3–4 wk)*

**P7 — Compensation maturity**
Total-rewards statement (salary + benefits + bonuses + employer costs),
pay-change request→approval workflow, comp history visualisation. *(~1 wk)*

**P8 — Payroll inputs & payslips**
Pay schedules, earnings & deduction codes, payslip generation (PDF) + YTD,
payroll register, export to provider (CSV/API). No tax engine — integrate.
*(~2 wk)*

**P9 — Benefits administration**
Benefit plans & classes, enrollment + open-enrollment windows, dependents/
beneficiaries, employer/employee costs → deductions feed payroll. *(~2 wk)*

**P10 — Performance maturity**
Self/peer/manager + 360 assessments, configurable cycle templates & questions,
1:1 notes, continuous feedback, calibration/heatmap & trends. *(~2 wk)*

**P11 — Reporting & analytics**
Standard report library (headcount, turnover/retention, tenure, diversity/EEO,
comp, time-off, time-tracking, hiring funnel), custom report builder over a
whitelisted schema, saved/shared/scheduled, CSV/PDF export, workforce trends.
*(~2 wk)*

**P12 — Engagement & experience**
eNPS + custom surveys (anonymity, targeting, results), kudos/shoutouts wall,
company calendar (birthdays, work anniversaries, holidays, who's-out). *(~1.5 wk)*

**P13 — Learning & training**
Trainings/courses, assignments, completion tracking, certifications with
expiry/renewal reminders (ties into documents). *(~1 wk)*

**P14 — Platform & integrations (cross-cutting)**
Email notifications/digests (SMTP), Slack/Teams outbound webhooks, public API
keys + outbound webhooks, multi-entity/multi-currency polish, accessibility &
mobile-responsive pass. *(~1.5–2 wk)*

---

## 3. Scope decisions (defaults unless you object)
- **Payroll (P8):** build inputs, payslips, register and provider export — **not**
  a tax-calculation/filing engine (country-specific; integrate with a provider).
- **E-signature (P4/P6):** built-in typed-signature + consent + full audit trail
  (legally typical, BambooHR-style). DocuSign/PKI as an optional adapter later.
- **Job boards (P6):** build our own careers site; Indeed/LinkedIn posting as
  optional adapters after core ATS.
- **Email/Slack (P14):** depends on SMTP/webhook access in the environment.
- **Mobile:** responsive web, no native app.
- **Multi-entity:** support multiple legal entities + currencies as attributes;
  not separate tenant databases.

## 4. Sequencing & estimate
Order: **P1 → P3 → P2 → P4 → P5 → P6 → P10 → P11 → P9 → P8 → P7 → P12 → P13 → P14**
(records/access first because everything else builds on custom fields, workflow
engine and field-level permissions; payroll after benefits so deductions exist).

Total ≈ **5–7 months** of increments for full parity. We ship continuously, so
it's usable and replacing BambooHR piece-by-piece throughout — not big-bang.

## 5. Definition of "parity done"
- Every ✅/⚠️ row above is ✅.
- Each module has create/read/update/delete + permissions + tests + UI.
- Data import from BambooHR (CSV/export) supported for employees, time-off
  balances, comp, documents.
- Standard report library covers BambooHR's common reports.
