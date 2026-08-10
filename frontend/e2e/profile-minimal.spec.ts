import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const user = {
  id: "user-1",
  email: "alex@example.com",
  display_name: "Alex Morgan",
  given_name: "Alex",
  job_title: "Operations Lead",
  is_active: true,
  is_admin: true,
  role: "admin",
  status: "active",
  effective_permissions: [],
  managed_company_ids: [],
  created_at: "2024-01-01T00:00:00Z",
};

const profile = {
  id: "user-1",
  name: "Alex Morgan",
  email: "alex@example.com",
  job_title: "Operations Lead",
  role: "admin",
  status: "active",
  is_admin: true,
  department_name: "Operations",
  hr_department: "Operations",
  office_location: "Dubai HQ",
  mobile_phone: "+971 50 555 0101",
  business_phone: "+971 4 555 0101",
  avatar_url: null,
  created_at: "2024-01-01T00:00:00Z",
  manager_id: "manager-1",
  manager_name: "Jamie Lee",
  employment_type: "full_time",
  hire_date: "2024-01-15",
  probation_end_date: "2024-07-15",
  contract_end_date: null,
  direct_reports: [{ id: "person-2", label: "Sam Patel", sub: "Office Manager", status: "active" }],
  personal_email: "alex@personal.example",
  nationality: "British",
  passport_no: "A1234567",
  date_of_birth: "1990-04-12",
  emergency_contact_name: "Morgan Alex",
  emergency_contact_phone: "+44 20 0000 0000",
  emergency_contact_relationship: "Partner",
  modules: ["dashboard", "tasks", "attendance"],
  access_grants: [{ id: "grant-1", label: "Microsoft 365", sub: "Business Premium", status: "active" }],
  subscriptions: [{ subscription_id: "sub-1", name: "Figma", vendor: "Figma", source: "seat", seat_status: "active" }],
  assets: [{ id: "asset-1", label: "MacBook Pro", sub: "AG-0124", status: "assigned" }],
  phones: [{ id: "phone-1", label: "+971 50 555 0101", sub: "Etisalat", status: "active" }],
  open_tasks: [{ id: "task-1", title: "Complete office review", status: "in_progress", priority: "high", due_date: "2026-08-01" }],
  journeys: [{ id: "journey-1", kind: "onboarding", status: "active", total_tasks: 8, done_tasks: 6, created_at: "2024-01-01T00:00:00Z" }],
  events: [{ id: "event-1", event_type: "hired", effective_date: "2024-01-15", title: "Joined AG Holding", detail: "Operations", created_at: "2024-01-15T00:00:00Z" }],
  can_manage: true,
  can_see_sensitive: true,
};

test.beforeEach(async ({ page }) => {
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (!path.startsWith("/api/")) {
      await route.continue();
      return;
    }

    let body: unknown = {};
    if (path === "/api/auth/me") body = user;
    else if (path === "/api/profiles/me") body = profile;
    else if (path === "/api/custom-fields/values/user-1") body = { fields: [], tables: [], can_edit: true };
    else if (path === "/api/performance/goals/by-user/user-1") body = [];
    else if (path === "/api/compensation/current/user-1") body = { amount: "120000", currency: "USD", pay_period: "annual", effective_date: "2026-01-01", annualised: "120000" };
    else if (path === "/api/compensation/by-user/user-1") body = [];
    else if (path === "/api/compensation/total-rewards/user-1") body = { total_annual: "120000", currency: "USD", components: [] };
    else if (path === "/api/hr-documents/by-user/user-1") body = [];
    else if (path === "/api/profiles/user-1/field-history") body = [];
    else if (path === "/api/companies" || path === "/api/notifications") body = [];
    else if (path === "/api/notifications/unread-count") body = { count: 0 };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
});

test("profile uses minimal flat navigation and preserves sections", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/profile");
  await expect(page.getByRole("heading", { name: "Alex Morgan" })).toBeVisible();
  const profileNav = page.getByRole("navigation", { name: "Profile sections" });
  for (const section of ["Personal", "Job", "Compensation", "Documents", "Performance", "Assets & Access", "Change History"]) {
    await expect(profileNav.getByRole("button", { name: section })).toBeVisible();
  }

  await expect(page.getByText("Contact", { exact: true })).toBeVisible();
  await expect(page.getByText("Personal details", { exact: true })).toBeVisible();
  await profileNav.getByRole("button", { name: "Job" }).click();
  await expect(page.getByText("Employment", { exact: true })).toBeVisible();
  await expect(page.getByText("Reporting", { exact: true })).toBeVisible();
  await profileNav.getByRole("button", { name: "Assets & Access" }).click();
  await expect(page.getByText("MacBook Pro", { exact: true })).toBeVisible();
  await expect(page.getByText("Microsoft 365", { exact: true })).toBeVisible();

  const cards = page.locator('[data-slot="card"]');
  expect(await cards.count()).toBeGreaterThan(0);
  await expect(cards.first()).toHaveCSS("border-radius", "0px");
  expect(await cards.first().getAttribute("class")).not.toContain("shadow-md");
  await expect(page.locator("header").first()).not.toHaveCSS("background-image", /gradient/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  const accessibility = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(accessibility.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical")).toEqual([]);
  expect(errors).toEqual([]);
});
