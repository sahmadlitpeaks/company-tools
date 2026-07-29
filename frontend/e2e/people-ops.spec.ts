import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const user = {
  id: "admin-1",
  email: "admin@agholding.net",
  display_name: "Admin User",
  given_name: "Admin",
  is_active: true,
  is_admin: true,
  role: "admin",
  status: "active",
  effective_permissions: [],
  managed_company_ids: [],
  created_at: "2026-01-01T00:00:00Z",
};

const company = {
  id: "ag",
  slug: "ag-holding",
  name: "AG Holding",
  primary_color: "#facc15",
  accent_color: "#facc15",
  is_active: true,
  is_default: true,
  created_at: "2026-01-01T00:00:00Z",
};

const employee = {
  id: "employee-1",
  email: "jamie@agholding.net",
  display_name: "Jamie Lee",
  job_title: "Operations Director",
  department: "Operations",
  department_name: "Operations",
  is_active: true,
  is_admin: false,
  role: "member",
  status: "active",
  effective_permissions: [],
  managed_company_ids: [],
  created_at: "2026-01-02T00:00:00Z",
};

const journey = {
  id: "journey-1",
  kind: "onboarding",
  status: "in_progress",
  note: "Prepare access before the employee's first day.",
  target_user_id: employee.id,
  target_name: employee.display_name,
  company_id: company.id,
  company_name: company.name,
  created_by_id: user.id,
  created_by_name: user.display_name,
  completed_at: null,
  created_at: "2026-07-20T09:00:00Z",
  total_tasks: 3,
  done_tasks: 1,
};

const journeyDetail = {
  ...journey,
  tasks: [
    {
      id: "task-1",
      journey_id: journey.id,
      title: "Create employee accounts",
      category: "accounts",
      status: "done",
      owner_id: user.id,
      owner_name: user.display_name,
      done_by_id: user.id,
      done_by_name: user.display_name,
      done_at: "2026-07-21T10:00:00Z",
      sort: 0,
    },
    {
      id: "task-2",
      journey_id: journey.id,
      title: "Assign laptop and equipment",
      category: "equipment",
      status: "pending",
      owner_id: null,
      owner_name: null,
      done_by_id: null,
      done_by_name: null,
      done_at: null,
      sort: 1,
    },
    {
      id: "task-3",
      journey_id: journey.id,
      title: "Collect HR documents",
      category: "hr",
      status: "pending",
      owner_id: null,
      owner_name: null,
      done_by_id: null,
      done_by_name: null,
      done_at: null,
      sort: 2,
    },
  ],
  target: {
    id: employee.id,
    name: employee.display_name,
    email: employee.email,
    status: "active",
    role: "member",
    is_admin: false,
    effective_permissions: ["dashboard", "tasks"],
  },
  assigned_assets: [{ id: "asset-1", asset_tag: "LT-101", name: "Laptop" }],
  assigned_phones: [],
  access_grants: [{
    id: "grant-1",
    user_id: employee.id,
    name: "Google Workspace",
    system: "Google",
    username: employee.email,
    notes: null,
    status: "active",
    revoked_at: null,
    created_at: "2026-07-20T09:00:00Z",
  }],
  subscriptions: [{
    subscription_id: "subscription-1",
    name: "Notion",
    vendor: "Notion",
    source: "seat",
    seat_id: "seat-1",
    seat_status: "active",
  }],
};

test.beforeEach(async ({ page }) => {
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (!path.startsWith("/api/")) {
      await route.continue();
      return;
    }
    let body: unknown = [];
    if (path === "/api/auth/me") body = user;
    else if (path === "/api/companies") body = [company];
    else if (path === "/api/notifications") body = [];
    else if (path === "/api/notifications/unread-count") body = { count: 0 };
    else if (path === "/api/people/journeys") body = [journey];
    else if (path === `/api/people/journeys/${journey.id}`) body = journeyDetail;
    else if (path === `/api/people/journeys/${journey.id}/suggestions`) {
      body = { department_name: "Operations", subscriptions: [], access: [], auto_covered: [] };
    }
    else if (path === "/api/people/assignable-assets") body = [];
    else if (path === "/api/people/templates") body = [];
    else if (path === "/api/users") body = [employee, user];
    else if (path === "/api/hr-documents/expiring") body = [];
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
});

test("employee lifecycle cards and dialogs are structured and responsive", async ({ page }, testInfo) => {
  await page.goto("/people-ops");
  await expect(page.getByRole("heading", { name: "Onboarding & Offboarding" })).toBeVisible();
  await expect(page.getByText("Jamie Lee", { exact: true })).toBeVisible();
  const journeyProgress = page.getByRole("progressbar", { name: "Checklist progress" });
  await expect(journeyProgress).toBeVisible();
  await expect(journeyProgress).toHaveAttribute("aria-valuenow", "33");

  await page.getByRole("button", { name: "View details" }).click();
  const detailDialog = page.getByRole("dialog");
  await expect(detailDialog).toBeVisible();
  const dialogWidth = await detailDialog.evaluate((dialog) => dialog.getBoundingClientRect().width);
  if (testInfo.project.name === "desktop") expect(dialogWidth).toBeGreaterThan(900);
  else expect(dialogWidth).toBeLessThanOrEqual(400);
  await expect(page.getByRole("tab", { name: "Checklist" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Access" })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Mark Create employee accounts pending" })).toBeVisible();
  expect(
    await detailDialog.evaluate((dialog) => dialog.scrollWidth <= dialog.clientWidth + 1),
  ).toBe(true);
  await page.getByRole("tab", { name: "Equipment" }).click();
  await expect(page.getByText("LT-101", { exact: true })).toBeVisible();
  expect(
    await detailDialog.evaluate((dialog) => dialog.scrollWidth <= dialog.clientWidth + 1),
  ).toBe(true);
  await page.getByRole("button", { name: "Close" }).click();

  await page.getByRole("button", { name: "Onboard", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("button", { name: "Existing" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create new" })).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();

  await page.getByRole("button", { name: "Offboard", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByText("Departure safety check", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create new" })).toHaveCount(0);

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  const accessibility = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(
    accessibility.violations.filter(
      (violation) => violation.impact === "serious" || violation.impact === "critical",
    ),
  ).toEqual([]);
});
