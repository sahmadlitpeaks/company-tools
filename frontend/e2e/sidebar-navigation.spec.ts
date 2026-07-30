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
  created_at: "2026-01-01T00:00:00Z",
};

test.beforeEach(async ({ page }) => {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (!url.pathname.startsWith("/api/")) {
      await route.continue();
      return;
    }

    let body: unknown = {};
    if (url.pathname === "/api/auth/me") body = user;
    else if (url.pathname === "/api/auth/mfa/status") body = { enabled: false };
    else if (url.pathname === "/api/companies" || url.pathname === "/api/notifications") body = [];
    else if (url.pathname === "/api/notifications/unread-count") body = { count: 0 };
    else if (url.pathname === "/api/search") {
      body = {
        hits: [
          {
            id: "person-1",
            kind: "person",
            title: "Alex Morgan",
            subtitle: "Operations Lead",
            href: "/people/person-1",
          },
        ],
      };
    }

    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
});

test("sidebar categories and command search scale across viewports", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/security");
  await expect(page.getByRole("heading", { name: "Security" })).toBeVisible();

  if (testInfo.project.name === "mobile") {
    await page.getByRole("button", { name: "Open navigation menu" }).click();
  }

  const navigation = testInfo.project.name === "mobile"
    ? page.locator('[data-slot="sidebar"][data-mobile="true"]')
    : page.locator('[data-slot="sidebar-inner"]');
  await expect(navigation.getByRole("button", { name: /Overview/ })).toBeVisible();
  await expect(navigation.getByRole("button", { name: /My Work/ })).toBeVisible();
  await expect(navigation.getByRole("button", { name: /Workplace/ })).toBeVisible();
  await expect(navigation.getByRole("button", { name: /Publishing Tools/ })).toBeVisible();
  await expect(navigation.getByRole("button", { name: /Platform Administration/ })).toBeVisible();
  await expect(navigation.getByRole("button", { name: /Search people or tools/ })).toHaveCount(0);

  await expect(navigation.getByRole("link", { name: "Digital Cards" })).toBeVisible();
  await expect(navigation.getByRole("link", { name: "Campaign Studio" })).toBeVisible();

  if (testInfo.project.name === "mobile") {
    await page.locator('button[aria-label="Open navigation menu"]').evaluate((button: HTMLButtonElement) => button.click());
    await expect(navigation).toBeHidden();
  }
  await page.getByRole("button", { name: "Search people, tools, and everything" }).click();
  const command = page.getByRole("dialog");
  const input = command.getByPlaceholder(/Search people, tools/);
  await input.fill("payslip");
  await expect(command.getByText("Payroll", { exact: true })).toBeVisible();
  await expect(command.getByText("Time & Pay", { exact: true })).toBeVisible();

  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+k");
  await input.fill("Alex");
  await expect(command.getByRole("option", { name: /Alex Morgan.*Operations Lead/ })).toBeVisible();

  const accessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  expect(
    accessibility.violations.filter(
      (violation) => violation.impact === "serious" || violation.impact === "critical",
    ),
  ).toEqual([]);

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test("authenticated shell exposes one main landmark and manages route focus", async ({ page }) => {
  await page.goto("/security");
  await expect(page.getByRole("heading", { name: "Security" })).toBeVisible();

  const main = page.getByRole("main");
  await expect(main).toHaveCount(1);
  await expect(main).toHaveAccessibleName("Security & 2FA");

  await page.keyboard.press("Tab");
  const skipLink = page.getByRole("link", { name: "Skip to main content" });
  await expect(skipLink).toBeFocused();
  await expect(skipLink).toBeVisible();
  await skipLink.press("Enter");
  await expect(main).toBeFocused();

  await page.evaluate(() => {
    history.pushState({}, "", "/");
    dispatchEvent(new PopStateEvent("popstate"));
  });
  await expect(main).toBeFocused();
  await expect(main).toHaveAccessibleName("Dashboard");
  await expect(page).toHaveTitle("Dashboard — AG Holding");
});
