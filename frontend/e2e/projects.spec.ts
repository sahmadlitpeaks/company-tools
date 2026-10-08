import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

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

async function mount(page: Page, role: "admin" | "viewer") {
  const userId = role === "admin" ? "admin" : "drt";
  let list = issues();
  const sprintList = sprints();
  let comments: Array<Record<string, unknown>> = [];
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
    else if (path === "/api/pm/projects") json = [{ ...project, my_role: role }];
    else if (path === "/api/pm/projects/LIMS") json = { ...project, my_role: role };
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
      list = list.map((item) => item.id === id ? { ...item, ...body, ...("sprint_id" in body ? { sprint_name: sprintList.find((s) => s.id === body.sprint_id)?.name ?? null } : {}) } : item);
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

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  // The app shell scrolls its own content, so also check no card is wider than the viewport.
  const wide = await page.evaluate(() => [...document.querySelectorAll('[data-slot="card"]')]
    .filter((card) => card.getBoundingClientRect().right > window.innerWidth + 1).length);
  expect(wide).toBe(0);
}

test("project list leads to issues grouped by epic, and an issue opens in a panel", async ({ page }) => {
  const requests = await mount(page, "admin");
  await page.goto("/projects");
  await expect(page.getByRole("heading", { name: "Projects", level: 1 })).toBeVisible();
  await page.getByRole("link", { name: "LIMS v3" }).click();
  await expect(page.getByRole("heading", { name: "LIMS v3", level: 1 })).toBeVisible();
  await page.getByRole("tab", { name: "Issues" }).click();

  const epic = page.getByRole("region", { name: "Epic LIMS-1" });
  await expect(epic.getByText("AI file analysis")).toBeVisible();
  await expect(epic.getByText("1/2 done")).toBeVisible();
  await expect(page.getByRole("region", { name: "Issues" }).getByRole("link", { name: "Set up storage bucket" })).toBeVisible();
  await expect(epic.getByRole("link", { name: "Analyse uploaded PDFs" })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await noOverflow(page);
  await page.screenshot({ path: `test-results/project-list-${page.viewportSize()!.width}.png`, fullPage: true });

  await epic.getByRole("link", { name: "Analyse uploaded PDFs" }).click();
  await expect(page).toHaveURL(/\?issue=LIMS-2$/);
  const panel = page.getByRole("dialog");
  await expect(panel.getByText("LIMS-1")).toBeVisible();
  await expect(panel.getByText("Ali Dev").first()).toBeVisible();
  await panel.getByRole("combobox", { name: "Status" }).click();
  await page.getByRole("option", { name: "In Review" }).click();
  await expect.poll(() => requests.find((r) => r.method === "PATCH")).toEqual({ method: "PATCH", path: "/api/pm/issues/s1", body: { status: "in_review" } });
  await panel.getByRole("tab", { name: "History" }).click();
  await expect(panel.getByText("Ali Dev changed status from To Do to In Progress")).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: `test-results/project-issue-${page.viewportSize()!.width}.png` });
});

test("members create issues under an epic with Jira fields", async ({ page }) => {
  const requests = await mount(page, "admin");
  await page.goto("/projects/LIMS");
  await page.getByRole("button", { name: "Create issue" }).click();
  const dialog = page.getByRole("dialog", { name: "Create issue" });
  await dialog.getByRole("combobox", { name: "Issue type" }).click();
  await page.getByRole("option", { name: "Story", exact: true }).click();
  await dialog.getByRole("combobox", { name: "Epic" }).click();
  await page.getByRole("option", { name: "LIMS-1 AI file analysis" }).click();
  await dialog.getByLabel("Summary").fill("Export reports to PDF");
  await dialog.getByLabel("Story points").fill("3");
  await dialog.getByLabel("Labels").fill("reporting, pdf");
  await dialog.getByRole("combobox", { name: "Assignee" }).click();
  await page.getByRole("option", { name: "Ali Dev" }).click();
  await dialog.getByRole("button", { name: "Create" }).click();
  await expect(page).toHaveURL(/\?issue=LIMS-4$/);
  const post = requests.find((r) => r.method === "POST");
  expect(post?.body).toMatchObject({
    issue_type: "story", summary: "Export reports to PDF", parent_id: "e1", story_points: 3,
    labels: ["reporting", "pdf"], assignee_id: "dev", status: "todo", priority: "medium",
  });
  await noOverflow(page);
});

