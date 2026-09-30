import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const people = [
  { id: "manager", name: "Marketing Manager", department_id: "marketing", in_team: true },
  { id: "maya", name: "Maya Marketing", department_id: "marketing", in_team: true },
  { id: "omar", name: "Omar Marketing", department_id: "marketing", in_team: true },
  { id: "finance", name: "Finance Member", department_id: "finance-dept", in_team: false },
];
const ordinaryTask = { id: "ordinary", title: "Prepare campaign launch", description: "Prepare the launch brief and creative files.",
  status: "todo", priority: "normal", due_date: "2027-01-20", assignee_id: "maya", assignee_name: "Maya Marketing",
  assignee_department_id: "marketing", assignee_department_name: "Marketing", created_by_id: "manager",
  created_by_name: "Marketing Manager", created_at: "2026-09-30T08:00:00Z",
  subtasks_total: 1, subtasks_done: 0, comment_count: 0, assignment_email_status: "sent" };
const complianceTask = { id: "compliance", title: "Review contract termination notice", description: "Supplier agreement · Vendor LLC",
  document_id: "document", document_name: "Supplier agreement.docx", company: "Vendor LLC", basis: "notice",
  source: "compliance", status: "todo", priority: "high", due_date: "2027-11-01", assignee_id: "omar",
  assignee_name: "Omar Marketing", assignee_department_id: "marketing", assignee_department_name: "Marketing",
  can_change_status: true, can_assign: true, can_delete: false, owner_department_id: null,
  created_at: "2026-09-30T08:00:00Z", subtasks_total: 0, subtasks_done: 0, comment_count: 0,
  assignment_email_status: "pending" };

async function setup(page: Page) {
  let task = { ...ordinaryTask };
  let documentTask = { ...complianceTask };
  let created: Record<string, unknown> | null = null;
  const mutations: Array<{ path: string; body: Record<string, unknown> }> = [];
  let deleted = false;
  let items = [{ id: "item", task_id: "ordinary", title: "Confirm campaign dates", done: false, sort: 0 }];
  const comments: Array<{ id: string; task_id: string; body: string; author_name: string; created_at: string }> = [];
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (!path.startsWith("/api/")) { await route.continue(); return; }
    const method = route.request().method();
    const payload = method === "GET" || method === "DELETE" ? {} : route.request().postDataJSON();
    if (method !== "GET") mutations.push({ path, body: payload });
    let json: unknown = [];
    if (path === "/api/auth/me") json = { id: "manager", email: "manager@example.com", display_name: "Marketing Manager",
      role: "manager", is_admin: false, is_active: true, status: "active", department_id: "marketing",
      effective_permissions: ["tasks", "sharepoint_intelligence"], managed_company_ids: [], created_at: "2026-01-01T00:00:00Z" };
    else if (path === "/api/settings/public") json = { platform_name: "AG Holding" };
    else if (path === "/api/notifications/unread-count") json = { count: 0 };
    else if (path === "/api/tasks/options") json = { users: people, departments: [{ id: "marketing", name: "Marketing" }, { id: "finance-dept", name: "Finance" }] };
    else if (path === "/api/tasks/compliance") json = { tasks: [documentTask], available: true, message: null };
    else if (path === "/api/tasks" && method === "GET") json = deleted ? [] : [task];
    else if (path === "/api/tasks" && method === "POST") { created = payload; json = { ...task, ...payload, id: "new-task" }; }
    else if (path === "/api/tasks/ordinary" && method === "PATCH") { task = { ...task, ...payload }; json = task; }
    else if (path === "/api/tasks/ordinary" && method === "DELETE") { deleted = true; return route.fulfill({ status: 204 }); }
    else if (path === "/api/tasks/ordinary") json = { ...task, items, comments };
    else if (path === "/api/tasks/ordinary/items") { items.push({ id: "new-item", task_id: "ordinary", title: payload.title, done: false, sort: 1 }); json = items.at(-1); }
    else if (path === "/api/tasks/items/item") { items = items.map((item) => ({ ...item, ...payload })); json = items[0]; }
    else if (path === "/api/tasks/ordinary/comments") { comments.push({ id: "comment", task_id: "ordinary", body: payload.body, author_name: "Marketing Manager", created_at: "2026-09-30T10:00:00Z" }); json = comments.at(-1); }
    else if (path === "/api/sharepoint/compliance/tasks/compliance") { documentTask.status = payload.status === "completed" ? "done" : "todo"; json = { id: "compliance", status: payload.status }; }
    else if (path === "/api/sharepoint/compliance/tasks/compliance/progress") { documentTask.status = payload.status; json = { id: "compliance", work_status: payload.status }; }
    else if (path === "/api/sharepoint/compliance/tasks/compliance/assign") json = { id: "compliance" };
    await route.fulfill({ json });
  });
  return { mutations, getCreated: () => created };
}

