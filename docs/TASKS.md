# Tasks and assignment delivery

## Daily workflow

The Tasks page combines ordinary assigned work with active and completed SharePoint compliance actions. Managers start in **By member** view; employees start in **By status** view. Cards show the title, owner, department, deadline, progress, and assignment email state. Mobile filters expand on demand so task cards stay easy to reach. Search and filters cover owner, department, source, priority, and deadline. Open a card to read instructions, manage ordinary task checklists/comments, or inspect the original compliance document.

In **By status**, drag cards using their handle between To do, In progress, Blocked, and Done. Mouse, touch, and keyboard are supported; the Status menu remains available. On a keyboard, press Space on the handle, use arrow keys to choose a column, then Space to save or Escape to cancel. Cards move after the API saves; errors preserve the server status. Read-only document notices cannot be dragged. Visible boards refresh every 15 seconds and on window focus, paused while editing, saving, or dragging. Managers and admins see employee changes through the same saved records.

Create a task by choosing a department, then an active member of that department. The backend validates that membership. Assignment and reassignment create an in-app notification and a durable email delivery entry in the same transaction as the task. Saving other changes does not resend an assignment email. Recurring ordinary tasks create the next occurrence and notify its owner.

## Access and document actions

- Ordinary members can access tasks they created or are assigned.
- Managers additionally see tasks created by or assigned to their access department members and direct reports.
- Administrators see all ordinary tasks.
- Task details, mutations, checklist items, comments, and task attachments use the same access boundary.
- The page requires the Tasks module. Assigned document workflow notices remain visible to their owner, department inbox recipients, responsible manager, admins, and configured reviewers even when Microsoft access is missing. These notices contain no document title, name, company, reference, date, ID, or URL. Document details and mutations additionally require SharePoint Intelligence and a connected Microsoft account with live access to the original. Department membership and assignment never grant SharePoint file access.
- SharePoint tasks use the existing department review/assignment boundary. A department manager may manage a member's assigned action and transfer it to a selected department or its active member, with an audit reason. Administrators and configured reviewers retain their authorized document scope.

The page loads local tasks independently and gets immediate assignment previews through GET /api/tasks/compliance?preview=true, with no Graph calls. Full details enrich only scoped task documents, deduplicate files, check up to four concurrently, and bound document checks to 12 seconds after token acquisition. Connection, permission, changed-version, and temporary failures retain a generic assignment with an actionable message. Date metrics explicitly exclude hidden deadlines. The page reads compliance tasks through `GET /api/tasks/compliance`; it does not copy them into ordinary task records. `PATCH /api/sharepoint/compliance/tasks/{id}/progress` records To do, In progress, or Blocked with an audit event. Done uses the existing completion endpoint, so scheduled reminders stop. Reopening restores the existing compliance lifecycle and reminder scheduling. The completion endpoint accepts optional work_status for an active task, so reopening into In progress or Blocked is one transaction. Completed work cannot reactivate without a valid owner.

## Assignment emails

Emails include the task title, instructions, due date, assignee, department, assigning person (or document automation), and a direct `/tasks?task=<id>` link. Emails also show task type, status, and priority. Document assignments identify document type, name, company/entity, reference, deadline basis, and document expiry when the recipient has module permission and live access. Otherwise a generic assignment email explains the access requirement and links to the saved task, without including document facts. HTML values are escaped.

Configure the existing SMTP settings in the backend secret store. Configure `PUBLIC_BASE_URL` to the browser-facing workspace origin for direct links; `FRONTEND_BASE_URL` and the SharePoint redirect origin are fallbacks. Configure `RUN_SCHEDULER=true` in one backend replica for durable retries. Delivery runs immediately after a committed assignment and every 30 seconds in the scheduler, with up to five attempts and exponential delay. Tasks remain saved when email delivery fails.