test("viewers read and comment but cannot change issues", async ({ page }) => {
  const requests = await mount(page, "viewer");
  await page.goto("/projects/LIMS?issue=LIMS-2");
  await expect(page.getByRole("button", { name: "Create issue" })).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "Settings" })).toHaveCount(0);
  const panel = page.getByRole("dialog");
  await expect(panel.getByRole("combobox", { name: "Status" })).toBeDisabled();
  await expect(panel.getByRole("button", { name: "Edit" })).toHaveCount(0);
  await expect(panel.getByRole("button", { name: "+ Attach file" })).toHaveCount(0);
  await expect(panel.getByRole("button", { name: "Stop watching" })).toBeVisible();
  await panel.getByLabel("Add a comment").fill("Please include the lab logo.");
  await panel.getByRole("button", { name: "Comment" }).click();
  await expect(panel.getByText("Please include the lab logo.")).toBeVisible();
  expect(requests).toEqual([{ method: "POST", path: "/api/pm/issues/s1/comments", body: { body: "Please include the lab logo." } }]);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await noOverflow(page);
});

test("the board shows the active sprint and moves issues with the keyboard", async ({ page }) => {
  const requests = await mount(page, "admin");
  await page.goto("/projects/LIMS");
  await expect(page.getByText("Goal: Ship upload")).toBeVisible();
  const todo = page.getByRole("region", { name: "To Do column" });
  await expect(todo.getByRole("link", { name: "Analyse uploaded PDFs" })).toBeVisible();
  // Backlog work stays off the sprint board.
  await expect(page.getByRole("link", { name: "Set up storage bucket" })).toHaveCount(0);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await noOverflow(page);
  await page.screenshot({ path: `test-results/project-board-${page.viewportSize()!.width}.png`, fullPage: true });

  const handle = page.getByRole("button", { name: "Move issue: LIMS-2" });
  await handle.focus();
  await page.keyboard.press("Space");
  await expect(page.getByText("Over To Do.", { exact: true })).toBeAttached();
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.keyboard.press(page.viewportSize()!.width < 768 ? "ArrowDown" : "ArrowRight");
  await expect(page.getByText("Over In Progress.", { exact: true })).toBeAttached();
  await page.keyboard.press("Space");
  await expect(page.getByRole("region", { name: "In Progress column" }).getByRole("link", { name: "Analyse uploaded PDFs" })).toBeVisible();
  expect(requests).toEqual([{ method: "PATCH", path: "/api/pm/issues/s1", body: { status: "in_progress" } }]);
});

