import { expect, test } from "@playwright/test";
import { login } from "./auth";

test("password login → dashboard loads", async ({ page }) => {
  await login(page);
  await expect(page.getByText(/Welcome back/)).toBeVisible();
  await expect(page).toHaveTitle(/AG Holding/);
});

test("navigation links work", async ({ page }) => {
  await login(page);
  const mobile = (page.viewportSize()?.width ?? 1280) < 768;
  if (mobile) await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("link", { name: "Leads (CRM)" }).click();
  await expect(page).toHaveURL(/\/crm/);
  if (mobile) await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("link", { name: "Campaign Studio" }).click();
  await expect(page).toHaveURL(/\/campaigns/);
});

test("/assets redirects to /marketing-assets (no port drop)", async ({ page }) => {
  await login(page);
  await page.goto("/assets");
  await expect(page).toHaveURL(/\/marketing-assets$/);
});

test("unknown route shows 404", async ({ page }) => {
  await login(page);
  await page.goto("/totally-unknown-path");
  await expect(page.getByText("404")).toBeVisible();
  await expect(page.getByText("Page not found")).toBeVisible();
});

test("no horizontal overflow at 390px", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await login(page);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1,
  );
  expect(overflow).toBeFalsy();
});
