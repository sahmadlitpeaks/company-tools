# SharePoint Intelligence and Document Compliance

SharePoint is the source of original files and access rights. Company Tools stores extracted text, compliance facts, owners, tasks, reminders, and audit events. The Documents navigation contains both **Compliance** for managed actions and **Assistant** for source-grounded questions.

## Set up the source

Configure the existing designated site, library, and folder with `SHAREPOINT_SITE_ID`, `SHAREPOINT_DRIVE_ID`, and `SHAREPOINT_FOLDER_ID`. Set `SHAREPOINT_ENABLED=true` and provide the dedicated app registration's tenant ID, client ID, client secret, and redirect URI. The Microsoft Graph app needs application and delegated `Sites.Selected` consent plus a read assignment on the selected site. The application does not write to SharePoint. Users must connect their own Microsoft accounts to view documents; every document read and compliance dashboard entry is checked against their live delegated SharePoint access and the configured folder.

Set `SHAREPOINT_OPENAI_API_KEY` on the backend and `SHAREPOINT_OPENAI_MODEL=gpt-6-luna`. The key stays in the ignored `backend/.env` or deployment secret store, never in the frontend. Keep `SHAREPOINT_ENCRYPTION_KEY` for Microsoft tokens and older encrypted records. Give participating users the `sharepoint_intelligence` module permission. Administrators can configure owner rules; administrators or users listed by UUID in `SHAREPOINT_REVIEWER_IDS` can verify uncertain documents, subject to their SharePoint access.

The backend polls automatically (`SHAREPOINT_POLLING_ENABLED=true`, `SHAREPOINT_SYNC_INTERVAL_SECONDS=60`) and can be synced manually from Document sources or Compliance. Delta sync tracks new, updated, moved, and deleted files. In development, Vite proxies same-origin `/api` requests to the backend; set `VITE_API_PROXY_TARGET` if the backend uses a nondefault port. Docker starts by applying Alembic migrations.

## Processing flow

1. A SharePoint upload or update enters the configured folder. The worker reads the file with app-only Graph access and extracts text from supported TXT, PDF, DOCX, and XLSX files. English and Arabic OCR handle text embedded in PDF images.
2. Text excerpts go directly to the configured OpenAI Responses model with `store=false` for classification and extraction. There is no redaction or pre-AI approval stage. Supported classes include trade licenses, contracts, ISO/CAP certificates, insurance, DPAs, regulatory licenses, vendor agreements, laboratory accreditation, IT/software agreements, and other compliance records.
3. The extractor returns quoted evidence for company, reference number, dates, parties, obligations, notice period, and required actions. Deterministic checks require quotes and valid dates. Conflicting chunks, unknown company/type, missing action date, missing owner, and unclear contract notice periods enter **Needs review**. Failed extraction appears in the same queue with an admin retry action.
4. Confident records create active tasks automatically. For a contract with a termination notice, the action date is expiry minus the notice period. Rules choose an owner by company and document type. Fallback is the uploader, an active Compliance department, then an active administrator with a Microsoft connection as the default compliance owner. If none exists, the record needs review. Tasks never activate without an owner. A reviewer can correct facts and choose an owner before activating tasks.
5. Default reminders occur 60 and 30 days before, weekly at 28/21/14/7 days, daily in the final week, and one day overdue to the owner's manager. Each rule can override the lead days. Group-owned tasks notify active department members; each member's manager receives overdue escalation. Delivery rechecks the recipient's SharePoint access. The owner receives an in-app notification. When `TEAMS_WEBHOOK_URL` is configured, the team channel receives a generic link to the permission-checked Compliance page; a successful Teams post marks that reminder delivered even when SMTP is unset. The webhook URL is a secret and must be set in `backend/.env` for local Docker or in the deployment secret store. Completing or superseding a task stops future reminders.
6. A verified newer document with the same company, type, and reference number and a later expiry supersedes older active tasks. Updates to the same SharePoint item archive the earlier extracted version before reanalysis. Audit events record detection, extraction, assignment, review, reminders, completion, and supersession.

AG Holding is the parent company for Agiomix, Litpeaks, and Precision Health in the company catalog. Agiomix also matches its legal name, **Agiomix FZ-LLC**. Company matching uses a unique case-insensitive name, slug, or configured alias; it does not guess from similar names. On startup and after an administrator creates or renames a company, saved documents waiting on a catalog match are checked again using their stored analysis. This does not call the AI API. Other review reasons still apply, and tasks activate only when an owner and action date are available.

**Group reminder assumption:** all active members of a responsible department receive reminders. Set a person as the rule owner when one designated lead should receive them.

## Access and data handling

