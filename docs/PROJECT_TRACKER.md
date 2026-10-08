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

## Sprints, backlog and board

Projects use sprints by default (Scrum). A project administrator can switch
them off in **Settings → Way of working** to run a plain Kanban board; that is
refused while a sprint is active.

- **Sprints** are `future`, `active` or `closed`. New sprints are numbered
  automatically (`LIMS Sprint 3`) unless named.
- Only stories, tasks and bugs go into sprints. Epics span sprints and
  sub-tasks follow their parent. Converting an issue to an epic or sub-task
  takes it out of its sprint.
- **Starting** needs start and end dates and records the committed story
  points. Only one sprint can be active per project; a partial unique index
  enforces this in the database too.
- **Completing** records the completed points, closes the sprint and moves
  unfinished issues to the backlog or a chosen future sprint. Each move is
  written to the issue's history. Closed sprints are read-only and can't
  receive issues; reopening a finished issue from a closed sprint returns it
  to the backlog.
- Deleting a sprint is only possible before it starts; its issues return to
  the backlog.
- **Backlog** (Scrum only): open sprints above the backlog. Members drag issues
  between sections and to reorder them (the issue's `rank`), or use each
  issue's **Move** menu, which also works by keyboard and on phones. Finished
  issues that are not in a sprint drop out of the backlog.
- **Board**: one column per status. Scrum boards show the active sprint's
  stories, tasks and bugs; Kanban boards show all of them, with Done limited to
  the last 14 days. Members drag cards (mouse anywhere on the card, touch and
  keyboard by the handle) to change status. "Only my issues" and search filter
  the board.
- Project administrators manage sprints; members plan and move issues;
  viewers see the board and backlog read-only.

## Timeline, reports and heat maps

- **Timeline** (Gantt): epics with their stories, tasks and bugs as bars. An
  epic without its own dates spans its issues (dashed outline) and fills as
  they finish. Members drag a bar to move it or its ends to change the start
  or due date; on a focused bar, arrow keys move it a day and Shift+arrows
  change the due date. "Blocks" links are drawn as arrows, red when the
  blocked issue starts before its blocker ends. A today line, sprint bands and
  Weeks/Months/Quarters zoom are included. It opens scrolled to today.
- **Projects timeline**: the Projects page's Timeline view shows every visible
  project from start to target date, filled by progress, with its health.
- **Project health** on each project: *Late* when the target date has passed
  with work still open, *At risk* when any issue is past its due date,
  otherwise *On track*.
- **Reports** tab:
  - *Sprint burndown* (Scrum): remaining story points per day against the
    ideal line, for the active sprint or any completed one. Scope is the
    sprint's issues, including unfinished work moved out when it closed; an
    issue burns on the day it was resolved.
  - *Velocity* (Scrum): committed vs completed points for recent sprints,
    using the snapshots taken at sprint start and completion.
  - *Team workload* heat map: story points (or issue count) per person per
    week. An issue's window is its start to due date, falling back to its
    sprint's dates; points spread evenly across the weeks it spans. Cells over
    the chosen weekly capacity are outlined with a warning icon. Issues with no
    dates are counted per person as "without dates".
  - *Activity* heat map: issues created, fields changed and comments written
    per person per week over the last 12 weeks, with a whole-team row.
- Charts use the single-hue `--chart-1…5` ramp; numbers inside filled cells
  use the `--chart-ink` tokens. Every chart has a legend, hover/focus details,
  and a data table or numeric cells, so nothing depends on colour alone.

## Import from Jira

Project administrators import a Jira CSV export from **Settings → Import from
Jira**. In Jira, open the issues to move (for example a project filter) and use
**Export → CSV (all fields)**. A CSV export was chosen over Jira's API so no
Jira credentials are stored and the server needs no access to Atlassian.

1. **Preview** parses the file and writes nothing. It lists issue types,
   comments, links and attachments found, issues already imported, and
   proposes a mapping for each Jira status (Done/Closed → Done, Review/QA/Test →
   In Review, Progress/Develop → In Progress, otherwise To Do) and each Jira
   person (matched by display name or email to an active account).
2. **Import** re-sends the file with the confirmed mappings and creates, in one
   transaction:
   - issues with type, summary, description, priority (Blocker/Critical →
     Highest, Major → High, Minor → Low, Trivial → Lowest), story points,
     labels, due date and the original created and resolved times;
   - the hierarchy: stories, tasks and bugs under their epic (Epic Link or
     Parent column), sub-tasks under their parent; a sub-task whose parent
     isn't in the file becomes a task; other types (Improvement, New Feature…)
     become tasks;
   - comments with their mapped author and original time, or the Jira name in
     the text when the author isn't mapped;
   - Blocks and Relates links between issues in the file or imported earlier;
   - unfinished stories, tasks and bugs in a sprint go into a future sprint of
     the same name (Scrum projects only).

Each issue keeps its Jira key (`external_key`, shown as "Jira key" on the issue
and unique per project), so importing the same or an overlapping export again
skips issues already there. New issue numbers are given parents first. Mapped
people can be added to the project automatically (assignees as members,
reporters as viewers); otherwise unmapped or non-member people are named in the
description. Attachments aren't in a CSV export; the preview counts them. Files
are limited to 10 MB and 5,000 issues.

## Share links

Project administrators create read-only links under **Settings → Share links**
for people without an account (for example requesters or management outside
the platform). Each link shows one view:

- **Board**: the active sprint's board (or current work on a Kanban project).
- **Timeline**: epics and their stories, tasks and bugs on the Gantt chart.
- **Progress**: health, status totals, epic progress, sprint burndown and
  velocity.

Links expire after 7, 30 or 90 days, or never, and can be revoked at any time;
each records its view count and last view. Only the SHA-256 of the token is
stored (the same approach as secure transfers and API tokens), so the full link
is shown once, when created.

The public page (`/share/p/<token>`, API `GET /api/public/pm-shares/<token>`)
needs no sign-in and exposes only issue keys, summaries, types, statuses,
priorities, story points, assignee names, sprint and dates. Descriptions,
comments, attachments, reporters, labels and email addresses never leave the
server, and nothing on the page links into the platform. Unknown, expired and
revoked links get the same "not available" answer; switching the Projects module
off org-wide disables every link. Responses are `no-store` and `noindex`, and the
page sets `no-referrer` so the link isn't passed on to other sites.

## AI access (MCP)

AI assistants (Claude, ChatGPT and other MCP clients) can read and update the
tracker through an MCP server at **`/api/mcp/`** (also served at `/api/mcp`
without the slash, rather than redirecting, because some clients drop headers on
redirects). It uses the Streamable HTTP transport in stateless JSON mode via the
official `mcp` Python SDK, mounted inside the backend, so no extra service or
proxy rule is needed. The session manager starts and stops with the app.

**Tokens.** Each person creates personal access tokens under **My Work → AI
Access** (`/ai-access`). Tokens start with `pmt_`, are shown once (only the
SHA-256 is stored), expire after 30–365 days and can be revoked; the page shows
ready-to-paste setup for Claude Code and a generic MCP JSON config. Platform
administrators see and can revoke every token. Clients send
`Authorization: Bearer pmt_...`; missing, unknown, expired or revoked tokens,
inactive accounts and accounts without the Projects module (including when it is
switched off org-wide) get `401`.

**Read vs write.** Tokens are read-only unless created with "Allow changes",
which requires the **Projects: AI write access** permission
(`projects_ai_write`). Grant it to named people or departments in **Departments &
Access**; it is not in member or manager defaults. The permission is checked
again on every write call, so removing it stops existing write tokens at once.

**Tools.** The assistant acts as the token's owner, sees only their projects and
is limited by their project role; every tool calls the same handlers as the web
app, so validation, history, notifications and watchers behave identically.

| Tool | Access | Purpose |
| --- | --- | --- |
| `tracker_list_projects` | read | Visible projects with role, health and progress |
| `tracker_get_project_summary` | read | Status counts, active sprint, overdue issues, epic progress |
| `tracker_search_issues` | read | Search by text/key, status, type, assignee (`me`, `none`, email) or sprint; paged |
| `tracker_get_issue` | read | Description, people, labels, children, links and the last 20 comments |
| `tracker_create_issue` | write | Create an issue (parent/epic, assignee by email, points, dates, active sprint) |
| `tracker_update_issue` | write | Change only the fields given |
| `tracker_move_issue` | write | Change status |
| `tracker_add_comment` | write | Comment as the token's owner |

Read tools are annotated `readOnlyHint`; nothing deletes. Errors explain what to
do next (for example "This token is read-only…").

**Data protection.** Whatever a tool returns is sent to the assistant's provider,
including descriptions and comments. Only grant tokens for assistants the
organisation has approved; the AI Access page says so, and administrators can
review and revoke tokens. Clients that only support OAuth sign-in (some web
connectors) can't use personal tokens yet.

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
| `GET/POST /projects/{id}/issues` | List (filters: `issue_type`, `status`, `assignee=me|none|<id>`, `parent_id`, `sprint=backlog|active|<id>`, `label`, `q`); create |
| `GET /issues/{id or KEY-N}` | Issue with children, links, watchers and the caller's role |
| `PATCH/DELETE /issues/{id}` | Update (records history); delete (sub-tasks go with it, an epic's issues stay) |
| `POST /issues/{id}/links`, `DELETE /links/{id}` | Issue links |
| `POST /issues/{id}/watchers`, `DELETE /issues/{id}/watchers/{user}` | Watch and unwatch |
| `GET/POST /issues/{id}/comments`, `PATCH/DELETE /comments/{id}` | Comments |
| `GET /issues/{id}/history` | Field change history, newest first |
| `GET/POST /projects/{id}/sprints` | List (`?state=open|closed|all`); create (project admin) |
| `PATCH/DELETE /sprints/{id}` | Edit an open sprint; delete a future sprint |
| `POST /sprints/{id}/start`, `POST /sprints/{id}/complete` | Start with dates; complete with `move_to` (`backlog` or a future sprint id) |
| `GET /projects/{id}/links` | Every issue link in the project (timeline dependencies) |
| `GET /projects/{id}/reports/burndown` | `?sprint_id=`; defaults to the active, else latest completed, sprint |
| `GET /projects/{id}/reports/velocity` | Recent closed sprints (`?limit=`, default 7) |
| `GET /projects/{id}/reports/workload` | `?start=YYYY-MM-DD&weeks=8` (1–26) |
| `GET /projects/{id}/reports/activity` | `?weeks=12` (1–26) |
| `POST /projects/{id}/import/jira/preview` | Multipart `file`; project admin; writes nothing |
| `POST /projects/{id}/import/jira` | Multipart `file` + `mapping` JSON (`statuses`, `people`, `add_members`) |
| `GET/POST /projects/{id}/shares` | List share links; create one (`view`, `label`, `expires_in_days`, 0 = never); project admin |
| `DELETE /shares/{id}` | Revoke a share link |
| `GET /api/public/pm-shares/{token}` | Public, no sign-in: the shared view's minimal payload |
| `GET /ai/status`, `GET/POST /ai/tokens`, `DELETE /ai/tokens/{id}` | AI access tokens for the signed-in person |
| `GET /ai/tokens/all` | Every token (platform admins) |
| `POST /api/mcp/` | MCP endpoint (Bearer personal token) |

## Frontend

- `pages/ProjectsPage.tsx`: project cards with progress; admins create projects.
- `pages/ProjectPage.tsx` (`/projects/:projectKey`): **Board** (default),
  **Backlog** (Scrum projects), **Issues** (grouped by epic or as a list, with
  search and filters; table on desktop, cards on mobile), **People**, and
  **Settings** for project administrators.
- `components/pm/IssueBoard.tsx`, `Backlog.tsx` and `SprintDialogs.tsx`: the
  drag-and-drop board, backlog planning and sprint create/edit/start/complete.
- `components/pm/Timeline.tsx` (with shared `buildScale`/`TimeAxis`/`TimeGrid`),
  `ProjectsTimeline.tsx`, `Reports.tsx` and `Charts.tsx`: the Gantt views,
  reports and heat maps. Report endpoints live in `app/api/pm_reports.py`.
- `components/pm/JiraImport.tsx`: the Jira import preview, mapping and result;
  backend in `app/api/pm_import.py` and `app/services/jira_import.py`.
- `pages/AiAccessPage.tsx`: AI access tokens and setup; backend in
  `app/api/pm_tokens.py` and `app/api/pm_mcp.py`.
- `components/pm/ShareLinks.tsx` and `pages/public/PublicProjectSharePage.tsx`:
  share link management and the public read-only page (the board and timeline
  have read-only modes); backend in `app/api/pm_share.py`.
- `components/pm/IssueDetail.tsx`: the issue side panel, opened with
  `?issue=KEY-N` so issue links can be shared and come from notifications.
- `components/pm/IssueForm.tsx`, `ProjectMembers.tsx`, `IssueBits.tsx`, and
  `api/pm.ts` for shared types and vocabulary.

## Not yet built

Possible next steps from the original requirements: Microsoft Teams
notifications, and OAuth sign-in for MCP clients that require it.

## Checks

- Backend: `backend/tests/test_pm.py`.
- Migrations `s6d7e8f9a0b1`, `t6d7e8f9a0b1`, `u7e8f9a0b1c2`, `v8f9a0b1c2d3` and
  `w9a0b1c2d3e4` (verified on PostgreSQL 16, including downgrade).
- Jira import: `backend/tests/test_pm_import.py`; share links:
  `backend/tests/test_pm_share.py`; AI access over MCP:
  `backend/tests/test_pm_mcp.py` (also exercised end to end with the official
  MCP client against uvicorn and PostgreSQL); browser:
  `frontend/e2e/ai-access.spec.ts`.
- Browser: `frontend/e2e/projects.spec.ts` (desktop and Pixel 5, with axe).