test("manager cards combine member tasks and compliance work with readable details", async ({ page }) => {
  await setup(page);
  await page.goto("/tasks");
  await expect(page.getByRole("heading", { name: "Maya Marketing", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Omar Marketing", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open task: Review contract termination notice" })).toBeVisible();
  await expect(page.getByText("Assignment email sent", { exact: true })).toBeVisible();
  await expect(page.getByText("Assignment email queued", { exact: true })).toBeVisible();
  await expect(page.getByText("1 Nov 2027", { exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: "Search tasks" }).fill("Supplier agreement");
  await expect(page.getByRole("button", { name: "Open task: Prepare campaign launch" })).toHaveCount(0);
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(page.getByRole("button", { name: "Open task: Prepare campaign launch" })).toBeVisible();
  if (page.viewportSize()!.width < 768) {
    await expect(page.getByRole("combobox", { name: "Member", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Show filters", exact: true }).click();
    await expect(page.getByRole("combobox", { name: "Member", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Hide filters", exact: true }).click();
  }
  await page.screenshot({ path: `test-results/tasks-${page.viewportSize()!.width}.png`, fullPage: true });
  const violations = (await new AxeBuilder({ page }).analyze()).violations;
  expect(violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("new assignment limits people to selected department and saves a deadline", async ({ page }) => {
  const state = await setup(page);
  await page.goto("/tasks");
  await page.getByRole("button", { name: "New task", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: "Task title" }).fill("Prepare launch report");
  await dialog.getByRole("textbox", { name: "Description and instructions" }).fill("Confirm the launch numbers.");
  await dialog.getByRole("combobox", { name: "Assign to", exact: true }).click();
  await expect(page.getByRole("option", { name: "Maya Marketing", exact: true })).toBeVisible();
  await expect(page.getByRole("option", { name: "Finance Member", exact: true })).toHaveCount(0);
  await page.getByRole("option", { name: "Maya Marketing", exact: true }).click();
  await dialog.getByLabel("Due date", { exact: true }).fill("2027-01-20");
  await dialog.getByRole("button", { name: "Create task", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(state.getCreated()).toMatchObject({ title: "Prepare launch report", assignee_id: "maya",
    department_id: "marketing", due_date: "2027-01-20" });
});

test("compliance work updates progress and completion from Tasks", async ({ page }) => {
  const state = await setup(page);
  await page.goto("/tasks?task=compliance");
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Review contract termination notice", exact: true })).toBeVisible();
  await dialog.getByRole("combobox", { name: "Status", exact: true }).click();
  await page.getByRole("option", { name: "In progress", exact: true }).click();
  await expect.poll(() => state.mutations.some((call) => call.path.endsWith("/progress") && call.body.status === "in_progress")).toBe(true);
  await dialog.getByRole("combobox", { name: "Status", exact: true }).click();
  await page.getByRole("option", { name: "Done", exact: true }).click();
  await expect.poll(() => state.mutations.some((call) => call.path === "/api/sharepoint/compliance/tasks/compliance" && call.body.status === "completed")).toBe(true);
  await expect(dialog.getByRole("combobox", { name: "Status", exact: true })).toContainText("Done");
});

test("manager can select another department for document assignment", async ({ page }) => {
  const state = await setup(page);
  await page.goto("/tasks?task=compliance");
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("combobox", { name: "Department", exact: true }).click();
  await page.getByRole("option", { name: "Finance", exact: true }).click();
  await dialog.getByRole("combobox", { name: "Department member", exact: true }).click();
  await expect(page.getByRole("option", { name: "Maya Marketing", exact: true })).toHaveCount(0);
  await page.getByRole("option", { name: "Finance Member", exact: true }).click();
  await dialog.getByRole("textbox", { name: "Assignment reason", exact: true }).fill("Finance must approve renewal.");
  await dialog.getByRole("button", { name: "Save assignment", exact: true }).click();
  await expect.poll(() => state.mutations.some((call) => call.path.endsWith("/assign") &&
    call.body.owner_user_id === "finance" && call.body.department_id === "finance-dept")).toBe(true);
});

test("ordinary task deep link supports checklist and comments", async ({ page }) => {
  const state = await setup(page);
  await page.goto("/tasks?task=ordinary");
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Prepare campaign launch", exact: true })).toBeVisible();
  await dialog.getByRole("checkbox", { name: /Mark Confirm campaign dates/ }).click();
  await expect(dialog.getByRole("checkbox", { name: /Mark Confirm campaign dates/ })).toBeChecked();
  await dialog.getByRole("textbox", { name: "Add a comment", exact: true }).fill("Creative files are ready.");
  await dialog.getByRole("button", { name: "Post comment", exact: true }).click();
  await expect(dialog.getByText("Creative files are ready.", { exact: true })).toBeVisible();
  expect(state.mutations.some((call) => call.path === "/api/tasks/items/item" && call.body.done === true)).toBe(true);
});

test("failed save stays readable and delete requires confirmation", async ({ page }) => {
  await setup(page);
  await page.route("**/api/tasks/ordinary", (route) => route.request().method() === "PATCH" ?
    route.fulfill({ status: 503, json: { detail: "Task service is temporarily unavailable." } }) : route.fallback());
  await page.goto("/tasks");
  await page.getByRole("combobox", { name: "Status for Prepare campaign launch", exact: true }).click();
  await page.getByRole("option", { name: "In progress", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Task service is temporarily unavailable." })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Status for Prepare campaign launch", exact: true })).toContainText("To do");
  await page.getByRole("button", { name: "Delete task: Prepare campaign launch", exact: true }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog.getByRole("heading", { name: "Delete task?" })).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("button", { name: "Open task: Prepare campaign launch" })).toBeVisible();
  await page.getByRole("button", { name: "Delete task: Prepare campaign launch", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete task", exact: true }).click();
  await expect(page.getByRole("button", { name: "Open task: Prepare campaign launch" })).toHaveCount(0);
});

test("document cards remain available when ordinary tasks fail to load", async ({ page }) => {
  await setup(page);
  await page.route("**/api/tasks", (route) => route.fulfill({ status: 503, json: { detail: "Assigned tasks are temporarily unavailable." } }));
  await page.goto("/tasks");
  await expect(page.getByText("Assigned tasks are temporarily unavailable.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open task: Review contract termination notice" })).toBeVisible();
});
