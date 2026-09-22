import { expect, test } from "@playwright/test";
import { login } from "./auth";

/**
 * Org-wide module switches: turning a module off must remove it everywhere for
 * everyone, and turning it back on must restore it. Runs as an administrator,
 * which is the case that matters — an admin holds every module, so if the
 * switch works for them it is not being enforced by the permission check.
 *
 * Each test restores the module it touched so the suite can run repeatedly
 * against the same stack.
 */

/** Drive one switch to a known state, whatever it was in when we arrived. */
async function setModule(
  page: import("@playwright/test").Page,
  label: string,
  on: boolean,
) {
  await page.goto("/settings");
  // The switch offers the opposite of its current state, so its name tells us
  // where we are. Wait for whichever of the two rendered before deciding.
  const either = page.getByRole("switch", {
    name: new RegExp(`^Turn ${label} (on|off) for everyone$`),
  });
  await expect(either).toBeVisible();

  const settled = page.getByRole("switch", {
    name: `Turn ${label} ${on ? "off" : "on"} for everyone`,
  });
  if (await settled.isVisible()) return; // already where we want it

  await page
    .getByRole("switch", { name: `Turn ${label} ${on ? "on" : "off"} for everyone` })
    .click();
  if (!on) {
    // Switching off is destructive company-wide, so it asks first.
    await page.getByRole("button", { name: "Turn off" }).click();
  }
  await expect(settled).toBeVisible();
}

test.describe.configure({ mode: "serial" });

test("a switched-off module leaves the menu and its page stops loading", async ({
  page,
}) => {
  await login(page);

  await page.goto("/tasks");
  await expect(page.getByText("No access", { exact: true })).toHaveCount(0);

  await setModule(page, "Tasks", false);

  // Gone from navigation, for an administrator too.
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Tasks", exact: true })).toHaveCount(0);

  // And the route itself refuses, rather than merely being unlinked.
  await page.goto("/tasks");
  await expect(page.getByText("No access", { exact: true })).toBeVisible();

  await setModule(page, "Tasks", true);
  await page.goto("/tasks");
  await expect(page.getByText("No access", { exact: true })).toHaveCount(0);
});

test("a feature switch removes one page and leaves the rest of its module", async ({
  page,
}) => {
  await login(page);

  await setModule(page, "Phone Lines", false);

  await page.goto("/phone-lines");
  await expect(page.getByText("No access", { exact: true })).toBeVisible();

  // The rest of Asset Tracker is untouched.
  await page.goto("/asset-tracker");
  await expect(page.getByText("No access", { exact: true })).toHaveCount(0);

  await setModule(page, "Phone Lines", true);
  await page.goto("/phone-lines");
  await expect(page.getByText("No access", { exact: true })).toHaveCount(0);
});

test("the settings list stays usable at mobile width", async ({ page }) => {
  await login(page);
  await page.goto("/settings");

  await expect(
    page.getByText("Modules & features", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Search modules and features").fill("payroll");
  await expect(
    page.getByRole("switch", { name: "Turn Payroll off for everyone" }),
  ).toBeVisible();

  // The page must not scroll sideways on a narrow viewport.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
});
