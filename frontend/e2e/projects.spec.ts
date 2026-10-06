import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const project = {
  id: "p1", key: "LIMS", name: "LIMS v3", description: "Lab information system", lead_id: "admin", lead_name: "Sara Admin",
  status: "active", start_date: "2026-10-01", target_date: "2026-12-31", created_at: "2026-10-01T08:00:00Z",
  issue_count: 2, done_count: 1, member_count: 3,
};
const members = [
  { user_id: "admin", name: "Sara Admin", email: "sara@example.com", role: "admin" },
  { user_id: "dev", name: "Ali Dev", email: "ali@example.com", role: "member" },
  { user_id: "drt", name: "Dr T", email: "drt@example.com", role: "viewer" },
];
const base = {
  project_id: "p1", description: null, priority: "medium", story_points: null, labels: [], reporter_id: "drt", reporter_name: "Dr T",
  assignee_id: null, assignee_name: null, parent_id: null, parent: null, start_date: null, due_date: null, resolved_at: null,
  created_at: "2026-10-02T08:00:00Z", updated_at: "2026-10-02T08:00:00Z", child_count: 0, child_done: 0, comment_count: 0,
};
const epicRef = { id: "e1", key: "LIMS-1", summary: "AI file analysis", issue_type: "epic", status: "in_progress" };

function issues() {
  return [
    { ...base, id: "e1", key: "LIMS-1", number: 1, issue_type: "epic", summary: "AI file analysis", status: "in_progress", rank: 1, child_count: 2, child_done: 1 },
    { ...base, id: "s1", key: "LIMS-2", number: 2, issue_type: "story", summary: "Analyse uploaded PDFs", status: "todo", rank: 2,
      parent_id: "e1", parent: epicRef, story_points: 5, labels: ["ai"], assignee_id: "dev", assignee_name: "Ali Dev", due_date: "2026-11-15" },
    { ...base, id: "b1", key: "LIMS-3", number: 3, issue_type: "bug", summary: "Upload fails over 20MB", status: "done", rank: 3, parent_id: "e1", parent: epicRef, priority: "high" },
  ];
}

async function mount(page: Page, role: "admin" | "viewer") {
  const userId = role === "admin" ? "admin" : "drt";
  let list = issues();
  let comments: Array<Record<string, unknown>> = [];
  const requests: Array<{ method: string; path: string; body: unknown }> = [];
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    if (!path.startsWith("/api/")) return route.continue();
    const body = request.postData() ? request.postDataJSON() : null;
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
      list = list.map((item) => item.id === id ? { ...item, ...body } : item);
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
}

test("project list leads to issues grouped by epic, and an issue opens in a panel", async ({ page }) => {
  const requests = await mount(page, "admin");
  await page.goto("/projects");
  await expect(page.getByRole("heading", { name: "Projects", level: 1 })).toBeVisible();
  await page.getByRole("link", { name: "LIMS v3" }).click();
  await expect(page.getByRole("heading", { name: "LIMS v3", level: 1 })).toBeVisible();

  const epic = page.getByRole("region", { name: "Epic LIMS-1" });
  await expect(epic.getByText("AI file analysis")).toBeVisible();
  await expect(epic.getByText("1/2 done")).toBeVisible();
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
