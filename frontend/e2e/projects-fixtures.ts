import { expect, type Page } from "@playwright/test";
import { DEFAULT_CONFIG, defaultSettings } from "../src/api/pm-workspace";

const project = {
  id: "p1", key: "LIMS", name: "LIMS v3", description: "Lab information system", lead_id: "admin", lead_name: "Sara Admin",
  status: "active", start_date: "2026-10-01", target_date: "2026-12-31", created_at: "2026-10-01T08:00:00Z",
  issue_count: 3, done_count: 1, member_count: 3, sprints_enabled: true, overdue_count: 1, health: "at_risk",
};
const sprintBase = { project_id: "p1", goal: null, started_at: null, completed_at: null, committed_points: null, completed_points: null, done_points: 0 };
function sprints() {
  return [
    { ...sprintBase, id: "sp1", name: "LIMS Sprint 1", status: "active", start_date: "2026-10-05", end_date: "2026-10-19", goal: "Ship upload",
      started_at: "2026-10-05T08:00:00Z", committed_points: 5, issue_count: 2, done_count: 1, points: 5 },
    { ...sprintBase, id: "sp2", name: "LIMS Sprint 2", status: "future", start_date: null, end_date: null, issue_count: 0, done_count: 0, points: 0 },
  ];
}
const members = [
  { user_id: "admin", name: "Sara Admin", email: "sara@example.com", role: "admin" },
  { user_id: "dev", name: "Ali Dev", email: "ali@example.com", role: "member" },
  { user_id: "drt", name: "Dr T", email: "drt@example.com", role: "viewer" },
];
const base = {
  project_id: "p1", description: null, priority: "medium", story_points: null, labels: [], reporter_id: "drt", reporter_name: "Dr T",
  assignee_id: null, assignee_name: null, parent_id: null, parent: null, sprint_id: null, sprint_name: null, start_date: null, due_date: null, resolved_at: null,
  created_at: "2026-10-02T08:00:00Z", updated_at: "2026-10-02T08:00:00Z", child_count: 0, child_done: 0, comment_count: 0,
};
const epicRef = { id: "e1", key: "LIMS-1", summary: "AI file analysis", issue_type: "epic", status: "in_progress" };

function issues() {
  return [
    { ...base, id: "e1", key: "LIMS-1", number: 1, issue_type: "epic", summary: "AI file analysis", status: "in_progress", rank: 1, child_count: 2, child_done: 1 },
    { ...base, id: "s1", key: "LIMS-2", number: 2, issue_type: "story", summary: "Analyse uploaded PDFs", status: "todo", rank: 2,
      parent_id: "e1", parent: epicRef, story_points: 5, labels: ["ai"], assignee_id: "dev", assignee_name: "Ali Dev", start_date: "2026-10-06", due_date: "2026-10-16",
      sprint_id: "sp1", sprint_name: "LIMS Sprint 1" },
    { ...base, id: "b1", key: "LIMS-3", number: 3, issue_type: "bug", summary: "Upload fails over 20MB", status: "done", rank: 3, parent_id: "e1", parent: epicRef, priority: "high",
      sprint_id: "sp1", sprint_name: "LIMS Sprint 1", resolved_at: "2026-10-04T08:00:00Z" },
    { ...base, id: "t1", key: "LIMS-5", number: 5, issue_type: "task", summary: "Set up storage bucket", status: "todo", rank: 5, story_points: 2,
      start_date: "2026-10-12", due_date: "2026-10-14" },
  ];
}

