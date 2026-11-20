import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// BRD 9C NAV-03: related pages share one menu entry and show tabs; every tab keeps its own URL.
const user = {
  id: "u1", email: "ops@example.com", display_name: "Ops", is_active: true, is_admin: true, role: "admin", status: "active",
  effective_permissions: ["dashboard", "qrcodes", "shortener", "crm"], platform_permissions: [], managed_company_ids: [],
  created_at: "2026-01-01T00:00:00Z",
};

test.beforeEach(async ({ page }) => {
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (!path.startsWith("/api/")) return route.continue();
    let json: unknown = [];
    if (path === "/api/auth/me") json = user;
    else if (path === "/api/notifications/unread-count") json = { count: 0 };
    else if (path === "/api/crm/sources") json = [
      { source: "web", source_detail: "agholding.net contact form", submissions: 12, leads: 9, last_at: new Date().toISOString() },
      { source: "brochure", source_detail: "Price list", submissions: 3, leads: 2, last_at: "2026-10-01T00:00:00Z" },
    ];
    await route.fulfill({ json });
  });
});

test("related pages share one menu entry and switch with tabs", async ({ page }, testInfo) => {
  await page.goto("/shortener");
  const tabs = page.getByRole("navigation", { name: "Links & QR pages" });
  await expect(tabs.getByRole("link", { name: "URL Shortener" })).toHaveAttribute("aria-current", "page");
  await tabs.getByRole("link", { name: "QR Codes" }).click();
  await expect(page).toHaveURL(/\/qrcodes$/);
  await expect(tabs.getByRole("link", { name: "QR Codes" })).toHaveAttribute("aria-current", "page");

  if (testInfo.project.name === "mobile") await page.getByRole("button", { name: "Open navigation menu" }).click();
  const sidebar = testInfo.project.name === "mobile"
    ? page.locator('[data-slot="sidebar"][data-mobile="true"]') : page.locator('[data-slot="sidebar-inner"]');
  await expect(sidebar.getByRole("link", { name: "Links & QR" })).toBeVisible();
  await expect(sidebar.getByRole("link", { name: "QR Codes" })).toHaveCount(0);
});

test("lead sources list each channel with its latest submission", async ({ page }) => {
  await page.goto("/crm/sources");
  await expect(page.getByRole("heading", { name: "Lead sources", level: 1 })).toBeVisible();
  await expect(page.getByText("agholding.net contact form").filter({ visible: true })).toBeVisible();
  await expect(page.getByText("Today").filter({ visible: true }).first()).toBeVisible();
  const accessibility = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(accessibility.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
