import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// A non-admin who holds only roles.manage (BRD PRM-02): the Roles page must
// open through the permission, not through the admin flag.
const user = {
  id: "user-1",
  email: "roles@example.com",
  display_name: "Riley Roles",
  is_active: true,
  is_admin: false,
  role: "member",
  status: "active",
  effective_permissions: ["dashboard", "projects"],
  platform_permissions: ["roles.manage"],
  managed_company_ids: [],
  created_at: "2026-01-01T00:00:00Z",
};

const catalog = {
  platform: [
    { key: "roles.manage", group: "System", label: "Manage roles", description: "Create and edit roles." },
    { key: "projects.create", group: "Projects", label: "Create projects", description: "Create a new project." },
  ],
  project: [
    { key: "project.view", group: "Project", label: "View project", description: "See the project." },
    { key: "sprint.manage", group: "Planning", label: "Manage sprints", description: "Run sprints." },
  ],
};

const roles = [
  { id: "r-admin", key: "admin", name: "Project Admin", description: "Runs the project.", scope: "project",
    permissions: ["project.view", "sprint.manage"], is_system: true, usage: 3 },
  { id: "r-owner", key: "owner", name: "Owner", description: "Every permission.", scope: "platform",
    permissions: [], is_system: true, is_protected: true, usage: 1 },
  { id: "r-creator", key: "project_creator", name: "Project Creator", description: "Creates projects.", scope: "platform",
    permissions: ["projects.create"], is_system: true, usage: 1 },
];

test("roles page lets a roles manager create a role with chosen permissions", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let created: unknown = null;
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (!url.pathname.startsWith("/api/")) return route.continue();
    let body: unknown = {};
    let status = 200;
    if (url.pathname === "/api/auth/me") body = user;
    else if (url.pathname === "/api/access/catalog") body = catalog;
    else if (url.pathname === "/api/access/roles" && route.request().method() === "POST") {
      created = route.request().postDataJSON();
      status = 201;
      body = { id: "r-new", key: "sprint_lead", description: null, is_system: false, usage: 0, ...(created as object) };
    } else if (url.pathname === "/api/access/roles") body = roles;
    else if (["/api/companies", "/api/notifications"].includes(url.pathname)) body = [];
    else if (url.pathname === "/api/notifications/unread-count") body = { count: 0 };
    await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  });

  await page.goto("/roles");
  await expect(page.getByRole("heading", { name: "Roles & permissions" })).toBeVisible();
  // Not an admin: the Departments tab (admin-only list) stays hidden.
  await expect(page.getByRole("tab", { name: "Departments" })).toHaveCount(0);
  await expect(page.getByText("Project Creator").filter({ visible: true }).first()).toBeVisible();
  // The Owner role is protected: no edit, copy or delete.
  await expect(page.getByText("Protected").filter({ visible: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit Owner" })).toHaveCount(0);

  await page.getByRole("tab", { name: "Project roles" }).click();
  await expect(page.getByText("Project Admin").filter({ visible: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "New project role" }).click();
  const dialog = page.getByRole("dialog", { name: "New project role" });
  await dialog.getByLabel("Name").fill("Sprint Lead");
  await dialog.getByRole("checkbox", { name: "View project" }).click();
  await dialog.getByRole("checkbox", { name: "Manage sprints" }).click();

  const accessibility = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(accessibility.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);

  await dialog.getByRole("button", { name: "Save role" }).click();
  await expect(dialog).toBeHidden();
  expect(created).toEqual({ name: "Sprint Lead", description: "", permissions: ["project.view", "sprint.manage"], scope: "project" });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test("roles page is closed without roles.manage", async ({ page }) => {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (!url.pathname.startsWith("/api/")) return route.continue();
    const body = url.pathname === "/api/auth/me" ? { ...user, platform_permissions: [] }
      : url.pathname === "/api/notifications/unread-count" ? { count: 0 } : [];
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.goto("/roles");
  await expect(page.getByText("No access")).toBeVisible();
});
