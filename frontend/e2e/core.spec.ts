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


/**
 * Sign in with the bootstrap administrator.
 *
 * There is no dev-login shortcut any more, so these specs use the real
 * password form. Override the credentials when running against a stack whose
 * seed password has already been rotated.
 */
const EMAIL = process.env.E2E_EMAIL || "admin@agholding.net";
const PASSWORD = process.env.E2E_PASSWORD || "admin";

async function signIn(page: import("@playwright/test").Page) {
  await page.goto("/login", NAV);
  await page.getByPlaceholder("you@agholding.net").fill(EMAIL);
  await page.locator('input[type="password"]').first().fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();

  // A brand-new database forces the seed admin to choose a password first.
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
}

test("password login → dashboard loads", async ({ page }) => {
  await signIn(page);
  await expect(page).toHaveTitle(/AG Holding/);
});

test("navigation links work", async ({ page }) => {
  await signIn(page);
  await page.goto("/crm", NAV);
  await expect(page).toHaveURL(/\/crm/);
  await page.goto("/campaigns", NAV);
  await expect(page).toHaveURL(/\/campaigns/);
});

test("unknown route shows 404", async ({ page }) => {
  await signIn(page);
  await page.goto("/totally-unknown-path", NAV);
  await expect(page.getByText("404")).toBeVisible();
  await expect(page.getByText("Page not found")).toBeVisible();
});

test("no horizontal overflow at 390px", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await signIn(page);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1,
  );
  expect(overflow).toBeFalsy();
});

test.describe("installed-app shell", () => {
  test("manifest, icons and theme colour are served", async ({ page, request }) => {
    await page.goto("/login", NAV);
    await expect(page.locator('link[rel="manifest"]')).toHaveCount(1);
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute(
      "content",
      /#/,
    );
    expect((await request.get("/manifest.webmanifest")).ok()).toBeTruthy();
    expect((await request.get("/icons/icon-192.png")).ok()).toBeTruthy();
    expect((await request.get("/icons/icon-512.png")).ok()).toBeTruthy();
  });
});

test.describe("phone ergonomics", () => {
  test.skip(
    ({ viewport }) => !viewport || viewport.width > 640,
    "phone-sized viewports only",
  );

  test("controls are thumb-sized and inputs don't trigger iOS zoom", async ({ page }) => {
    await signIn(page);
    await page.goto("/service-desk", NAV);

    // Every visible field must be >= 16px, or iOS zooms the page on focus.
    const tooSmall = await page.evaluate(() =>
      [...document.querySelectorAll("input, select, textarea")]
        .filter((el) => {
          const e = el as HTMLInputElement;
          if (["checkbox", "radio", "hidden", "color"].includes(e.type)) return false;
          const cs = getComputedStyle(e);
          if (cs.display === "none" || cs.visibility === "hidden") return false;
          return parseFloat(cs.fontSize) < 16;
        })
        .map((el) => el.className || el.tagName),
    );
    expect(tooSmall).toEqual([]);

    // Primary buttons need a real touch target.
    const shortButtons = await page.evaluate(() =>
      [...document.querySelectorAll("button")]
        .filter((b) => {
          const r = b.getBoundingClientRect();
          return r.height > 0 && r.height < 36;
        })
        .map((b) => b.textContent?.trim().slice(0, 30) || "(icon)"),
    );
    expect(shortButtons).toEqual([]);
  });

  test("the bottom tab bar shows and is permission-filtered", async ({ page }) => {
    await signIn(page);
    const tabbar = page.locator(".tabbar");
    await expect(tabbar).toBeVisible();
    // Admin sees every tab plus "More".
    await expect(tabbar.locator("a")).toHaveCount(5);
    await tabbar.getByText("Tickets").click();
    await expect(page).toHaveURL(/\/service-desk/);
  });

  test("wide tables stack into labelled cards", async ({ page }) => {
    await signIn(page);
    await page.goto("/service-desk", NAV);
    const table = page.locator("table.table-stack");
    await expect(table).toBeVisible();
    const rowDisplay = await table
      .locator("tbody tr")
      .first()
      .evaluate((el) => getComputedStyle(el).display);
    expect(rowDisplay).toBe("block");
  });

  test("modals dock to the bottom as sheets", async ({ page }) => {
    await signIn(page);
    await page.goto("/expenses", NAV);
    await page.getByRole("button", { name: /new claim/i }).click();
    const modal = page.locator(".modal");
    await expect(modal).toBeVisible();
    // The sheet slides up; measure once it has settled, not mid-transform.
    await modal.evaluate((el) =>
      Promise.all(el.getAnimations().map((a) => a.finished.catch(() => {}))),
    );
    const box = await modal.boundingBox();
    const viewport = page.viewportSize()!;
    expect(box).not.toBeNull();
    // Flush to the bottom and full width — a sheet, not a floating dialog.
    expect(Math.abs(box!.y + box!.height - viewport.height)).toBeLessThan(2);
    expect(Math.abs(box!.width - viewport.width)).toBeLessThan(2);
  });
});
