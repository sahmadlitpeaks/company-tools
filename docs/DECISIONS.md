# Project decisions

Open a project and choose **Decisions**. Use this register for significant
business, product, technical or operational choices. Start new requests in
[Requirements](REQUIREMENTS.md); create tasks from the requirement and record
decisions there when a supporting choice needs explanation. Epics, Stories,
Tasks, Bugs and Sub-tasks remain implementation records.

The register uses a desktop table and cards on narrower screens. Draft forms
keep their title and Save/Cancel actions visible while the fields scroll;
linked issues can be searched without clearing earlier selections. The detail
panel keeps its title and Close action visible, separates the approved version
from a later proposal, and places replacement/archive under **More actions**.
When viewing an older version, return to the current content before changing
the decision or acting on the latest proposal.

## Record and approve a decision

1. A project member or administrator creates a draft with title, category,
   problem, chosen approach, rationale and accountable owner. Alternatives,
   effective date, linked issues and evidence references are optional.
2. Choose another active project participant as approver. A viewer can be the
   assigned approver. Saving the draft does not request approval.
3. Submit with a summary. The server preserves the exact submitted content,
   people names, evidence metadata and linked issue details as a revision.
4. Only the explicitly assigned approver can approve or reject that revision.
   A rejection requires a reason. The proposer and submitter cannot approve
   their own submission; a platform administrator cannot substitute for the
   assigned approver. Missing approvers never produce automatic approval.
   Submitted decisions open their frozen snapshot, including the people and
   linked issue details captured at submission, even if source records change.
5. To change submitted or approved content, return it to draft with a reason.
   This withdraws any pending submission. Editing and resubmitting creates a
   new snapshot. An earlier approved revision remains available and explicitly
   labeled while a later proposal is under consideration.

Approved decisions may be replaced by a different approved decision in the
same project. The original becomes **Superseded** and both records link to each
other. Administrators can archive approved, rejected or superseded decisions
with a reason. Archived decisions remain searchable and readable. Archived
projects allow no decision mutations, including approval.

Replacement relationships point to the exact approved revision at replacement.
If that replacement later has a draft or another approval, the old decision
still opens the recorded approved version; its current status is shown separately.

## Track implementation issues

Use **Manage issue links** to add/remove issues or update their relationship
(relates to, implements, affects, depends on). Members/admins can do this while
a decision is draft, pending, approved or rejected. Tracking changes preserve
its status, approval timestamp, approved revision and all submitted snapshots.
The current links are shown separately from the issues captured at submission.
Archived/superseded decisions and archived projects have read-only links.

Each link records its original author/name/time. Retained links keep that
metadata during draft edits or relationship changes. Link mutations also append
history events. Pre-existing links migrated from the first schema have unknown
author/time; the migration does not invent attribution. Links stay within the
project, with at most 100 per decision. All link writes use the same row locks
and optimistic `version` checks as lifecycle writes, so a simultaneous approval
or draft save must reload if tracking changed.

## Access and evidence

The Projects module is required. Reads follow existing project membership;
platform administrators retain their existing administrative visibility.
Project viewers read, while members/admins create, edit and submit. Formal
approval requires explicit assignment and current membership even for a
platform administrator. Knowing a decision ID does not grant access.

The register searches key, title, content and linked issue keys. Filters cover
status, category, owner, proposer, approver and created-date range (UTC), with
bounded pagination. Filter state and opened decisions survive URL reloads.
Issue detail shows related decisions; decision detail opens linked issues.

Evidence references accept HTTP/HTTPS URLs with a type and description. The
server records who added each reference and when. Submitted evidence metadata
is preserved in its revision even if later drafts remove it. External documents
and Teams messages retain their own access controls and availability; they are
not copied or fetched by this feature. Attach files through an existing linked
issue or document and reference that location. Direct uploads on decisions are
outside this release.

Decision revisions and events have no edit/delete API. Names and snapshots
survive deactivated/deleted source users and deleted linked issues. This is
application-level historical integrity, not a storage-level legal hold or
cryptographic tamper-proof archive. No retention/purge policy is introduced.

Notifications are in-app only and go to the relevant active participants on
submission, approval/rejection and withdrawal. They do not fan out to shared
Teams/Slack/email destinations. Ordinary edits do not notify everyone.

## API and storage

All paths begin with `/api/pm`:

| Method | Path | Purpose |
| --- | --- | --- |
| GET, POST | `/projects/{id}/decisions` | Paged register / create draft |
| GET, PATCH | `/decisions/{id}` | Read detail/history / save draft |
| POST | `/decisions/{id}/submit` | Freeze a submitted revision |
| POST | `/decisions/{id}/approval` | Approve/reject the exact revision |
| POST | `/decisions/{id}/revise` | Withdraw / propose another version |
| POST | `/decisions/{id}/supersede` | Link an approved replacement |
| POST | `/decisions/{id}/archive` | Retain as archived |
| POST | `/decisions/{id}/issues` | Add a link or update its relationship (`version`, `issue_id`, `relationship`) |
| DELETE | `/decisions/{id}/issues/{issue_id}?version=N` | Remove a current tracking link |
| GET | `/issues/{id}/decisions` | Linked decisions with project checks |

Writes other than creation require `version`; approval also requires
`revision_number`. Stale versions return 409 and require a reload. Generic draft
PATCH rejects lifecycle/history fields. Issue links must stay in the same
project. `pm_projects.decision_seq` is allocated under a row lock; a database
unique constraint protects `(project_id, number)`. Keys are `PROJECT-DEC-N`.

Migration `z2d3e4f5a6b7` follows `y1c2d3e4f5a6` and adds decisions, revisions,
events, issue links and the project sequence without backfilling fake decisions.
History tables restrict parent deletion. Live issue links can disappear when
an issue is deleted; submitted historical issue details remain in snapshots.
Migration `a3e4f5a6b7c8` follows it, adding link metadata and the recorded
replacement revision. Apply both before running this API. Approval/rejection
share one endpoint; detail responses include history to keep clients consistent.

## Checks and follow-up scope

- `python -m pytest tests/test_pm_decisions.py` covers roles, state transitions,
  evidence, retained snapshots, links, search, validation and stale writes.
- `PM_TEST_DATABASE_URL` enables `tests/test_pm_decisions_postgres.py`: guarded
  local `pm_regression_test` database only; unique temporary schemas test the
  upgrade/downgrade/re-upgrade and concurrent numbering/submission/approval.
- `frontend/e2e/decisions.spec.ts` covers desktop/Pixel 5 and tablet UI,
  accessibility, filters, forms, role-specific actions, old-version actions,
  errors and navigation.
- Opt-in `frontend/e2e/decisions-live.spec.ts` uses a migrated disposable local
  stack with real cookie sessions and PostgreSQL. Set `PM_STACK_E2E=1`,
  `PLAYWRIGHT_BASE_URL`, `E2E_EMAIL`, and `E2E_PASSWORD`. It creates synthetic
  projects, users, issues and decisions; never run it against production.
- Run the full backend suite, one Alembic head, frontend typecheck/build,
  React Doctor, and focused existing Projects tests before release.

Multiple approvers, structured change-request forms, direct decision uploads,
formal requirements baselines, cross-project decision reporting, automatic
Teams ingestion and AI extraction are follow-up scope. Today, changes can be
tracked with an ordinary linked issue and a `change-request` label; no new
requirement or task system is introduced.
