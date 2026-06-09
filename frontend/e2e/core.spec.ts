import { expect, test } from "@playwright/test";

/** Sign in via the local dev-login (ENVIRONMENT=development). */
async function devLogin(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByPlaceholder("you@agholding.net").fill("e2e@agholding.net");
  await page.getByRole("button", { name: "Go" }).click();
  await expect(page).toHaveURL(/\/$|\/dashboard/);
}

test("dev login → dashboard loads", async ({ page }) => {
  await devLogin(page);
  await expect(page.getByText(/Welcome/)).toBeVisible();
  await expect(page).toHaveTitle(/AG Holding/);
});

test("navigation links work", async ({ page }) => {
  await devLogin(page);
  await page.getByRole("link", { name: "Leads (CRM)" }).click();
  await expect(page).toHaveURL(/\/crm/);
  await page.getByRole("link", { name: "Campaign Studio" }).click();
  await expect(page).toHaveURL(/\/campaigns/);
});

test("/assets redirects to /marketing-assets (no port drop)", async ({ page }) => {
  await devLogin(page);
  await page.goto("/assets");
  await expect(page).toHaveURL(/\/marketing-assets$/);
});

test("unknown route shows 404", async ({ page }) => {
  await devLogin(page);
  await page.goto("/totally-unknown-path");
  await expect(page.getByText("404")).toBeVisible();
  await expect(page.getByText("Page not found")).toBeVisible();
});

test("no horizontal overflow at 390px", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await devLogin(page);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1,
  );
  expect(overflow).toBeFalsy();
});
