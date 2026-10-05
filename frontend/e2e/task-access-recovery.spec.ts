import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const preview = { id: "assigned", title: "Document task assigned", source: "compliance", status: "todo", priority: "normal",
  due_date: null, assignee_id: "member", assignee_name: "Shadi", assignee_department_id: null,
  can_change_status: false, can_assign: false, can_delete: false, assignment_email_status: "failed",
  created_at: "2026-09-30T09:00:00Z", subtasks_total: 0, subtasks_done: 0, comment_count: 0,
  access_state: "checking", access_message: "Checking your access to the original SharePoint file." };
const local = { ...preview, id: "ordinary", source: undefined, access_state: undefined, title: "Prepare report", assignee_id: "member", can_change_status: true };
async function setup(page: Page, full: "delay" | "connection" | "error") {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (!url.pathname.startsWith("/api/")) { await route.continue(); return; }
    let json: unknown = [];
    if (url.pathname === "/api/auth/me") json = { id: "member", email: "member@example.com", display_name: "Shadi", is_admin: false, role: "member", is_active: true, status: "active", effective_permissions: ["tasks"], managed_company_ids: [] };
    else if (url.pathname === "/api/settings/public") json = { platform_name: "AG Holding" };
    else if (url.pathname === "/api/notifications/unread-count") json = { count: 0 };
    else if (url.pathname === "/api/tasks") json = [local];
    else if (url.pathname === "/api/tasks/options") json = { users: [], departments: [] };
    else if (url.pathname.endsWith("/email/retry")) json = { ok: true };
    else if (url.pathname === "/api/tasks/compliance") {
      if (url.searchParams.has("preview")) json = { tasks: [preview], available: true, message: null };
      else if (full === "error") return route.fulfill({ status: 503, json: { detail: "SharePoint unavailable" } });
      else if (full === "delay") { await new Promise((resolve) => setTimeout(resolve, 5000)); json = { tasks: [preview], available: true, message: null }; }
      else json = { tasks: [{ ...preview, access_state: "microsoft_connection_required", access_message: "Connect Microsoft to verify access to the original file and enable task status changes." }], available: true, message: null };
    }
    await route.fulfill({ json });
  });
}
test("ordinary and assigned preview cards render before slow SharePoint checks", async ({ page }) => {
  await setup(page, "delay");
  await page.goto("/tasks");
  await expect(page.getByRole("button", { name: "Open task: Prepare report" })).toBeVisible({ timeout: 2500 });
  await expect(page.getByRole("button", { name: "Open task: Document task assigned" })).toBeVisible({ timeout: 2500 });
  await expect(page.getByText("Checking document tasks. Other tasks are ready to use.")).toBeVisible();
  await expect(page.getByText("This task is no longer available", { exact: false })).toHaveCount(0);
});
test("Compliance deep link explains connection and allows email retry without file facts", async ({ page }) => {
  await setup(page, "connection");
  await page.goto("/tasks?task=assigned");
  const dialog=page.getByRole("dialog");
  await expect(dialog.getByText("Connect Microsoft to verify access to the original file and enable task status changes.")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Retry assignment email" })).toBeVisible();
  await dialog.getByRole("button", { name: "Retry assignment email" }).click();
  await expect(dialog.getByRole("button", { name: "Open my documents" })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({path: "test-results/task-access-" + page.viewportSize()!.width + ".png", fullPage:true});
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
test("SharePoint outage retains assignments without displaying false missing-task error", async ({ page }) => {
  await setup(page, "error");
  await page.goto("/tasks?task=assigned");
  await expect(page.getByRole("dialog", { name: "Document task assigned" })).toBeVisible();
  await expect(page.getByText("This task is no longer available", { exact: false })).toHaveCount(0);
});
