import { expect, test, type Page } from "@playwright/test";

const KPIS = {
  spend: "0", impressions: 0, clicks: 0, conversions: 0, revenue: "0",
  ctr: 0, cpc: "0", cpm: "0", cpa: "0", conversion_rate: 0, roas: 0,
};

const SYNCED_CAMPAIGN = {
  id: "c1",
  company_id: null,
  name: "Summer Sale",
  objective: "Sales",
  status: "active",
  start_date: null,
  end_date: null,
  notes: null,
  created_at: "2026-08-01T00:00:00Z",
  provider: "meta",
  external_id: "111",
  kpis: { ...KPIS, spend: "367.25", conversions: 10, roas: 2.45 },
};

async function mockPlatform(page: Page, options: { runs?: unknown[]; syncResult?: unknown[] } = {}) {
  await page.route("**/api/auth/me", (route) => route.fulfill({
    json: {
      id: "u1", email: "admin@example.com", display_name: "Administrator",
      job_title: "Admin", department: "IT", business_phone: null,
      is_active: true, is_admin: true, must_change_password: false,
      role: "admin", status: "active",
      effective_permissions: ["dashboard", "campaigns"],
      managed_company_ids: [], created_at: "2026-08-01T00:00:00Z",
    },
  }));
  await page.route("**/api/companies", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/campaigns/overview*", (route) => route.fulfill({
    json: { totals: KPIS, by_channel: [], campaigns: [] },
  }));
  await page.route("**/api/campaigns/sync/runs", (route) => route.fulfill({
    json: options.runs ?? [],
  }));
  await page.route("**/api/campaigns/sync", (route) => route.fulfill({
    json: options.syncResult ?? [
      { provider: "meta", ok: false, skipped: true, campaigns_synced: 0, metrics_upserted: 0, error: "Not configured" },
      { provider: "google_ads", ok: false, skipped: true, campaigns_synced: 0, metrics_upserted: 0, error: "Not configured" },
      { provider: "tiktok", ok: false, skipped: true, campaigns_synced: 0, metrics_upserted: 0, error: "Not configured" },
    ],
  }));
  // Must come last: the bare /api/campaigns pattern would otherwise swallow
  // the more specific /overview and /sync routes above.
  await page.route("**/api/campaigns", (route) => route.fulfill({ json: [SYNCED_CAMPAIGN] }));
}

test.describe("Campaign Studio sync", () => {
  test("exposes a sync control and badges the source platform", async ({ page }) => {
    await mockPlatform(page);
    await page.goto("/campaigns");
    await expect(page.getByRole("button", { name: /sync now/i })).toBeVisible();
    await expect(page.getByText("meta", { exact: true })).toBeVisible();
  });

  test("says so plainly when no ad accounts are connected", async ({ page }) => {
    await mockPlatform(page);
    await page.goto("/campaigns");
    await page.getByRole("button", { name: /sync now/i }).click();
    await expect(page.getByText(/no ad accounts are connected/i)).toBeVisible();
  });

  test("surfaces the provider error when a run failed", async ({ page }) => {
    await mockPlatform(page, {
      runs: [{
        provider: "meta", started_at: "2026-08-14T02:00:00Z",
        finished_at: "2026-08-14T02:00:05Z", ok: false,
        campaigns_synced: 0, metrics_upserted: 0,
        error: "Meta: Invalid OAuth access token.",
      }],
    });
    await page.goto("/campaigns");
    await expect(page.getByText(/invalid oauth access token/i)).toBeVisible();
  });

  test("does not overflow horizontally", async ({ page }) => {
    await mockPlatform(page, {
      runs: [{
        provider: "meta", started_at: "2026-08-14T02:00:00Z",
        finished_at: "2026-08-14T02:00:05Z", ok: true,
        campaigns_synced: 2, metrics_upserted: 120, error: null,
      }],
    });
    await page.goto("/campaigns");
    await expect(page.getByRole("button", { name: /sync now/i })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflow).toBe(false);
  });
});
