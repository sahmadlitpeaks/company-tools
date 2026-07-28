import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/**
 * Wait for the DOM rather than every subresource: index.html pulls a
 * webfont stylesheet from a third-party CDN, and on an air-gapped CI box
 * that request stalls and holds the `load` event open long past the point
 * where the app is rendered and interactive.
 */
const NAV = { waitUntil: "domcontentloaded" } as const;

/**
 * Keep the suite off the public internet: index.html pulls a webfont from a
 * third-party CDN, and where that host is unreachable every navigation waits
 * on it before the DOM is ready. Blocking it makes the run fast and
 * deterministic — the app does not depend on the font to function.
 */
test.beforeEach(async ({ page }) => {
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
});


const EMAIL = process.env.E2E_EMAIL || "admin@agholding.net";
const PASSWORD = process.env.E2E_PASSWORD || "admin";

async function signIn(page: import("@playwright/test").Page) {
  await page.goto("/login", NAV);
  await page.getByPlaceholder("you@agholding.net").fill(EMAIL);
  await page.locator('input[type="password"]').first().fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  const setNew = page.getByRole("button", { name: /update password/i });
  if (await setNew.isVisible().catch(() => false)) {
    const fields = page.locator('input[type="password"]');
    await fields.nth(0).fill(PASSWORD);
    await fields.nth(1).fill("E2ePassword123");
    await fields.nth(2).fill("E2ePassword123");
    await setNew.click();
  }
  // Assert on the app shell, not on "Welcome" — the login page itself says
  // "Welcome back", so matching that text would pass even on a failed sign-in.
  await expect(page.locator(".app-shell")).toBeVisible({ timeout: 20_000 });
  await page.goto("/", NAV);
  await settle(page);
}

/**
 * Let entry animations finish before auditing.
 *
 * The content area fades in, and axe evaluates colour contrast against the
 * blended pixels — auditing a half-faded page reports essentially every
 * element as low contrast, which is noise rather than a real finding.
 */
async function settle(page: import("@playwright/test").Page) {
  await page
    .waitForFunction(
      () => document.getAnimations().every((a) => a.playState !== "running"),
      null,
      { timeout: 5_000 },
    )
    .catch(() => undefined);
}

function serious(results: { violations: { impact?: string | null }[] }) {
  return results.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );
}

test("login page has no serious accessibility violations", async ({ page }) => {
  await page.goto("/login", NAV);
  await settle(page);
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  expect(serious(results)).toEqual([]);
});

test("dashboard has no serious accessibility violations", async ({ page }) => {
  await signIn(page);
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  expect(serious(results)).toEqual([]);
});
