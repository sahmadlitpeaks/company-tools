# SharePoint Intelligence: setup and operation

Implemented in the `feature/sharepoint-intelligence` branch, based on master
`40de8d1`. The module is disabled until configured. Local checks use synthetic
data and mocked Microsoft/OpenAI responses; tenant consent, live permission
behavior and the organization's OpenAI account must still be verified.

## What works

- A module-protected `/sharepoint` page with Microsoft connect/reconnect/disconnect,
  administrator connection test and automatic or manual sync, private keyword search, document
  details, source excerpts, summaries, tasks, owners, ISO deadlines, risks and contacts.
- Read-only Graph ingestion of a selected test folder. Incremental drive delta,
  page checkpoints, tombstones, folder ancestry, full reconciliation after an
  expired cursor, bounded file downloads and a database lease shared by workers.
- Offline TXT, PDF, DOCX and XLSX extraction, regex/custom-term/NER redaction,
  encrypted name mappings, exact-payload review, and typed OpenAI Responses analysis.
- Live delegated metadata and content-read checks before every content-bearing
  response. Administrators cannot bypass SharePoint permissions. Changed versions
  and documents moved outside the configured folder are withheld until resynced.
- Automatic five-minute polling uses the same durable queue. Document chat,
  extracted task reminders, and outgoing reminder delivery are included. Local
  English/Arabic OCR reads text in embedded PDF images. Configurable
  company/document-type owner assignment rules are not yet included.

## Values and permissions to obtain

All values below belong on the backend, never in frontend environment variables.

| Setting / prerequisite | Obtain from |
| --- | --- |
| Working Microsoft sign-in (`AZURE_*`) | Existing Company Tools Entra SSO registration. A user must sign in through Microsoft once so their verified object ID is present. |
| `SHAREPOINT_TENANT_ID` | Entra tenant / directory ID; same organization as the users. |
| `SHAREPOINT_CLIENT_ID` | A separate Entra application registration dedicated to this read-only integration. |
| `SHAREPOINT_CLIENT_SECRET` | That registration's client secret **value**, not its secret ID. |
| `SHAREPOINT_SITE_ID` | Graph ID of a dedicated non-production SharePoint site. |
| `SHAREPOINT_DRIVE_ID` | Graph ID of its document library. |
| `SHAREPOINT_FOLDER_ID` | Drive item ID of the approved test folder. |
| `SHAREPOINT_REDIRECT_URI` | Exact registered Web callback, such as `http://localhost:8080/api/sharepoint/callback` for Compose or `http://localhost:5173/api/sharepoint/callback` for Vite. Production requires HTTPS. |
| `SHAREPOINT_ENCRYPTION_KEY` | Generate a dedicated Fernet key locally; keep it with your encrypted database backups. |
| `SHAREPOINT_OPENAI_API_KEY` | Organization-approved official OpenAI API project key. |
| `SHAREPOINT_OPENAI_MODEL` | Approved model that supports the Responses API and structured outputs. This is an API model ID, not a ChatGPT subscription. |
| `SHAREPOINT_REVIEWER_IDS` | Comma-separated **Company Tools user UUIDs** of authorized privacy reviewers. An admin sees their own UUID on the page. Admin status alone does not make someone a reviewer. |
| `SHAREPOINT_NER_LANGUAGES` | Comma-separated supported privacy languages, initially `ar,en`. Install matching Stanza NER resources before processing. |
| `sharepoint_intelligence` module grant | Company Tools administrator grants it to the participating users. Ordinary members/managers do not get it automatically. |

