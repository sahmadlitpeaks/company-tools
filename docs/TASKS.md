# Tasks and assignment delivery

## Daily workflow

The Tasks page combines ordinary assigned work with active and completed SharePoint compliance actions. Managers start in **By member** view; employees start in **By status** view. Cards show the title, owner, department, deadline, progress, and assignment email state. Mobile filters expand on demand so task cards stay easy to reach. Search and filters cover owner, department, source, priority, and deadline. Open a card to read instructions, manage ordinary task checklists/comments, or inspect the original compliance document.

Create a task by choosing a department, then an active member of that department. The backend validates that membership. Assignment and reassignment create an in-app notification and a durable email delivery entry in the same transaction as the task. Saving other changes does not resend an assignment email. Recurring ordinary tasks create the next occurrence and notify its owner.

## Access and document actions

- Ordinary members can access tasks they created or are assigned.
- Managers additionally see tasks created by or assigned to their access department members and direct reports.
- Administrators see all ordinary tasks.
- Task details, mutations, checklist items, comments, and task attachments use the same access boundary.
- The page requires the Tasks module. Document actions additionally require SharePoint Intelligence and a connected Microsoft account with live access to the original. Department membership and assignment never grant SharePoint file access.
- SharePoint tasks use the existing department review/assignment boundary. A department manager may manage a member's assigned action and transfer it to a selected department or its active member, with an audit reason. Administrators and configured reviewers retain their authorized document scope.

The page reads compliance tasks through `GET /api/tasks/compliance`; it does not copy them into ordinary task records. `PATCH /api/sharepoint/compliance/tasks/{id}/progress` records To do, In progress, or Blocked with an audit event. Done uses the existing completion endpoint, so scheduled reminders stop. Reopening restores the existing compliance lifecycle and reminder scheduling.

## Assignment emails

Emails include the task title, instructions, due date, assignee, department, assigning person (or document automation), and a direct `/tasks?task=<id>` link. Document assignments also identify the document and company/entity. HTML values are escaped.

Configure the existing SMTP settings in the backend secret store. Configure `PUBLIC_BASE_URL` to the browser-facing workspace origin for direct links; `FRONTEND_BASE_URL` and the SharePoint redirect origin are fallbacks. Configure `RUN_SCHEDULER=true` in one backend replica for durable retries. Delivery runs immediately after a committed assignment and every 30 seconds in the scheduler, with up to five attempts and exponential delay. Tasks remain saved when email delivery fails.

Without SMTP configuration, entries remain queued. Delivery rechecks the current owner, active account, task completion, and muted task/compliance notification category. Stale assignments are cancelled. Document email delivery also rechecks live SharePoint access before including any document details. Assignment email delivery is independent of Teams webhook delivery and the generic outbound notification job.

**Email sent** means the SMTP service accepted delivery. Confirm the recipient's inbox separately during production acceptance; local automated tests use a fake sender and do not deliver real email. Failed entries show **Assignment email failed**; administrator intervention is required after five unsuccessful attempts. Pending entries survive clearing the related in-app notification.

## Schema and checks

Migration `p2f3a4b5c6d7` adds compliance progress and the durable `task_assignment_emails` table. Run the normal Alembic upgrade before serving the new code.

Focused backend coverage is in `test_task_assignment.py` and `test_sharepoint.py`. Desktop and Pixel 5 browser coverage is in `frontend/e2e/tasks.spec.ts`, including task creation, department filtering, manager cards, completion, transfer, deep links, checklist/comments, error handling, delete confirmation, accessibility, and overflow.
