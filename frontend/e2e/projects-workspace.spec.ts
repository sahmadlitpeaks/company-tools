import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { mount, noOverflow, selectProjectTab } from "./projects-fixtures";
import { defaultSettings } from "../src/api/pm-workspace";

async function choose(page: Page, label: string, option: string) {
  await page.getByRole("combobox", { name: label, exact: true }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

test("new workflow states remain separate when an older board uses their column key", async ({ page }) => {
  await mount(page, "admin", { workspace: true });
  const errors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.route("**/api/pm/projects/p1/views", (route) => route.fulfill({ json: [{
    id: "v1", project_id: "p1", owner_id: "admin", name: "Team board", visibility: "team", can_manage: true,
    settings: { ...defaultSettings(), columns: [
      { key: "qa", name: "Ready", states: ["todo"], limit: null },
      ...["in_progress", "in_review", "done"].map((key) => ({ key, name: key, states: [key], limit: null })),
    ] },
  }] }));
  await page.goto("/projects/LIMS");
  await expect(page.getByRole("region", { name: "Ready column", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "QA testing column", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Create issue in QA testing", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("combobox", { name: "Status", exact: true })).toContainText("QA testing");
  expect(errors).toEqual([]);
});

test("create a configured Kanban board, persist it and remove only the view", async ({ page }) => {
  const requests = await mount(page, "admin", { workspace: true });
  await page.goto("/projects/LIMS");
  await page.getByRole("button", { name: "Create board", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: "Name", exact: true }).fill("QA delivery");
  await choose(page, "Board type", "Kanban · continuous work");
  await dialog.getByRole("tab", { name: "Columns", exact: true }).click();
  const first = dialog.getByRole("region", { name: "Column 1", exact: true });
  await first.getByRole("textbox", { name: "Column name" }).fill("Ready to build");
  await first.getByRole("spinbutton", { name: "WIP limit" }).fill("1");
  await dialog.getByRole("tab", { name: "Display", exact: true }).click();
  await choose(page, "Swimlanes", "Assignee");
  await dialog.getByRole("checkbox", { name: "Due date", exact: true }).check();
  await dialog.getByRole("button", { name: "Save view", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Board or saved view" })).toContainText("QA delivery");
  await expect(page.getByRole("region", { name: /Ready to build column$/ }).first()).toBeVisible();
  await expect(page).toHaveURL(/[?&]view=v2/);
  const post = requests.find((request) => request.path === "/api/pm/views");
  expect(post?.body).toMatchObject({ name: "QA delivery", settings: { board_type: "kanban", group_by: "assignee", columns: [{ key: "todo", name: "Ready to build", states: ["todo"], limit: 1 }, ...Array(4).fill(expect.anything())] } });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await noOverflow(page);
  await page.screenshot({ path: `test-results/workspace-board-${page.viewportSize()!.width}.png`, fullPage: true });
  await page.reload();
  await expect(page.getByRole("combobox", { name: "Board or saved view" })).toContainText("QA delivery");
  await page.getByRole("button", { name: "View actions" }).click();
  await page.getByRole("menuitem", { name: "Delete view", exact: true }).click();
  await page.getByRole("button", { name: "Delete view", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Board or saved view" })).toContainText("Team board");
  expect(requests.filter((request) => request.method === "DELETE").map((request) => request.path)).toEqual(["/api/pm/views/v2"]);
});

test("quick creation keeps state and sprint and applies a template and custom values", async ({ page }) => {
  const requests = await mount(page, "admin", { workspace: true });
  await page.goto("/projects/LIMS");
  await page.getByRole("button", { name: "Create issue in QA testing", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("combobox", { name: "Status" })).toContainText("QA testing");
  await expect(dialog.getByRole("combobox", { name: "Sprint", exact: true })).toContainText("LIMS Sprint 1");
  await choose(page, "Issue template", "Bug report");
  await dialog.getByRole("button", { name: "Apply template" }).click();
  await expect(dialog.getByRole("combobox", { name: "Issue type" })).toContainText("Bug");
  await dialog.getByRole("textbox", { name: "Summary", exact: true }).fill("Check QA permissions");
  await dialog.getByRole("textbox", { name: "Customer", exact: true }).fill("Lab A");
  await choose(page, "Component", "Frontend");
  await dialog.getByRole("button", { name: "Preview", exact: true }).click();
  await expect(dialog.getByRole("heading", { name: "Steps" })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await noOverflow(page);
  await dialog.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page).toHaveURL(/[?&]issue=LIMS-4/);
  expect(requests.find((request) => request.path === "/api/pm/projects/p1/issues")?.body).toMatchObject({ workflow_state: "qa", status: "in_review", sprint_id: "sp1", issue_type: "bug", priority: "high", custom_fields: { customer: "Lab A" }, component: "frontend" });
});

test("workflow configuration adds a named state and persists after reload", async ({ page }) => {
  const requests = await mount(page, "admin", { workspace: true });
  await page.goto("/projects/LIMS");
  await selectProjectTab(page, "Settings");
  await page.getByRole("button", { name: "Add workflow state" }).click();
  const section = page.getByRole("region", { name: "New workflow state" });
  await section.getByRole("textbox", { name: "State name" }).fill("Blocked");
  await page.getByRole("button", { name: "Save workflow and fields" }).click();
  await expect.poll(() => requests.some((request) => request.method === "PUT")).toBe(true);
  await page.reload();
  await expect(page.getByRole("region", { name: "Blocked", exact: true })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await noOverflow(page);
  await page.screenshot({ path: `test-results/workspace-settings-${page.viewportSize()!.width}.png`, fullPage: true });
});

test("bulk editing selected issues refreshes the list and inline editing works", async ({ page }) => {
  const requests = await mount(page, "admin", { workspace: true });
  await page.goto("/projects/LIMS?tab=issues");
  if (page.viewportSize()!.width < 640) await expect(page.getByRole("button", { name: "Filters and sorting", exact: true })).toHaveAttribute("aria-expanded", "false");
  await page.getByRole("checkbox", { name: "Select LIMS-2", exact: true }).check();
  await page.getByRole("checkbox", { name: "Select LIMS-5", exact: true }).check();
  await page.getByRole("button", { name: "Bulk edit", exact: true }).click();
  await choose(page, "Change field", "Priority");
  await choose(page, "New value", "High");
  await page.getByRole("button", { name: "Apply changes" }).click();
  await expect.poll(() => requests.some((request) => request.path === "/api/pm/issues/bulk")).toBe(true);
  expect(requests.find((request) => request.path === "/api/pm/issues/bulk")?.body).toEqual({ issue_ids: ["s1", "t1"], changes: { priority: "high" } });
  if (page.viewportSize()!.width >= 640) {
    await choose(page, "State for LIMS-2", "QA testing");
    await expect.poll(() => requests.some((request) => request.path === "/api/pm/issues/s1")).toBe(true);
  } else {
    await page.getByRole("button", { name: "Quick edit LIMS-2", exact: true }).click();
    await page.getByRole("spinbutton", { name: "Story points", exact: true }).fill("8");
    await page.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect.poll(() => requests.find((request) => request.path === "/api/pm/issues/s1")?.body).toMatchObject({ story_points: 8 });
  }
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await noOverflow(page);
  await page.screenshot({ path: `test-results/workspace-issues-${page.viewportSize()!.width}.png`, fullPage: true });
});

test("calendar requests the selected month and preserves the issue view context", async ({ page }) => {
  await mount(page, "admin", { workspace: true });
  await page.goto("/projects/LIMS?tab=issues&month=2026-10");
  const request = page.waitForRequest((req) => req.url().includes("/issues/page?") && req.url().includes("due_after="));
  await page.getByRole("button", { name: "Calendar", exact: true }).click();
  const url = new URL((await request).url());
  expect(url.searchParams.get("due_after")).toMatch(/^\d{4}-\d{2}-01$/);
  await page.getByRole("button", { name: "Next month" }).click();
  await expect(page.getByRole("heading", { name: "November 2026", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "November 2026", exact: true })).toBeVisible();
  await noOverflow(page);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: `test-results/workspace-calendar-${page.viewportSize()!.width}.png`, fullPage: true });
});

test("cross-project search can save a private list view and restore it", async ({ page }) => {
  const requests = await mount(page, "admin", { workspace: true });
  await page.goto("/projects?layout=issues");
  await page.getByRole("textbox", { name: "Search issues", exact: true }).fill("storage");
  await expect(page.getByRole("link", { name: "Set up storage bucket", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Analyse uploaded PDFs", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Save as view" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: "Name", exact: true }).fill("My storage work");
  await dialog.getByRole("button", { name: "Save view" }).click();
  await expect(page.getByRole("combobox", { name: "Saved personal view" })).toContainText("My storage work");
  expect(requests.find((request) => request.path === "/api/pm/views")?.body).toMatchObject({ project_id: null, visibility: "private", settings: { filters: { q: "storage" }, layout: "table" } });
  await page.reload();
  await expect(page.getByRole("combobox", { name: "Saved personal view" })).toContainText("My storage work");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await noOverflow(page);
  await page.getByRole("button", { name: "Delete view", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete view", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Saved personal view" })).toContainText("All accessible issues");
});

test("configuration errors block editing and Retry reloads the configuration", async ({ page }) => {
  await mount(page, "admin", { workspace: true });
  let fail = true;
  await page.route("**/api/pm/projects/p1/configuration", async (route) => {
    if (fail) { fail = false; await route.fulfill({ status: 503, json: { detail: "Workflow temporarily unavailable" } }); }
    else await route.fallback();
  });
  await page.goto("/projects/LIMS?tab=issues");
  await expect(page.getByText("Workflow temporarily unavailable", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create issue", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: /retry/i }).click();
  await expect(page.getByRole("button", { name: "Create issue", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Analyse uploaded PDFs", exact: true })).toBeVisible();
});

test("viewer duplication defaults to private and mentions are explicit", async ({ page }) => {
  const requests = await mount(page, "viewer", { workspace: true });
  await page.goto("/projects/LIMS");
  await expect(page.getByRole("button", { name: "Create board" })).toHaveCount(0);
  await page.getByRole("button", { name: "View actions" }).click();
  await expect(page.getByRole("menuitem", { name: "Configure view" })).toHaveCount(0);
  await page.getByRole("menuitem", { name: "Duplicate view" }).click();
  await expect(page.getByRole("combobox", { name: "Access", exact: true })).toContainText("Only me");
  await page.getByRole("button", { name: "Save view" }).click();
  expect(requests.find((request) => request.path === "/api/pm/views")?.body).toMatchObject({ visibility: "private" });
  await page.getByRole("link", { name: "Analyse uploaded PDFs", exact: true }).click();
  await choose(page, "Mention a teammate", "Ali Dev");
  await page.getByRole("textbox", { name: "Add a comment", exact: true }).fill("@Ali Dev **Please review**");
  await page.getByRole("button", { name: "Comment", exact: true }).click();
  await expect(page.getByText("Please review", { exact: true })).toBeVisible();
  expect(requests.find((request) => request.path.endsWith("/comments"))?.body).toEqual({ body: "@Ali Dev **Please review**", mention_ids: ["dev"] });
});