Module permission and the ordinary session gate are required. SharePoint's live delegated document permissions are the document and company visibility boundary; an assignment does not grant access. Task completion also requires the task owner, an active member of the owning department, the owner's manager, or an administrator. Administrators still require SharePoint access to inspect or review a specific file. Email recipients must be active platform users with verified addresses, and delivery skips a recipient who cannot read the file.

The database contains raw extracted excerpts and facts, so protect it and its backups as sensitive data. OpenAI receives excerpts, not original file bytes. `store=false` is set on API requests; the organization's provider data controls still govern retention. Old encrypted redaction mappings remain readable for historical records, but new processing does not redact or create mappings. Large, encrypted, empty, malformed, or unsupported files can fail extraction and need an administrator retry after the source issue is fixed.

## Deployment configuration

The bundled Docker Compose stack passes the following settings to the backend. Set them in the deployment secret store or the Compose project environment **before** upgrading; a local `backend/.env` is not copied into the container.

- Core production boot: `ENVIRONMENT=production`, a unique `SECRET_KEY` of at least 32 characters, a nondefault `DEFAULT_ADMIN_PASSWORD`, a strong `POSTGRES_PASSWORD`, and the public HTTPS origin in `PUBLIC_BASE_URL` and `FRONTEND_BASE_URL`. Set `BACKEND_CORS_ORIGINS` to that origin. The configured `AZURE_REDIRECT_URI` must match the Entra app registration if Microsoft sign-in is used.
- SharePoint: `SHAREPOINT_ENABLED=true`, `SHAREPOINT_TENANT_ID`, `SHAREPOINT_CLIENT_ID`, `SHAREPOINT_CLIENT_SECRET`, `SHAREPOINT_SITE_ID`, `SHAREPOINT_DRIVE_ID`, `SHAREPOINT_FOLDER_ID`, and `SHAREPOINT_REDIRECT_URI=https://<public-origin>/api/sharepoint/callback`. Preserve the current `SHAREPOINT_ENCRYPTION_KEY` across deployments so saved connections remain readable. Set `SHAREPOINT_PREVIOUS_ENCRYPTION_KEYS` only during a planned key rotation.
- Analysis: `SHAREPOINT_OPENAI_API_KEY` and `SHAREPOINT_OPENAI_MODEL=gpt-6-luna`. Rebuild the backend image with `SHAREPOINT_ENABLED=true` so the optional SharePoint NLP dependency is installed. Tesseract English and Arabic OCR are installed in the backend image.
- Automation and testing channel: `SHAREPOINT_POLLING_ENABLED=true`, `SHAREPOINT_SYNC_INTERVAL_SECONDS=60`, `RUN_SCHEDULER=true`, and `TEAMS_WEBHOOK_URL` in the backend secret store. SMTP variables are optional while testing with Teams. `SHAREPOINT_REVIEWER_IDS` is optional for nonadministrator reviewers.

The in-process scheduler should run in one backend replica to avoid duplicate external deliveries. Confirm the Microsoft Graph app has the selected site's application and delegated read permissions, users have connected Microsoft accounts and module access, and owner rules or a connected fallback owner exist. After upgrade, test one upload, extraction, owner assignment, reminder, and manager escalation with authorized test accounts. Keep the original SharePoint file and any existing database backups during rollout.

### Migration preflight for the historical `i4d5e6f7a8b9` collision

An earlier branch used `i4d5e6f7a8b9` for both SharePoint Intelligence and ad sync. The current migration tree contains only `i4d5e6f7a8b9_sharepoint_intelligence.py`, and `i5e6f7a8b9c0` expects its SharePoint tables. Before upgrading an existing deployment, run these **read-only queries against that deployment's PostgreSQL database**:

```sql
SELECT version_num FROM alembic_version;
SELECT to_regclass('public.sharepoint_sources') AS sharepoint_sources,
       to_regclass('public.sharepoint_documents') AS sharepoint_documents;
```

If the database reports `i4d5e6f7a8b9` or a later revision but either SharePoint table is missing, stop the deployment and reconcile the actual schema and migration history with a database backup. The revision value alone cannot tell which of the two old `i4` files ran. Do not fix this by stamping a revision without applying the missing schema. A database still before `i4` is expected to lack these tables; the normal upgrade creates them.

## Verification

From `backend/`, run `python -m alembic heads` and `python -m pytest`. Test migrations on a disposable PostgreSQL database. From `frontend/`, run `npm run typecheck`, `npm run build`, `npm run doctor`, and `npx playwright test e2e/sharepoint.spec.ts e2e/compliance.spec.ts` against the local Vite server for desktop and Pixel 5.

These tests use synthetic documents and mocked Graph responses. Before relying on real alerts, upload test files to the configured folder and verify the live Graph sync, delegated access for users with different permissions, extracted dates, owner rules, Teams delivery, and manager escalation. A successful local OpenAI call confirms the configured model/key but does not prove tenant connectivity or outbound delivery.