Without SMTP configuration, entries remain queued. Delivery rechecks the current owner, active account, task completion, and muted task/compliance notification category. Stale assignments are cancelled. Document email delivery also rechecks live SharePoint access before including any document details. Assignment email delivery is independent of Teams webhook delivery and the generic outbound notification job.

**Email sent** means the SMTP service accepted delivery. Confirm the recipient's inbox separately during production acceptance; local automated tests use a fake sender and do not deliver real email. Failed entries show **Assignment email failed**; after correcting email settings/address, open the document task and use **Retry assignment email**. POST /api/tasks/compliance/{id}/email/retry is scoped to authorized workflow viewers and current recipients, resets only each recipient's latest queued/failed entry, and rejects completed tasks. It cannot change the recipient or resend historical failures. Pending entries survive clearing the related in-app notification.

## Schema and checks

Migration `p2f3a4b5c6d7` adds compliance progress and the durable `task_assignment_emails` table. Run the normal Alembic upgrade before serving the new code.

Focused backend coverage is in `test_task_assignment.py` and `test_sharepoint.py`. Desktop and Pixel 5 browser coverage is in `frontend/e2e/tasks.spec.ts`, including task creation, department filtering, manager cards, completion, transfer, deep links, checklist/comments, error handling, delete confirmation, accessibility, and overflow.

## Account correction, deletion, and email diagnosis

Admins can correct **Official / login email** in Directory → Access. Addresses are trimmed, lowercased, validated, and checked for duplicates. The same employee ID and assignments are preserved. Use Reset password to issue new sign-in details after correcting an address; an old invitation is not automatically resent.

Directory → Delete offers permanent removal of unused local accounts. Confirmation requires the exact account email (or name if there is no email). The server authorizes admins, rejects self-deletion and externally synced accounts, locks the employee, rechecks linked business records, cleans personal preferences/notifications/connections, and records the employee's identity in the audit trail. Active and historical business records block deletion rather than being cascaded away. Resolve the listed links or disable the employee when history must be retained. Deleting the account invalidates its existing sessions.

Settings → Notifications shows missing SMTP environment variable names and provider configuration issues to admins only. **Check email connection** (POST /api/notifications/email/check) connects, negotiates STARTTLS, and checks configured login without sending mail. Results redact credentials and provider responses. A successful connection does not prove the sender is authorized or that mail reaches the inbox. Account invitations and dedicated assignment emails use SMTP independently of NOTIFY_OUTBOUND.

Additional backend regressions: test_employee_deletion.py, test_email_connection.py. Additional desktop/mobile flows: employee-delete.spec.ts, task-access-recovery.spec.ts. Live SharePoint, deployed SMTP, and inbox delivery require separate production acceptance.

## Enabling Compliance for another employee

An administrator opens **Directory → employee → Access**, ticks **SharePoint Intelligence**, and saves. Departments can also grant the module to their members. The employee opens Compliance and connects their Microsoft account; that account must separately have SharePoint permission to read the original files. Microsoft library access alone does not enable this workspace module. Earlier sent assignment notices are not automatically resent after enabling access; new authorized assignment emails include full details.

## Removing employees with Compliance history

Permanent local account deletion blocks on **Active Compliance tasks** for files still in scope and **Active Compliance owner rules**, with separate counts. Reassign active work; reassign, disable, or remove rules in Compliance → Governance. Deleting source files does not remove owner rules. After SharePoint sync confirms a file was deleted or left scope, legacy active work for that file is dismissed before its owner is cleared.

Reviews, approvals, sync requests, completed/suspended/dismissed tasks, and inactive rules do not block deletion. Their records remain; user references become null and Compliance events retain the former employee identity. Pending reminders for retired work stop. Other business safeguards and restrictions on self-deletion and synced Azure/BambooHR accounts still apply.

Deployment applies migration q3a4b5c6d7e8. It keeps exactly one owner mandatory on active rules and allows inactive rules to retain empty user references after account deletion. Downgrade refuses while such historical rules exist; reassign or explicitly remove them first.
