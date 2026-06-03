import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("login page has no serious accessibility violations", async ({ page }) => {
  await page.goto("/login");
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  const serious = results.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );
  expect(serious).toEqual([]);
});

test("dashboard has no serious accessibility violations", async ({ page }) => {
  await page.goto("/login");
  await page.getByPlaceholder("you@agholding.net").fill("a11y@agholding.net");
  await page.getByRole("button", { name: "Go" }).click();
  await expect(page.getByText(/Welcome/)).toBeVisible();
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  const serious = results.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );
  expect(serious).toEqual([]);
});