test("the backlog plans issues into sprints and completes the active sprint", async ({ page }) => {
  const requests = await mount(page, "admin");
  await page.goto("/projects/LIMS");
  await page.getByRole("tab", { name: "Backlog" }).click();
  const backlog = page.getByRole("region", { name: "Backlog", exact: true });
  await expect(backlog.getByRole("link", { name: "Set up storage bucket" })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await noOverflow(page);
  await page.screenshot({ path: `test-results/project-backlog-${page.viewportSize()!.width}.png`, fullPage: true });

  await backlog.getByRole("button", { name: "Move LIMS-5" }).click();
  await page.getByRole("menuitem", { name: "LIMS Sprint 2" }).click();
  await expect(page.getByRole("region", { name: "LIMS Sprint 2" }).getByRole("link", { name: "Set up storage bucket" })).toBeVisible();
  const patch = requests.find((r) => r.method === "PATCH");
  expect(patch).toMatchObject({ path: "/api/pm/issues/t1", body: { sprint_id: "sp2" } });
  expect(typeof (patch!.body as { rank: number }).rank).toBe("number");

  await page.getByRole("region", { name: "LIMS Sprint 1" }).getByRole("button", { name: "Complete sprint" }).click();
  const dialog = page.getByRole("dialog", { name: "Complete LIMS Sprint 1" });
  await dialog.getByRole("combobox", { name: "Move unfinished issues to" }).click();
  await page.getByRole("option", { name: "LIMS Sprint 2" }).click();
  await dialog.getByRole("button", { name: "Complete sprint" }).click();
  await expect(dialog).toBeHidden();
  expect(requests.at(-1)).toEqual({ method: "POST", path: "/api/pm/sprints/sp1/complete", body: { move_to: "sp2" } });
});

test("viewers see the board and backlog without planning controls", async ({ page }) => {
  await mount(page, "viewer");
  await page.goto("/projects/LIMS");
  await expect(page.getByRole("region", { name: "To Do column" }).getByRole("link", { name: "Analyse uploaded PDFs" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Move issue:/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Complete sprint" })).toHaveCount(0);
  await page.getByRole("tab", { name: "Backlog" }).click();
  await expect(page.getByRole("region", { name: "Backlog", exact: true }).getByRole("link", { name: "Set up storage bucket" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Move LIMS-/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Create sprint" })).toHaveCount(0);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("the timeline shows epics, issues and dependencies and reschedules by keyboard", async ({ page }) => {
  const requests = await mount(page, "admin");
  await page.goto("/projects/LIMS");
  await page.getByRole("tab", { name: "Timeline" }).click();
  // The epic has no dates of its own, so it spans its issues.
  await expect(page.getByRole("button", { name: /^LIMS-1 AI file analysis: 6 Oct to 16 Oct 2026, In Progress, 50% done, dates from its issues/ })).toBeVisible();
  const bar = page.getByRole("button", { name: /^LIMS-2 Analyse uploaded PDFs: 6 Oct to 16 Oct 2026/ });
  await expect(bar).toBeVisible();
  // LIMS-2 blocks LIMS-5, which is scheduled to start before LIMS-2 ends.
  await expect(page.getByText("Starts before its blocker ends")).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await noOverflow(page);
  await page.screenshot({ path: `test-results/project-timeline-${page.viewportSize()!.width}.png`, fullPage: true });

  await bar.focus();
  await page.keyboard.press("ArrowRight");
  await expect.poll(() => requests.find((r) => r.method === "PATCH")).toEqual({ method: "PATCH", path: "/api/pm/issues/s1", body: { start_date: "2026-10-07", due_date: "2026-10-17" } });
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\?issue=LIMS-2$/);
});

test("reports show burndown, velocity and workload and activity heat maps", async ({ page }) => {
  await mount(page, "viewer");
  await page.goto("/projects/LIMS");
  await page.getByRole("tab", { name: "Reports" }).click();
  await expect(page.getByRole("img", { name: "Burndown: 8 points committed, 5 remaining" })).toBeVisible();
  await expect(page.getByRole("img", { name: /^Velocity over 1 sprints, average 10 points/ })).toBeVisible();
  const overloaded = page.getByRole("cell", { name: /^Ali Dev, week of .*: 12, over capacity$/ });
  await expect(overloaded).toBeVisible();
  await expect(page.getByText("1 without dates")).toBeVisible();
  await page.getByRole("button", { name: "Show data table" }).first().click();
  await expect(page.getByRole("table", { name: "Burndown data" })).toBeVisible();
  await page.getByRole("button", { name: "Issues", exact: true }).click();
  await expect(page.getByRole("table", { name: "Workload in issues per person per week" }).getByRole("cell", { name: /^Ali Dev, week of .*: 3$/ })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await noOverflow(page);
  await page.screenshot({ path: `test-results/project-reports-${page.viewportSize()!.width}.png`, fullPage: true });
});

test("the projects page shows health and a cross-project timeline", async ({ page }) => {
  await mount(page, "viewer");
  await page.goto("/projects");
  await expect(page.getByText("At risk: 1 overdue issue")).toBeVisible();
  await page.getByRole("button", { name: "Timeline", exact: true }).click();
  await expect(page.getByRole("link", { name: /^LIMS v3: 1 Oct 2026 to 31 Dec 2026, 33% done, At risk$/ })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await noOverflow(page);
});

test("project admins preview a Jira export, adjust mappings and import it", async ({ page }) => {
  const requests = await mount(page, "admin");
  await page.goto("/projects/LIMS");
  await page.getByRole("tab", { name: "Settings" }).click();
  await page.getByLabel("Jira CSV export").setInputFiles({ name: "jira.csv", mimeType: "text/csv", buffer: Buffer.from("Summary,Issue key,Issue Type\nA,OLD-1,Story\n") });
  await page.getByRole("button", { name: "Preview" }).click();
  await expect(page.getByText("Improvement will be imported as tasks.")).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Status for Jira Code Review" })).toContainText("In Review");
  await expect(page.getByRole("combobox", { name: "Person for Jira Ali Dev" })).toContainText("Ali Dev");
  await page.getByRole("combobox", { name: "Status for Jira Code Review" }).click();
  await page.getByRole("option", { name: "Done" }).click();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await noOverflow(page);
  await page.screenshot({ path: `test-results/project-jira-import-${page.viewportSize()!.width}.png`, fullPage: true });

  await page.getByRole("button", { name: "Import 2 issues" }).click();
  await expect(page.getByText("Imported 2 issues")).toBeVisible();
  await expect(page.getByRole("link", { name: "Open LIMS-6" })).toBeVisible();
  const upload = requests.find((r) => r.path === "/api/pm/projects/p1/import/jira");
  expect(String(upload?.body)).toContain('{"statuses":{"Code Review":"done","Backlog":"todo"},"people":{"Ali Dev":"dev","Old Contractor":null},"add_members":true}');
});

test("project admins create, copy and revoke read-only share links", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const requests = await mount(page, "admin");
  await page.goto("/projects/LIMS");
  await page.getByRole("tab", { name: "Settings" }).click();
  const card = page.locator('[data-slot="card"]', { has: page.getByText("Share links", { exact: true }) });
  await expect(card.getByText("For Dr T")).toBeVisible();
  await expect(card.getByText(/4 views/)).toBeVisible();
  await card.getByRole("combobox", { name: "View" }).click();
  await page.getByRole("option", { name: "Progress" }).click();
  await card.getByLabel("Note (optional)").fill("Monthly update");
  await card.getByRole("button", { name: "Create link" }).click();
  const link = card.getByRole("textbox", { name: "New share link" });
  await expect(link).toHaveValue(/\/share\/p\/tok-new$/);
  expect(requests.find((r) => r.path === "/api/pm/projects/p1/shares")?.body).toEqual({ view: "progress", label: "Monthly update", expires_in_days: 30 });
  await card.getByRole("button", { name: "Copy link" }).click();
  await expect(card.getByText("Copied")).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await noOverflow(page);

  await card.getByRole("button", { name: "Revoke" }).click();
  await page.getByRole("button", { name: "Revoke link" }).click();
  await expect.poll(() => requests.some((r) => r.method === "DELETE" && r.path === "/api/pm/shares/sh1")).toBe(true);
});

const shared = {
  label: "Monthly update", expires_at: "2026-11-07T08:00:00Z", generated_at: "2026-10-08T08:00:00Z",
  project: { key: "LIMS", name: "LIMS v3", status: "active", sprints_enabled: true, start_date: "2026-10-01", target_date: "2026-12-31",
    issue_count: 3, done_count: 1, overdue_count: 1, health: "at_risk" },
};
const sharedIssue = { id: "s1", key: "LIMS-2", number: 2, issue_type: "story", summary: "Analyse uploaded PDFs", status: "in_progress", priority: "high",
  story_points: 5, assignee_name: "Ali Dev", parent_id: "e1", parent: { id: "e1", key: "LIMS-1", summary: "AI file analysis", issue_type: "epic", status: "in_progress" },
  sprint_id: "sp1", start_date: "2026-10-06", due_date: "2026-10-16", resolved_at: null, rank: 2, child_count: 0, child_done: 0 };

async function mountPublic(page: Page) {
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/public/pm-shares/board-token") return route.fulfill({ json: { ...shared, view: "board",
      board: { sprint: { id: "sp1", name: "LIMS Sprint 1", goal: "Ship upload", status: "active", start_date: "2026-10-05", end_date: "2026-10-19" }, issues: [sharedIssue] } } });
    if (path === "/api/public/pm-shares/progress-token") return route.fulfill({ json: { ...shared, view: "progress", progress: {
      counts: { todo: 1, in_progress: 1, in_review: 0, done: 1 },
      epics: [{ key: "LIMS-1", summary: "AI file analysis", status: "in_progress", issue_count: 2, done_count: 1, due_date: null }],
      burndown: { sprint: { id: "sp1", name: "LIMS Sprint 1", status: "active", start_date: "2026-10-05", end_date: "2026-10-09" }, total_points: 8,
        days: [8, 5, null].map((remaining, i) => ({ date: `2026-10-0${5 + i}`, ideal: 8 - i * 4, remaining })) },
      velocity: { sprints: [], average_completed: 0 } } } });
    if (path.startsWith("/api/public/pm-shares/")) return route.fulfill({ status: 404, json: { detail: "This link isn't available. It may have expired or been revoked." } });
    if (path === "/api/settings/public") return route.fulfill({ json: { platform_name: "AG Holding" } });
    return route.fulfill({ status: 401, json: { detail: "Not authenticated" } });
  });
}

test("a share link shows a read-only board without signing in", async ({ page }) => {
  await mountPublic(page);
  await page.goto("/share/p/board-token");
  await expect(page.getByRole("heading", { name: "LIMS v3", level: 1 })).toBeVisible();
  await expect(page.getByText("Read-only board view")).toBeVisible();
  await expect(page.getByText("At risk: 1 overdue issue")).toBeVisible();
  const card = page.getByRole("region", { name: "In Progress column" }).getByRole("article", { name: "LIMS-2 Analyse uploaded PDFs" });
  await expect(card).toBeVisible();
  // Nothing on a shared board opens issues or moves them.
  await expect(page.getByRole("link")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Move issue/ })).toHaveCount(0);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, nofollow");
  await expect(page.locator('meta[name="referrer"]')).toHaveAttribute("content", "no-referrer");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await noOverflow(page);
  await page.screenshot({ path: `test-results/share-board-${page.viewportSize()!.width}.png`, fullPage: true });
});

test("a progress share link shows status, epics and burndown; a bad link explains itself", async ({ page }) => {
  await mountPublic(page);
  await page.goto("/share/p/progress-token");
  await expect(page.getByText("Read-only progress view")).toBeVisible();
  await expect(page.getByRole("img", { name: "Burndown: 8 points committed, 5 remaining" })).toBeVisible();
  await expect(page.getByRole("progressbar", { name: "LIMS-1 50% done" })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await noOverflow(page);

  await page.goto("/share/p/revoked-token");
  await expect(page.getByText("This link isn't available")).toBeVisible();
  await expect(page.getByRole("button", { name: /retry/i })).toHaveCount(0);
});
