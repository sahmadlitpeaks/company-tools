# SharePoint Document Intelligence — implementation plan

Status: first usable implementation added on `feature/sharepoint-intelligence`.
See [the implementation/setup guide](SHAREPOINT_INTELLIGENCE.md) for current
behavior, concrete limits and setup. The design below is retained as planning
context. Tenant consent and live Microsoft/OpenAI validation remain outstanding.
Repository: [sahmadlitpeaks/company-tools](https://github.com/sahmadlitpeaks/company-tools).
Reviewed against `master` commit `40de8d1`, September 3, 2026.

## Review summary

Add a SharePoint Intelligence module to Company Tools so authorized employees can
find document summaries, tasks, deadlines, and risks without conversational AI.
The first version covers one approved test source and multilingual text-based
files. AI analysis uses the official OpenAI API. Original file bytes are not
retained; derived text, structured results, metadata, and encrypted name mappings
are retained locally and remain sensitive.

The requester has agreed to the scope below. Company approval for the test site,
Microsoft read permissions, OpenAI configuration, and confidential-data handling
is still required. No credentials, real document contents, or live tenant identifiers are
included in this proposal. Configuration values are blank or development examples.

Before rollout, validate delegated user access and incremental sync
in the test tenant, then evaluate multilingual extraction and redaction with
representative synthetic documents. These are feasibility gates, not capabilities
already proven by this review. Automated redaction does not guarantee complete
confidentiality; sensitive external processing requires authorized review.

This is a staged feature with authentication, ingestion, privacy, AI, and UI work.
It is not a fixed-cost or dated delivery commitment. Confirm implementation effort
after the initial Graph proof and representative file tests. Background polling
and reminders follow the first usable version; OCR and a document chatbot are
excluded from that version.

Manager review should confirm:

- The first-version scope and a dedicated non-production SharePoint site.
- Who can provision Microsoft consent/read grants and the required test users.
- The approved OpenAI account/model and who may authorize confidential external
  processing; application-admin status alone is not that business authorization.
- Ownership of encrypted derived data, backup retention, and encryption keys
  before any confidential company documents are introduced.

The following sections preserve the reviewed design. The implementation guide
is authoritative for the shipped endpoints and initial delivery limits.

## 1. Product scope agreed with the requester

Build inside Company Tools using its FastAPI backend, PostgreSQL database,
cookie-authenticated React SPA, and existing component system.

| Decision | Agreed direction |
| --- | --- |
| First usable version | One configured SharePoint source, manual incremental sync, structured intelligence, protected keyword search, and document details |
| Languages | Multilingual, including Arabic, English, other company document languages, and mixed-language files; validate extraction/redaction coverage per language |
| Formats | TXT, text-based PDF, DOCX, XLSX |
| AI analysis | Official OpenAI API only, with server-side configuration |
| Confidential documents | Hold AI analysis pending authorized review of the sanitized payload; skip AI entirely where external processing is prohibited |
| User access | Live delegated SharePoint checks on every content-bearing request; no stale positive permission cache across requests |
| Names and business details | Preserve locally in encrypted mappings and restore for authorized users; pseudonymize AI input |
| Initial Graph boundary | A dedicated, non-confidential test site with an explicit `Sites.Selected` read grant; index the configured folder |
| SharePoint operations | Read-only listing, metadata, delta sync, and file-content retrieval; no file creation, updates, deletion, moves, or permission changes by Company Tools |
| Conversational questions | Excluded; do not add a document chatbot |
| Subsequent milestones | Background polling, then reviewed deadline/task/risk reminders |
| Scanned documents | OCR deferred; report `needs_ocr` or incomplete extraction visibly |

No separate application, n8n, Power Automate, Graph webhooks, permanent raw-file
copy, production SharePoint changes, or deployment is included.

## 2. Existing code to extend

| Existing code | Reuse and required change |
| --- | --- |
| `backend/app/auth/deps.py`, `auth/router.py`, `auth/azure.py` | Keep the application cookie and current-user checks. Add a separate backend-managed delegated Graph connection; existing SSO only requests profile access and does not retain Graph credentials. |
| `backend/app/models/user.py`, `core/permissions.py` | Add the `sharepoint_intelligence` module gate. Bind document access to a verified tenant/object identity; admin and manager module privileges are not document permissions. |
| `backend/app/api/ai_help.py` | Reuse suitable AI configuration/error-handling patterns through a small shared service. Keep SharePoint analysis as a typed OpenAI operation and preserve existing AI Help behavior/configuration; no provider-selection framework is required for this feature. |
| `backend/app/services/app_settings.py` | Reuse configuration and encrypted-secret conventions. Introduce a dedicated versioned encryption key for Graph credentials and document mappings rather than coupling their lifetime to the session signing key. |
| `backend/app/services/scheduler.py` | Add polling only after the manual pipeline works. The in-process scheduler is not a durable queue or cross-process lock. |
| `backend/app/services/notify.py`, `dispatch.py`, `api/notifications.py` | Reuse selectively in a later milestone. Current notification bodies are stored verbatim, reads check recipient identity only, outbound fan-out is automatic when enabled, and Teams uses a shared webhook. |
| `backend/app/services/activity.py` | Record operation IDs, actor, outcome, counts, and sanitized error codes; do not put document text, mappings, sensitive filenames, or download URLs into general audit summaries. |
| `frontend/src/api/client.ts`, `hooks/useApi.ts`, `App.tsx`, `components/navigation.ts` | Preserve same-origin cookies, abort-safe reads, matching route/navigation protection, and installed shadcn components. |
| `docker-compose.yml`, `.env.example`, `backend/.env.example` | Wire every new server setting through both host and container development paths. Existing AI/Azure settings are already forwarded by Compose; new SharePoint settings are not. |

The README's description of AI Help as refusing unsupported answers is older
than the behavior in `api/ai_help.py` and `tests/test_ai_help.py`. Any shared-service
refactor must follow current code/tests without extending general-answer behavior
to extracted document facts.

## 3. Access model comes before ingestion exposure

Use two distinct authorities:

1. **Crawler:** a narrowly granted application identity reads the approved test
   site for ingestion. Its success says nothing about employee access.
2. **Viewer:** a delegated Graph connection proves the signed-in employee can
   currently read the original document. The backend checks this before exposing
   document metadata, snippets, results, details, mappings, citations, or AI context.

Acquire delegated Graph credentials with a backend authorization-code flow,
bound to the current Company Tools session, verified tenant and object ID. Keep
refresh tokens, granted scopes, expiry, and connection status encrypted on the
server. Handle refresh, reconnect, disconnect, account disablement, and revocation.
Do not put Graph tokens in the application JWT or either browser cookie. The
existing application JWT is not an Entra token suitable for an on-behalf-of flow.

The initial delegated candidate is `Sites.Selected` plus the necessary OIDC and
refresh scopes. Verify actual read/download operations in the dedicated test site
before finalizing consent instructions. Provision resource grants separately;
the runtime must not be able to grant itself access or write SharePoint content.
File operations are strictly read-only in both crawler and delegated flows.
Company Tools stores processing state and intelligence only in its own database.
It must not upload, edit, rename, move, delete, or change permissions on SharePoint
items. Test-data preparation and consent/grant setup belong to separately
authorized administrators; their privileges are not granted to the application.
Microsoft documents both application and delegated Selected permissions, with
resource assignment required in addition to consent. See
[Selected permissions](https://learn.microsoft.com/en-us/graph/permissions-selected-overview)
and [delegated authorization](https://learn.microsoft.com/en-us/graph/auth/auth-concepts).

Use a delegated content-access check without downloading the whole file again;
validate that exact operation in the tenant spike. Metadata visibility alone is
not the access proof. Do not follow the returned preauthenticated content URL
unless extracting a file, and never store it as a citation. See
[Graph content download](https://learn.microsoft.com/en-us/graph/api/driveitem-get-content?view=graph-rest-1.0).

Keep only request-local authorization reuse. A denial, revoked connection, or
unavailable permission service withholds content. An outage must be reported as
unverifiable access, not presented as proof of a permission denial. An app admin
without delegated access may manage connection health but cannot read content.

For search, retrieve bounded candidates internally, authorize them, then produce
the response. Filter before public ranking, pagination, snippets, counts, and
facets. If verification cannot complete, do not imply a partial result is the
complete result set. Return sensitive responses with `Cache-Control: no-store`;
clear client results on logout, account changes, and access failures.

Live checks prevent Company Tools from adding a permission-cache grace period.
They cannot promise faster revocation than Microsoft's own propagation, or erase
information already viewed. Revalidate the source version too: previously
extracted content must not remain visible after a detected source change while
new processing is pending or failed.

## 4. Durable manual sync and processing

Create one source configuration now, with source IDs in the schema so another
folder can be added later without a redesign. Persist Graph item IDs and parent
relationships; paths and filenames are display metadata, not identity.

The manual endpoint queues a durable run and returns `202` with its run ID.
Use database-backed work claims and an expiring per-source lease shared by manual
and scheduled triggers. Repeated clicks return the existing active run. Start
with one processing slot and short transactions; do not hold a database
transaction open during network calls, extraction, or model inference.

Separate discovery checkpoints from processing jobs. Persist a page's metadata,
tombstones, and pending jobs before advancing its checkpoint. The final delta
link is committed only after the full enumeration is durably represented. An AI
failure then retries its own job without losing a Graph change or restarting the
whole crawl. Expired leases recover after process restarts, and stale workers
cannot publish over a newer job/version.

Graph v1 documents drive-root delta endpoints. Use a checkpoint per drive and
apply the configured folder boundary through tracked ancestry. Do not assume a
folder-only grant permits root delta enumeration. The dedicated site makes this
initial boundary testable without granting access to a production site. Handle
pagination, repeated item IDs, renames, moved folders and descendants, moves into
or out of scope, deleted facets, and invalid delta tokens. A `410` recovery is a
read-only full reconciliation; never upload local differences. Mark unseen items
deleted only after successful complete reconciliation. See
[drive delta](https://learn.microsoft.com/en-us/graph/api/driveitem-delta?view=graph-rest-1.0).

Respect Graph `Retry-After`, bound retries, and coordinate backoff. Validate
continuation URLs against the expected Graph origin before sending credentials;
download redirects are a separate operation and must not forward Graph bearer
credentials to another host. See
[Graph throttling](https://learn.microsoft.com/en-us/graph/throttling).

Track a processing fingerprint containing source version, extraction/redaction
policy versions, schema/prompt version, and provider/model configuration. Reuse
completed analysis for an unchanged source/fingerprint and enforce database
uniqueness so repeated syncs do not produce duplicate results or normal repeat
AI calls. A crash after a provider accepts a request but before local persistence
can require a repeated call and incur extra usage: do not promise exactly-once
provider execution. Use provider idempotency where supported, record attempts,
and bound automatic retries and cost.
Policy/model changes permit explicit reprocessing. Check the Graph version around
download and before publication to reject results for a superseded file.

Confirmed deletion or out-of-scope movement hides derived content and removes
its searchable chunks, results, mappings, pending approvals, and pending work.
Preserve only a minimal content-free tombstone/audit record. A source connection
failure suspends processing and withholds content until access can be verified;
it is not evidence that files were deleted. Explicit source removal purges its
derived content after checking that no other active source references it.
One employee losing access does not delete content for other employees; it
prevents that employee from retrieving it. Include encrypted mappings and
credentials in backup access/retention documentation, and require source/access
reconciliation before restored data becomes visible.

## 5. Multilingual extraction

Use local parser adapters returning text segments plus source locations:
TXT line ranges, PDF page numbers, DOCX paragraph/table positions, and XLSX
sheet/cell ranges. Prefer `pypdf`, `python-docx`, and `openpyxl` after dependency
review and multilingual fixture validation. Do not evaluate macros, formulas,
embedded code, or external document links. Explicitly flag omitted content,
missing formula values, unsupported encryption, or extraction incompleteness.

Proposed conservative defaults: 25 MiB raw file size, 200 PDF pages, 50,000 XLSX
cells, 200,000 extracted characters, and 100 MiB expanded Office-package data.
Validate these budgets during implementation, bound parser memory/runtime in an
isolated local worker, and report exceeded limits without silently truncating
the document into a successful result. Limit actual downloaded bytes, not just
the Graph size field. Discard source bytes after processing and on cancellation;
do not use the media/upload store, durable jobs, temporary disk spooling, or logs
to retain them. Do not promise forensic erasure of Python process memory.

PDF text extraction is not OCR, and small input files can still expand into
large parser workloads. Reject or flag image-only pages and mixed documents
whose extraction is incomplete instead of presenting them as fully analyzed.
See [pypdf extraction limitations](https://pypdf.readthedocs.io/en/stable/user/extract-text.html).
Office XML/archive parsing needs expansion limits and hardened XML handling;
openpyxl explicitly recommends `defusedxml` for XML attack protection. See
[openpyxl security](https://openpyxl.readthedocs.io/en/stable/index.html#security).

Keep all text in logical Unicode order. Detect document and segment languages
inside the backend, support multiple languages within one file, and avoid a
hardcoded Arabic/English-only allowlist. Validate the scripts and languages in
representative company samples, including Arabic/Latin mixtures, Arabic-Indic
digits, diacritics, punctuation, ligatures, and ambiguous dates. Do not globally
reverse strings. Preserve source text for evidence in memory; apply language-aware
Unicode normalization to search/redaction matching with offsets mapped back to
the original spans. Present RTL languages with appropriate direction and isolate
identifiers, URLs, and mixed-language spans. Do not claim universal language
coverage: report extraction or redaction coverage gaps visibly and withhold AI
processing when the required privacy checks cannot be completed.

## 6. Redaction, names, and external-processing approval

Run deterministic recognizers for emails, phones, identifiers, account details,
secrets, internal URLs, and configured confidential terms alongside local named
entity recognition inside the backend. This preprocessing does not require a
hosted inference endpoint. Configure language-aware recognizers for the document
languages, including mixed-script names, and evaluate their actual coverage.
Retain Arabic and English fixtures and add fixtures for other supported languages;
do not claim that a multilingual library detects every language automatically. See
[Presidio language/model configuration](https://github.com/data-privacy-stack/presidio/blob/main/docs/analyzer/customizing_nlp_models.md).

Recognizers use document/version-scoped placeholders such as `[PERSON_1]`,
`[CLIENT_1]`, and `[PROJECT_1]`, consistent across chunks. Resolve overlapping spans
deterministically. Keep reversible mappings encrypted locally, including encrypted
custom-term values. Missing language coverage, missing recognizers, or failed
redaction block AI processing with an actionable status; they must never silently
send the original text to OpenAI.

Names remain useful inside Company Tools: decrypt and restore approved business
entities only after access verification. Do not expose the mapping dictionary as
a normal API response or restore keys/tokens into ordinary output. A placeholder
from another document/version cannot be resolved. Example using synthetic data:

```text
Local source: أحمد مسؤول عن مشروع المثال.
AI payload:   [PERSON_1] مسؤول عن [PROJECT_1].
User display: أحمد مسؤول عن مشروع المثال.  (after live access verification)
```

Treat sanitized text as still sensitive. Automated detection cannot guarantee
that all confidential information is found; see
[Presidio limitations](https://github.com/data-privacy-stack/presidio/blob/main/docs/faq.md).
Default unknown/confidential documents to `awaiting_approval`, without calling
OpenAI. Documents prohibited from external processing use `ai_skipped` instead.
Only synthetic/non-confidential test material approved for external testing is
eligible for unattended OpenAI calls. For confidential external processing,
require both current document access and explicit company-designated reviewer
authority. Being an application
admin or being able to read a file is insufficient on its own. The authorized
reviewer must inspect the exact sanitized payload, including any metadata sent
with it. Bind approval to the payload hash, source version, redaction policy,
provider endpoint, and model; invalidate it whenever any of these change.

Do not use an AI classification or a recognizer confidence score as external
egress authorization. Support a source/document policy that skips AI entirely.
OpenAI failure uses bounded retries against the approved service or a visible
failure state; it never changes the service or bypasses approval. Store the
processing route and approval audit without confidential content in general logs.

## 7. Shared AI service and factual contract

Introduce a small shared AI service with an operation conceptually equivalent to
`analyze_document(segments, policy) -> DocumentAnalysis`. Implement this operation
using only the official OpenAI Python SDK and a configured model supporting
structured output. Validate the parsed Pydantic result, handle refusal/incomplete
output, and record usage when returned. See
[structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs).

Keep keys and model configuration backend-only and use the SDK's official HTTPS
endpoint. Missing credentials or invalid model configuration leave analysis
disabled with a clear status. Add no arbitrary endpoint override or provider
switch for SharePoint. Automated tests mock the OpenAI SDK; they do not require
an inference server. Preserve existing AI Help behavior and configuration while
reusing suitable helpers; its existing configurable transport does not determine
where SharePoint document content is sent.

The common analysis schema includes summary, tasks, deadlines, risks, blockers,
contacts, project status, requires-attention, and language. Each factual item has
segment references and a sanitized supporting excerpt. Validate references
against the submitted document version, allowed placeholders, field lengths,
enums, and dates. Deterministically match each supporting excerpt to its referenced
sanitized segment using documented whitespace/Unicode normalization; a valid
segment ID alone does not validate an invented quotation. Add regression coverage
for fabricated excerpts as well as nonexistent references.
Unknown owners/dates remain null; document absence is not proof
that a task is pending. Treat document instructions as untrusted content, with
no tools, browsing, permission decisions, or automatic task creation available
to the analysis model.

Chunk within the configured model's context budget and combine validated partial
results with stable entity mappings and duplicate detection. A chunk failure
must not become a complete success. Preserve evidence for ambiguous/relative
dates; do not invent a calendar, year, or timezone. Keep narrative output in the
document's primary language and retain original names when restored locally.

## 8. Persistence and API shape

Proposed entities, using existing UUID/timestamp conventions:

| Entity | Responsibility |
| --- | --- |
| `SharePointSource` | Tenant/site/drive/folder boundary, enabled state, classification/egress policy and redaction rules; no raw files |
| `SharePointDriveCursor` | Durable next/delta checkpoints and reconciliation state per drive |
| `SharePointUserConnection` | Verified local-user/tenant/object association, encrypted delegated credentials and refresh/reconnect state |
| `SharePointDocument` | Unique `(tenant_id, drive_id, item_id)`, source membership, protected metadata, version, current processing state, validated result/provider/usage |
| `SharePointDocumentChunk` | Version-scoped sanitized text, source location and search representation |
| `SharePointDocumentMapping` | Encrypted version-scoped placeholder mappings; never public search data |
| `SharePointSyncRun` / `SharePointProcessingJob` | Durable progress, leases, retries, fingerprints, sanitized error codes and counts |
| `SharePointExternalApproval` | Exact payload/provider/version approval by an authorized reviewer |

Final table layout may consolidate these responsibilities where constraints
remain clear. Extend the current Alembic head; check it again at implementation
time and preserve a single head without rewriting shipped ancestry.
Static inspection at this baseline identifies `h3c4d5e6f7a8` as the terminal
revision; this is not a substitute for running the Alembic head check.

Planned routes under `/api/sharepoint`:

These are Company Tools routes. Their POST/PUT/DELETE operations update local
configuration, processing records, approvals, or connections; none mutate files
or permissions in SharePoint.

| Route | Boundary |
| --- | --- |
| `GET /status` | Module access; operational details restricted to admins |
| `GET /sources`, `POST /connection-test` | Admin; health data without document content |
| `GET /connect`, `GET /callback`, `DELETE /connection` | Session-bound delegated connection lifecycle |
| `POST /sync-now`, `GET /sync-runs/{id}` | Admin; durable run ID and operational progress |
| `GET /documents`, `GET /documents/{id}` | Module plus live document access for every returned item |
| `GET /documents/{id}/external-preview`, `POST /documents/{id}/external-approval` | Company-designated reviewer plus live document access; approval tied to the exact payload |
| `POST /documents/{id}/retry` | Admin; permission and egress policy still apply |
| `GET /redaction-rules`, `PUT /redaction-rules` | Admin; rules are protected configuration and updates invalidate processing fingerprints/approvals |

Use bounded keyword search over protected metadata and sanitized chunks. Start
with PostgreSQL/SQLAlchemy; no external search or vector database is needed.
Provide language-aware Unicode normalization for matching without changing displayed text.
Within a bounded authorized set, local mapping resolution can support business
name matching without a global plaintext mapping index. Source links are ordinary
SharePoint `webUrl` references and are returned only after access verification.
Do not add this corpus to global search until that path shares the same checks.

## 9. Implementation milestones and acceptance gates

1. **Graph and authorization proof.** Add disabled-by-default configuration,
   delegated connection, Selected read-access probe, and mocked permission tests.
   In the disposable test site, prove authorized vs unauthorized users, admin
   without document access, revocation, and content access without full rereads.
   No tenant testing can be claimed until credentials, grants, and test users exist.
2. **Durable manual ingestion.** Add migrations, source/cursor/document/job state,
   leases, delta/reconciliation, deletion handling, run status, and bounded download.
   Prove no duplicate jobs, interrupted-run recovery, and no raw persistence.
3. **Multilingual extraction and privacy.** Add all four parsers, location-preserving
   chunks, language-aware recognizers, encrypted mappings, policy skip, and external
   approval. Validate readable, mixed-language, corrupt, oversized, scanned, and
   hostile fixtures, and the blocked state for insufficient language coverage.
   No cloud fallback for extraction or redaction.
4. **Validated analysis and retrieval.** Add the typed OpenAI service with regression
   tests for any shared-helper refactor and implement search/detail APIs. Prove
   OpenAI sees only the approved sanitized payload and denied documents contribute
   nothing to results. Test names, contacts, ambiguous dates and evidence references.
5. **Minimal usable page.** Add connection/reconnect, sync status, document list,
   search, detail/evidence/source links, and admin controls. Include loading, empty,
   partial/failed, revoked, `needs_ocr`, and approval-required states. Follow
   `docs/FRONTEND_COMPONENTS.md`; verify desktop and Pixel 5 layouts and RTL content.
6. **Later: polling.** Reuse the same durable pipeline from the existing scheduler;
   choose a configurable polling interval and preserve cross-trigger leases.
7. **Later: reviewed reminders.** Confirm extracted facts and map names to verified
   user identities before routing. Recheck access before dispatch and at display.
   Use content-free notification envelopes with protected links, or add live
   permission-aware rendering. Do not put restored names/documents into the shared
   Teams webhook. Deduplicate by document version, reviewed fact, recipient, and
   reminder window independently of whether an earlier notification was read.

## 10. Configuration and local verification handoff

Planned server-only configuration:

```dotenv
SHAREPOINT_ENABLED=false
SHAREPOINT_TENANT_ID=
SHAREPOINT_CLIENT_ID=
SHAREPOINT_CLIENT_SECRET=
SHAREPOINT_SITE_ID=
SHAREPOINT_DRIVE_ID=
SHAREPOINT_FOLDER_ID=
SHAREPOINT_REDIRECT_URI=http://localhost:5173/api/sharepoint/callback
SHAREPOINT_ENCRYPTION_KEY=
SHAREPOINT_SYNC_INTERVAL_SECONDS=300
SHAREPOINT_MAX_FILE_BYTES=26214400

SHAREPOINT_OPENAI_API_KEY=
SHAREPOINT_OPENAI_MODEL=
```

Reuse the narrowly granted SharePoint app registration for its delegated flow
initially; keep the existing directory-sync registration separate. Register the
actual same-origin callback for the chosen development entry point. Support key
versioning/rotation without logging ciphertext contents or decrypted values.
Configuring an API key does not authorize confidential egress; jobs requiring
review wait for approval, and prohibited documents skip AI entirely.

`SHAREPOINT_OPENAI_API_KEY` is an official OpenAI key and
`SHAREPOINT_OPENAI_MODEL` selects the approved structured-output model. These
feature-specific settings leave existing AI Help configuration unchanged.
The SharePoint service accepts no base-URL override and does not fall back to
AI Help's existing key, model, or endpoint settings.
Both host-run and container-run backends call OpenAI's official HTTPS endpoint.
Use mocks for automated tests and approved synthetic documents for live testing.
Document installation/configuration of in-process text recognizers and their
validated language coverage; no analysis model server is required.

Once the milestones above are implemented:

1. Work in the clean checkout. A separately authorized test-site administrator
   prepares synthetic sample documents and at least two Entra test users with
   different file access. Company Tools receives read-only access throughout.
2. Put real configuration into ignored local environment files, never this plan.
   Verify presence/status without printing secret values or rendered Compose secrets.
3. Use the existing local Docker backend/database and Vite setup with an isolated
   Compose project/database. Check host ports before starting alongside the old
   checkout. Do not reuse or migrate an existing production volume.
4. Sign in and connect Microsoft access, run connection checks, then trigger sync.
   Verify each format and language, restored names, evidence, and source links.
5. Repeat unchanged sync, then have the test-site administrator modify, rename,
   move, and delete sample files through SharePoint. Verify Company Tools only
   reads the resulting changes, processing counts, version replacement, scope
   boundaries, and tombstones. Mocked Graph tests reject file-mutation requests.
6. Have the administrator revoke user access while the app session remains active.
   Verify list/detail, search, counts, evidence and restored values are withheld.
   Test Graph outage,
   token expiry, invalid consent, and source disconnection as distinct states.
7. Exercise OpenAI with approved non-confidential fixtures; malformed JSON,
   refusal, timeouts and partial output remain visible failures. Verify exact
   outgoing payloads through mocks, without logging real confidential text.

Automated Graph/AI tests use mocks and synthetic fixtures, never tenant secrets.
Run the full backend suite plus PostgreSQL migration/concurrency checks in a
disposable database; the existing SQLite fixtures cannot prove those behaviors.
From `backend/`, run `python -m alembic heads` and `python -m pytest`.
After frontend implementation, run `npm run typecheck`, `npm run build`,
`npm run doctor`, and focused Playwright tests in both configured projects.
Finish with `git diff --check`. Report actual passed/failed/blocked checks and
distinguish mocked coverage from tenant/provider integration testing.

## 11. Plan status and known limits

The product choices above include the manager's and requester's follow-up: document languages
may vary, AI analysis uses OpenAI only, and SharePoint file access is strictly
read-only. This supersedes the earlier two-provider and Arabic/English-only scope.
Implementation includes four tables (source/cursor/lease state, private user
connections, document/job/content state, and runs), migration `i4d5e6f7a8b9`,
read-only sync, offline privacy preprocessing, approval, OpenAI analysis, protected
search and responsive UI. Optional polling shares the worker and defaults off.
The separate AI service leaves existing AI Help behavior unchanged.
Company approvals, tenant credentials/read grants and live Microsoft/OpenAI
behavior remain outstanding. Additional languages require installed recognizers
and representative privacy validation; Arabic/English synthetic checks alone
do not prove universal redaction quality.

The next external validation milestone is the live Graph/authorization proof;
automated mocks and local implementation are available. OCR, conversational questions,
automatic task creation, and externally delivered document reminders are outside
the first usable version. Final delivery must include the actual changed files,
migration head, Graph consent instructions, configuration, runnable test commands,
privacy decisions, measured limitations, and verification results.