For the dedicated SharePoint registration, have the tenant administrator grant
Microsoft Graph **application** `Sites.Selected` and **delegated** `Sites.Selected`
consent, then assign that application a **read** role on the selected test site.
The user flow also requests `openid profile offline_access`. Selected-scope
consent alone provides no site access; the explicit site assignment is required.
Delegated access is constrained by the signed-in user's access too.
See [Microsoft's selected-permission model](https://learn.microsoft.com/en-us/graph/permissions-selected-overview).

Site provisioning, sample upload and grant creation are administrator operations
outside this application. Do not grant `Sites.ReadWrite.All`, `Sites.FullControl.All`
or a write role to the running integration. Its Graph client only implements GET
operations; OAuth token exchange uses POST to Microsoft's identity service.

Use a small dedicated library: root delta reads library metadata to determine
folder moves and ancestry, while extraction/search are restricted to the configured
folder. The default cap is 2,000 known library items, including folders and tombstones.
This is not a tenant-wide crawler. Only Microsoft's public cloud hosts are supported.

Generate a key in a private terminal after activating your environment:

```bash
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

Put secrets in ignored `.env` files or your deployment secret store. Root `.env`
is used by Compose; a backend run from `backend/` reads `backend/.env`.
Do not paste real keys into this document or a commit.

## Start with Docker Compose

Use an isolated test project and free ports when another checkout is running.
Create root `.env` from `.env.example`, fill the settings above, and set
`SHAREPOINT_ENABLED=true`. Keep polling disabled for the first test.

```bash
docker compose -p company-tools-sharepoint build backend
docker compose -p company-tools-sharepoint run --rm --no-deps backend python scripts/sharepoint_models.py --languages ar,en --directory /data/nlp-models
docker compose -p company-tools-sharepoint up -d --build
```

Enabling SharePoint at build time installs the optional NLP dependencies. The
one-time model command downloads models into a private named volume. Add each
needed language to that command and `SHAREPOINT_NER_LANGUAGES`; runtime never
downloads models or sends text elsewhere for redaction. There is no local AI
endpoint, model server or separate AI service to configure.

The backend entrypoint upgrades Alembic before starting. The migration head is
`i4d5e6f7a8b9`, following `h3c4d5e6f7a8`. The durable worker starts whenever
`SHAREPOINT_ENABLED=true`, independently of the existing general scheduler flag.

## Host development

From the clean checkout, create/activate a Python environment and install:

```bash
python -m pip install -r backend/requirements-dev.txt
python -m pip install -r backend/requirements-sharepoint-nlp.txt
cd backend
python scripts/sharepoint_models.py --languages ar,en --directory ./nlp-models
python -m alembic upgrade head
python scripts/dev_server.py --port 8000
```

Run `npm ci` and `npm run dev` from `frontend/` in another terminal. Keep the
SPA on one origin and use the existing Vite proxy. The development helper and
Alembic runner select the Psycopg-compatible event loop on Windows. Use Python
3.11+ with supported PyTorch wheels for the host NLP installation.

## First live test

1. Have the site administrator prepare synthetic text-only files and two test
   users with different file access. Include Arabic, English and each additional
   intended language; allow enough time for permission changes to propagate in Microsoft.
2. Sign in through Microsoft, open **SharePoint Intelligence**, then **Connect
   Microsoft**. The connected account must match the existing user's verified
   tenant/object identity; a matching email alone is insufficient.
3. An administrator clicks **Test connection**. This checks crawler read access
   and folder configuration, not OpenAI connectivity or another user's permissions.
4. Leave **Privacy policy** at **Review every sanitized payload**. Add company
   names, project names, addresses or values that must be pseudonymized.
5. Wait for the automatic sync (within five minutes), or click **Sync now** for an immediate test. A reviewer opens an awaiting-approval document, inspects
   every sanitized excerpt, and approves the exact payload. If private data is
   missed, update the terms and sync again instead of approving it.
6. Verify source quotes, restored names, owners and dates. Search uses POST so
   names and search text stay out of URL access logs. Pagination scans at most
   20 candidates per request; an empty page can still have a next page.
7. Repeat unchanged sync: completed versions should not invoke OpenAI again.
   Have the administrator change, move and delete samples in SharePoint. Re-sync
   and verify replacements/purges. Company Tools makes no file writes.
8. Revoke one user's file access, leaving their Company Tools session active.
   Refresh/search/reopen the document and verify that content is withheld. Also
   test download-blocked/read-restricted files, consent removal, expired refresh
   tokens and Graph outages. Reconnect when Microsoft requires fresh consent.

Automatic **test corpus** processing is only appropriate if every file in the
configured folder is approved synthetic/nonconfidential material. Unknown or
confidential material should retain the default per-payload review policy.
**Prohibit external AI** skips extraction/analysis and clears prior derived content.
Policies apply to the source as a whole; this version does not inspect sensitivity
labels or automatically classify confidentiality.

## Privacy, retention and operational limits

The database stores metadata and sanitized segments/results. Per-version name
mappings and delegated access/refresh tokens use a dedicated MultiFernet key.
Business names/emails/phones can be restored after authorization; detected
credentials, private keys, identifiers and signed links remain redacted. Treat
the entire database and backups as sensitive: pseudonymization is not anonymization.

OpenAI receives sanitized excerpts, stable segment locations, instructions and
the output schema; it receives neither file bytes nor filenames or restoration
maps. Requests use the official endpoint with `store=false`. That flag does not
itself guarantee zero abuse-monitoring retention; confirm the organization's
required [OpenAI data controls](https://developers.openai.com/api/docs/guides/your-data)
before introducing confidential documents.

Automated recognition can miss entities. Language detection can also be uncertain,
especially for short or mixed text. Unsupported/uncertain coverage or missing NER
models blocks analysis, rather than falling back to cloud redaction. Supported
languages depend on installed [Stanza NER models](https://stanfordnlp.github.io/stanza/ner.html)
and representative testing. Initial synthetic Arabic/English checks are not a
multilingual confidentiality guarantee.

Default limits: 25 MiB download, 200,000 extracted characters, 200 PDF pages,
50,000 workbook cells, 80 MiB expanded archive, 120 seconds and 2 GiB RSS per
parser child. File bytes live only in memory. The Docker backend includes local
Tesseract English/Arabic OCR for embedded PDF images; it sends no raw images to
OpenAI. An image larger than 10 million pixels, more than 100 images per page,
OCR unavailability, or a substantial image with no readable text blocks PDF
analysis. Small non-text graphics such as logos and QR codes stay in SharePoint
and cannot supply AI evidence. Encrypted/empty PDFs, embedded objects/charts in
Office files, and spreadsheets with formulas remain blocked. Use privacy review
for confidential files and check OCR text before approval. Complete English dates
such as `31 Jul 2027` are normalized to ISO only when the cited quote contains
the original date; ambiguous numeric dates are left unspecified.

After deploying an OCR recovery update, the next sync resets earlier PDF OCR
failures once, including files that exhausted their previous attempt budget.
The usual three-attempt limit still applies to the new processing attempt.
Unchanged documents that are already ready are not reprocessed. If a PDF still
fails after three attempts, check that the running backend image includes
Tesseract and its English/Arabic language data; rebuilding an image without
recreating the running backend container does not update the OCR runtime.

Jobs checkpoint metadata pages and cursor state transactionally. Leases renew
every 20 seconds and expire after 180 seconds; a restarted worker reclaims an
expired lease. Up to three processing attempts are allowed; **Retry document**
starts a fresh privacy pass and discards earlier approval. Changed privacy terms,
model/prompt settings or versions invalidate previous payload approval. The
reviewer's current app/module and delegated content access is checked again
before approved work is sent to OpenAI.

A crash after OpenAI accepted a request but before the result was committed can
cause a repeat call and cost. Persisted unchanged completed results are reused;
exactly-once provider billing is not promised. Failed pages resume on the next
automatic polling run. Polling defaults to every 300 seconds when SharePoint is
enabled. Set `SHAREPOINT_POLLING_ENABLED=false` only to disable it explicitly;
the interval has a minimum of 60 seconds. A changed privacy policy queues
processing immediately. Saving the same policy and terms leaves existing
analyses and approvals intact.

Sync removes live derived content for deleted/out-of-scope files. Existing backup
copies follow the organization's backup retention policy. Changing configured
source IDs creates a different source; old source rows are inaccessible through
the new configuration but remain in the database until an administrator retires
them under the retention policy. No automatic cross-source purge is performed.

For key rotation, put the new key in `SHAREPOINT_ENCRYPTION_KEY` and retain old
keys in comma-separated `SHAREPOINT_PREVIOUS_ENCRYPTION_KEYS`. New writes use the
new key; old rows/backups still require their old keys until reprocessed or
retired. Losing the keys makes stored maps/tokens unrecoverable. Never remove an
old key just because a new key was configured.

Keep HTTP/auth/model library debug logging and request/response body capture off
for this feature. Application errors and audit entries use safe codes/static
summaries. No restored names or document facts are sent to shared Teams channels
or ordinary notification bodies.

## Validation commands

From `backend/`: `python -m alembic heads`, `python -m pytest`, and focused
`python -m pytest tests/test_sharepoint.py`. Tests use synthetic data and mocked
Graph/OpenAI services. Use disposable PostgreSQL for upgrade/downgrade and
concurrent queue/lease checks, never an existing production database.

From `frontend/`: `npm run typecheck`, `npm run build`, `npm run doctor`, then
`npx playwright test e2e/sharepoint.spec.ts` with `PLAYWRIGHT_BASE_URL` pointing at
the local frontend. Both desktop and Pixel 5 projects run, including accessibility,
Arabic direction, review submission, denied content and setup controls.

The implementation was checked with PostgreSQL 16 full upgrade plus feature
downgrade/re-upgrade, and eight concurrent queue requests/worker claims (one run,
one lease). Tenant/provider live testing is still required before rollout.

Recorded local verification on September 3, 2026:

- Full backend suite: 380 passed; final SharePoint-focused rerun: 33 passed.
- Frontend typecheck and production build passed; React Doctor: 100/100.
- Eight Playwright checks passed across desktop and Pixel 5, including axe checks.
- PostgreSQL schema matches the new ORM tables; one migration head.
- Real offline parser/NER child-process checks passed for English, Arabic and
  mixed text, preserving/restoring test names and keeping ISO dates visible.
- Windows dev server with PostgreSQL: health, cookie login, password rotation and
  the disabled SharePoint setup endpoint passed.
- Compose configuration and `git diff --check` passed. No tenant/OpenAI calls,
  deployment, commit or push were performed.

## Target User Experience & 4 Core Pillars

Per management functional specification, the end-user experience must remain simple, intuitive, and hide technical complexity (embeddings, indexing, sync internals). SharePoint remains the single source of truth for documents and permissions.

The user-facing system is structured around 4 pillars:
1. **Document List**:
   - Shows documents authorized for the logged-in user.
   - Respects SharePoint permissions (users never see files they lack access to in SharePoint).
   - Shows processing state, folder breadcrumbs, and direct opening links.
2. **Central AI Chatbot** (Implemented & Verified):
   - One unified conversational assistant (`POST /api/sharepoint/chat`) with live delegated access checks across all ready SharePoint documents.
   - Cross-document reasoning engine (`ask_central`) synthesizing an Authorized Document Catalog (expiries, commercials, deadlines, risks, contacts, summaries) with targeted keyword excerpt retrieval.
   - Grounded responses provide direct SharePoint opening links (`webUrl`), document names, and excerpt citations.
   - Interactive UI in `CentralChatTab.tsx` with quick suggestion chips, document scoping dropdown, markdown formatting, and verified source cards.
3. **Tasks & Reminders** (Implemented & Verified):
   - Extracted deadlines, contract renewals, license expiries, and milestone deliverables stored as actionable tasks in `SharePointReminder`.
   - Actionable task extraction directly from document analysis findings (`section.tasks`), populated with priority, deliverable owner, target date, and notes.
   - Lifecycle management endpoints (`POST /reminders/{id}/complete`, `POST /reminders/{id}/reopen`, `POST /reminders/{id}/dismiss`, `PATCH /reminders/{id}`).
   - Dedicated interactive UI in `AlertsRemindersTab.tsx` with timeline and calendar views, completion and snooze actions, and a document review queue.
4. **Escalating Notification Schedule**:
   - Automated delivery via Microsoft Teams Adaptive Cards and HTML Email.
   - Frequency increases as deadlines approach (e.g., monthly reminder → weekly reminders during the last month → 3 reminders in the final week → expiration alerts).