export async function mount(page: Page, role: "admin" | "viewer", options: { archived?: boolean; closedIssue?: boolean; workspace?: boolean } = {}) {
  const userId = role === "admin" ? "admin" : "drt";
  let list = issues();
  if (options.closedIssue) list = list.map((item) => item.id === "s1"
    ? { ...item, status: "done", sprint_id: "closed1", sprint_name: "Completed sprint", resolved_at: "2026-10-08T08:00:00Z" } : item);
  const visibleProject = { ...project, ...(options.archived ? { status: "archived" } : {}) };
  const sprintList = sprints();
  let comments: Array<Record<string, unknown>> = options.archived ? [{ id: "archived-comment", issue_id: "s1",
    author_id: userId, author_name: "Sara Admin", body: "Archived evidence stays readable",
    created_at: "2026-10-08T08:00:00Z", updated_at: "2026-10-08T08:00:00Z" }] : [];
  let workspace = structuredClone(DEFAULT_CONFIG);
  if (options.workspace) {
    workspace.states.push({ key: "qa", name: "QA testing", category: "in_review", allowed_next: ["done"] });
    workspace.fields.push({ key: "customer", name: "Customer", kind: "text", required: false, options: [] });
    workspace.components.push({ key: "frontend", name: "Frontend", lead_id: "dev" });
    workspace.templates.push({ key: "bug", name: "Bug report", issue_type: "bug", description: "## Steps\n\n- [ ] Reproduce", priority: "high" });
  }
  let savedViews = options.workspace ? [{ id: "v1", project_id: "p1", owner_id: "admin", name: "Team board", visibility: "team", settings: defaultSettings(true), can_manage: role === "admin" }] : [];
  const requests: Array<{ method: string; path: string; body: unknown }> = [];
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    if (!path.startsWith("/api/")) return route.continue();
    const isJson = (request.headers()["content-type"] ?? "").includes("application/json");
    const body = request.postData() ? (isJson ? request.postDataJSON() : request.postData()) : null;
    if (method !== "GET") requests.push({ method, path, body });
    let json: unknown = [];
    if (path === "/api/auth/me") json = { id: userId, email: `${userId}@example.com`, display_name: role === "admin" ? "Sara Admin" : "Dr T", role: role === "admin" ? "admin" : "member",
      is_admin: role === "admin", is_active: true, status: "active", effective_permissions: ["projects"], managed_company_ids: [] };
    else if (path === "/api/settings/public") json = { platform_name: "AG Holding" };
    else if (path === "/api/notifications/unread-count") json = { count: 0 };
    else if (path === "/api/pm/projects") json = [{ ...visibleProject, my_role: role }];
    else if (path === "/api/pm/projects/LIMS") json = { ...visibleProject, my_role: role };
    else if (path === "/api/pm/projects/p1/configuration") {
      if (method === "PUT") workspace = body;
      json = workspace;
    }
    else if (path === "/api/pm/projects/p1/views") json = savedViews.filter((view) => view.project_id === "p1");
    else if (path === "/api/pm/views" && method === "GET") json = savedViews.filter((view) => !view.project_id);
    else if (path === "/api/pm/views" && method === "POST") {
      const saved = { ...body, id: `v${savedViews.length + 1}`, owner_id: userId, can_manage: true };
      savedViews = [...savedViews, saved]; json = saved;
    }
    else if (path.startsWith("/api/pm/views/") && method === "PATCH") {
      savedViews = savedViews.map((view) => view.id === path.split("/").pop() ? { ...view, ...body } : view);
      json = savedViews.find((view) => view.id === path.split("/").pop());
    }
    else if (path.startsWith("/api/pm/views/") && method === "DELETE") {
      savedViews = savedViews.filter((view) => view.id !== path.split("/").pop());
      return route.fulfill({ status: 204, body: "" });
    }
    else if (path === "/api/pm/issues/bulk") {
      list = list.map((item) => body.issue_ids.includes(item.id) ? { ...item, ...body.changes, ...(body.changes.workflow_state ? { status: workspace.states.find((state) => state.key === body.changes.workflow_state)!.category } : {}) } : item);
      json = { items: list.filter((item) => body.issue_ids.includes(item.id)), updated: body.issue_ids.length };
    }
    else if (path === "/api/pm/issues/page") {
      const params = new URL(request.url()).searchParams;
      const filtered = list.filter((item) => (!params.get("q") || item.summary.toLowerCase().includes(params.get("q")!.toLowerCase())) && (!params.get("issue_type") || item.issue_type === params.get("issue_type")) && (!params.get("assignee") || (params.get("assignee") === "me" ? item.assignee_id === userId : item.assignee_id === params.get("assignee"))) && (!params.get("workflow_state") || item.status === params.get("workflow_state")) && (!params.get("due_after") || item.due_date && item.due_date >= params.get("due_after")!) && (!params.get("due_before") || item.due_date && item.due_date <= params.get("due_before")!));
      json = { items: filtered, total: filtered.length, offset: 0, limit: 50 };
    }
    else if (path === "/api/pm/projects/p1/members") json = members;
    else if (path === "/api/pm/people") json = [{ id: "new", name: "Khalid", email: "khalid@example.com" }];
    else if (path === "/api/pm/projects/p1/issues" && method === "GET") json = list;
    else if (path === "/api/pm/projects/p1/sprints") json = sprintList;
    else if (path === "/api/pm/projects/p1/import/jira/preview") json = {
      total: 3, already_imported: 1, types: [{ name: "Story", count: 2, imported_as: "story" }, { name: "Improvement", count: 1, imported_as: "task" }],
      statuses: [{ name: "Code Review", count: 2, suggested: "in_review" }, { name: "Backlog", count: 1, suggested: "todo" }],
      people: [{ name: "Ali Dev", count: 2, suggested_user_id: "dev", suggested_name: "Ali Dev" }, { name: "Old Contractor", count: 1, suggested_user_id: null, suggested_name: null }],
      sprints: ["OLD Sprint 2"], comments: 4, links: 1, attachments: 2, warnings: ["Improvement will be imported as tasks."],
      sample: [{ key: "OLD-1", type: "story", summary: "Analyse PDFs", status: "Code Review" }],
    };
    else if (path === "/api/pm/projects/p1/shares" && method === "POST") json = { id: "sh2", view: body.view, label: body.label, state: "active",
      expires_at: "2026-11-07T08:00:00Z", revoked_at: null, created_at: "2026-10-08T08:00:00Z", created_by_name: "Sara Admin", view_count: 0, last_viewed_at: null,
      token: "tok-new", path: "/share/p/tok-new" };
    else if (path === "/api/pm/projects/p1/shares") json = [{ id: "sh1", view: "timeline", label: "For Dr T", state: "active", expires_at: "2026-10-30T08:00:00Z",
      revoked_at: null, created_at: "2026-10-01T08:00:00Z", created_by_name: "Sara Admin", view_count: 4, last_viewed_at: "2026-10-07T08:00:00Z" }];
    else if (path === "/api/pm/shares/sh1" && method === "DELETE") return route.fulfill({ status: 204, body: "" });
    else if (path === "/api/pm/projects/p1/import/jira") json = { created: 2, skipped: 1, comments: 4, links: 1, sprints_created: 1, members_added: 0, warnings: [], first_key: "LIMS-6" };
    else if (path === "/api/pm/projects/p1/links") json = [{ id: "l1", source_id: "s1", target_id: "t1", link_type: "blocks" }];
    else if (path === "/api/pm/projects/p1/reports/burndown") json = { sprint: { id: "sp1", name: "LIMS Sprint 1", status: "active", start_date: "2026-10-05", end_date: "2026-10-09" }, total_points: 8,
      days: [8, 8, 5, null, null].map((remaining, i) => ({ date: `2026-10-0${5 + i}`, ideal: 8 - i * 2, remaining })) };
    else if (path === "/api/pm/projects/p1/reports/velocity") json = { sprints: [{ id: "v1", name: "LIMS Sprint 0", committed: 13, completed: 10 }], average_completed: 10 };
    else if (path === "/api/pm/projects/p1/reports/workload") {
      const start = new URL(request.url()).searchParams.get("start")!;
      const weeks = Array.from({ length: 8 }, (_, i) => new Date(Date.parse(start) + i * 7 * 86_400_000).toISOString().slice(0, 10));
      json = { weeks, people: [
        { user_id: "dev", name: "Ali Dev", points: [2, 12, 5, 0, 0, 0, 0, 0], issues: [1, 3, 2, 0, 0, 0, 0, 0], unscheduled: 1 },
        { user_id: "drt", name: "Dr T", points: Array(8).fill(0), issues: Array(8).fill(0), unscheduled: 0 },
      ] };
    } else if (path === "/api/pm/projects/p1/reports/activity") json = { weeks: Array.from({ length: 12 }, (_, i) => new Date(Date.UTC(2026, 6, 13 + i * 7)).toISOString().slice(0, 10)),
      people: [{ user_id: "dev", name: "Ali Dev", counts: [0, 1, 2, 4, 0, 3, 5, 1, 0, 2, 6, 3] }], totals: [0, 1, 2, 4, 0, 3, 5, 1, 0, 2, 6, 3] };
    else if (path.startsWith("/api/pm/sprints/") && method === "POST") json = { ...sprintList.find((s) => path.includes(s.id)), status: path.endsWith("/complete") ? "closed" : "active" };
    else if (path === "/api/pm/projects/p1/issues" && method === "POST") {
      const created = { ...base, ...body, id: "n1", key: "LIMS-4", number: 4, rank: 4, parent: body.parent_id ? epicRef : null };
      list = [...list, created];
      json = created;
    } else if (path === "/api/pm/issues/LIMS-2" || path === "/api/pm/issues/LIMS-4") {
      const issue = list.find((item) => item.key === path.split("/").pop())!;
      json = { ...issue, project_key: "LIMS", project_name: "LIMS v3", my_role: role, watching: role === "viewer", children: [], links: [],
        watchers: [{ user_id: "drt", name: "Dr T" }, { user_id: "dev", name: "Ali Dev" }] };
    } else if (path.startsWith("/api/pm/issues/") && method === "PATCH") {
      const id = path.split("/").pop();
      // Match the API's closed-sprint transition. The browser sends a full
      // Edit payload; the server validates the actual sprint, not list loading.
      if (body.workflow_state) body.status = workspace.states.find((state) => state.key === body.workflow_state)!.category;
      const saved = options.closedIssue && body.sprint_id === "closed1" && body.status !== "done"
        ? { ...body, sprint_id: null } : body;
      list = list.map((item) => item.id === id ? { ...item, ...saved, ...("sprint_id" in saved ? { sprint_name: sprintList.find((s) => s.id === saved.sprint_id)?.name ?? null } : {}) } : item);
      json = list.find((item) => item.id === id);
    } else if (path.endsWith("/comments") && method === "POST") {
      const comment = { id: `c${comments.length}`, issue_id: "s1", author_id: userId, author_name: "Dr T", body: body.body,
        created_at: "2026-10-06T09:00:00Z", updated_at: "2026-10-06T09:00:00Z" };
      comments = [...comments, comment];
      json = comment;
    } else if (path.endsWith("/comments")) json = comments;
    else if (path.endsWith("/history")) json = [{ id: "h1", actor_id: "dev", actor_name: "Ali Dev", field: "status", old_value: "todo", new_value: "in_progress", created_at: "2026-10-03T08:00:00Z" }];
    else if (path.startsWith("/api/attachments/by/pm_issue/")) json = [];
    await route.fulfill({ json });
  });
  return requests;
}

export async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  // The app shell scrolls its own content, so also check no card is wider than the viewport.
  const wide = await page.evaluate(() => [...document.querySelectorAll('[data-slot="card"]')]
    .filter((card) => card.getBoundingClientRect().right > window.innerWidth + 1).length);
  expect(wide).toBe(0);
}

export async function selectProjectTab(page: Page, name: string) {
  if (page.viewportSize()!.width < 640) {
    await page.getByRole("combobox", { name: "Project view", exact: true }).click();
    await page.getByRole("option", { name, exact: true }).click();
  } else await page.getByRole("tab", { name, exact: true }).click();
}
