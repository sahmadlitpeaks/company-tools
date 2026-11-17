import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// BRD 9A: one view across products, Now/Next/Later meeting board, start an approved feature.
const user = {
  id: "lead", email: "lead@example.com", display_name: "Lina Lead", is_active: true, is_admin: false, role: "member",
  status: "active", effective_permissions: ["dashboard", "projects"], platform_permissions: [], managed_company_ids: [],
  created_at: "2026-01-01T00:00:00Z",
};
const feature = (over: Record<string, unknown>) => ({
  id: "f1", key: "WIMS-REQ-1", title: "Group bookings", project_id: "p1", project_key: "WIMS", project_name: "WIMS360",
  module_id: "m1", module_name: "Booking", priority: "high", horizon: "now", status: "approved", target_quarter: "2027-Q1",
  owner_id: null, owner_name: "Lina Lead", epics: [], progress: { done: 0, total: 0, percent: 0 }, can_edit: true, can_decide: true,
  ...over,
});

test("roadmap groups features by module, plans horizons and starts approved features", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const calls: Array<{ method: string; path: string; body: unknown }> = [];
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (!path.startsWith("/api/")) return route.continue();
    if (request.method() !== "GET") calls.push({ method: request.method(), path, body: request.postDataJSON() });
    let json: unknown = [];
    if (path === "/api/auth/me") json = user;
    else if (path === "/api/notifications/unread-count") json = { count: 0 };
    else if (path === "/api/pm/roadmap") json = {
      projects: [{ id: "p1", key: "WIMS", name: "WIMS360", can_edit: true, can_decide: true,
        modules: [{ id: "m1", name: "Booking", position: 1, archived: false }] }],
      features: [
        feature({}),
        feature({ id: "f2", key: "WIMS-REQ-2", title: "Loyalty points", module_id: null, module_name: null, priority: null,
          horizon: null, status: "in_progress", epics: [{ id: "e1", key: "WIMS-12", status: "in_progress", project_key: "WIMS" }],
          progress: { done: 1, total: 4, percent: 25 } }),
      ],
    };
    else if (path === "/api/pm/projects") json = [{ id: "p1", key: "WIMS", name: "WIMS360", status: "active",
      my_role: "admin", my_permissions: ["project.view", "issue.create"] }];
    else if (path.endsWith("/roadmap") && request.method() === "PATCH") json = feature({});
    else if (path.endsWith("/start")) json = { epic: { id: "e2", key: "WIMS-13", project_key: "WIMS" }, feature: feature({ status: "in_progress" }) };
    await route.fulfill({ json });
  });

  await page.goto("/roadmap");
  await expect(page.getByRole("heading", { name: "Roadmap", level: 1 })).toBeVisible();
  const booking = page.getByRole("region", { name: "WIMS Booking" });
  await expect(booking.getByText("Group bookings").filter({ visible: true })).toBeVisible();
  const unassigned = page.getByRole("region", { name: "WIMS No module" });
  await expect(unassigned.getByText("Loyalty points").filter({ visible: true })).toBeVisible();
  await expect(unassigned.getByRole("link", { name: "WIMS-12" }).filter({ visible: true })).toHaveAttribute("href", "/projects/WIMS?issue=WIMS-12");

  await booking.getByRole("button", { name: "Start" }).filter({ visible: true }).click();
  const start = page.getByRole("dialog", { name: "Start Group bookings" });
  await start.getByRole("button", { name: "Create epic" }).click();
  await expect(start).toBeHidden();
  expect(calls.find((c) => c.path === "/api/pm/requirements/f1/start")?.body).toEqual({ project_id: "p1" });

  await page.getByRole("tab", { name: "Meeting board" }).click();
  const notPlanned = page.getByRole("region", { name: "Not planned column" });
  await expect(notPlanned.getByRole("article", { name: "WIMS-REQ-2 Loyalty points" })).toBeVisible();
  const card = page.getByRole("article", { name: "WIMS-REQ-1 Group bookings" });
  await card.getByRole("combobox", { name: "Horizon" }).click();
  await page.getByRole("option", { name: "Later" }).click();
  await expect.poll(() => calls.find((c) => c.method === "PATCH")?.body).toEqual({ horizon: "later" });

  const accessibility = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(accessibility.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});
