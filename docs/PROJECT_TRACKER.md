# Project tracker

A Jira-style tracker for development projects, under **My Work → Projects**
(`/projects`). It follows Jira's standard model instead of inventing custom
stages, so the team can move over from Jira without retraining.

## Model

```
Project (key LIMS)
 └─ Epic        LIMS-1   a requirement or module
     ├─ Story   LIMS-2
     │   └─ Sub-task LIMS-5
     ├─ Task    LIMS-3
     └─ Bug     LIMS-4
```

- **Project**: key (2–10 letters/digits, permanent), name, description, lead,
  start and target dates, active or archived.
- **Issue types**: Epic, Story, Task, Bug, Sub-task. Stories, tasks and bugs may
  belong to an epic; a sub-task must belong to a story, task or bug in the same
  project. An epic never has a parent.
- **Issue keys** are `<project key>-<number>`, allocated under a row lock so
  concurrent creates never share a number.
- **Fields**: summary, description, status, priority (Highest–Lowest), story
  points, labels, reporter, assignee, start date, due date, rank.
- **Workflow**: To Do → In Progress → In Review → Done. Moving to Done stamps
  `resolved_at`; moving out clears it.
- **People on an issue** use Jira's roles: the **reporter** is who asked for it
  (for example a stakeholder), the **assignee** is who is working on it, and
  **watchers** follow it. Creating, reporting, being assigned and commenting
  all add you as a watcher.
- **Links**: blocks / is blocked by / relates to, within the same project.
- **History**: every field change is recorded with who, when, old and new value.
- **Attachments** use the shared `attachments` table with entity type
  `pm_issue`.

## Access

The `projects` module opens the area (it is in the member defaults). Each
project is then visible only to its members and platform administrators.

| Project role | Can |
| --- | --- |
| Administrator | Edit the project, add/remove people and change roles, delete any issue, plus everything below |
| Member | Create, edit, move, link and delete their own issues; upload attachments |
| Viewer | Read everything and comment; watch issues. Intended for requesters and stakeholders |

- Only platform administrators create projects. The lead becomes a project
  administrator. A project always keeps at least one administrator.
- Assignees must be members or administrators; reporters and watchers may be
  any project role.
- Projects and issues a person cannot see return 404, not 403, so ids of other
  teams' work are not confirmed.
- Being a manager elsewhere in the platform grants nothing here, including on
  attachments.
- Archived projects stay readable but reject every change (409).
- Removing someone from a project also removes them as a watcher there.
- Departments with an explicit permission list do not gain the new `projects`
  module automatically; grant it in **Departments & Access** where needed.

## Notifications

In-app notifications (category `projects`) go to:

- the assignee when an issue is assigned to them;
- watchers when an issue changes status or gets a comment.

The person making the change is never notified about it. Email, Teams and Slack
copies follow the platform's `NOTIFY_OUTBOUND` setting and each person's muted
categories.

## API

All routes are under `/api/pm` and require the `projects` module.

| Method and path | Purpose |
| --- | --- |
| `GET/POST /projects` | List visible projects (`?status=active|archived|all`); create (admin) |
| `GET /projects/{id or key}`, `PATCH /projects/{id}` | Read; update or archive (project admin) |
| `GET/POST /projects/{id}/members`, `PATCH/DELETE /projects/{id}/members/{user}` | Project people |
| `GET /people` | Active people for project administrators to add |
| `GET/POST /projects/{id}/issues` | List (filters: `issue_type`, `status`, `assignee=me|none|<id>`, `parent_id`, `label`, `q`); create |
| `GET /issues/{id or KEY-N}` | Issue with children, links, watchers and the caller's role |
| `PATCH/DELETE /issues/{id}` | Update (records history); delete (sub-tasks go with it, an epic's issues stay) |
| `POST /issues/{id}/links`, `DELETE /links/{id}` | Issue links |
| `POST /issues/{id}/watchers`, `DELETE /issues/{id}/watchers/{user}` | Watch and unwatch |
| `GET/POST /issues/{id}/comments`, `PATCH/DELETE /comments/{id}` | Comments |
| `GET /issues/{id}/history` | Field change history, newest first |

## Frontend

- `pages/ProjectsPage.tsx`: project cards with progress; admins create projects.
- `pages/ProjectPage.tsx` (`/projects/:projectKey`): **Issues** (grouped by epic
  or as a list, with search and filters; table on desktop, cards on mobile),
  **People**, and **Settings** for project administrators.
- `components/pm/IssueDetail.tsx`: the issue side panel, opened with
  `?issue=KEY-N` so issue links can be shared and come from notifications.
- `components/pm/IssueForm.tsx`, `ProjectMembers.tsx`, `IssueBits.tsx`, and
  `api/pm.ts` for shared types and vocabulary.

## Not yet built

Planned next steps: sprints and backlog planning, a drag-and-drop board, the
timeline (Gantt), reports (burndown, velocity) and the team workload heat map.

## Checks

- Backend: `backend/tests/test_pm.py`.
- Migration `s5c6d7e8f9a0` (verified on PostgreSQL 16, including downgrade).
- Browser: `frontend/e2e/projects.spec.ts` (desktop and Pixel 5, with axe).
