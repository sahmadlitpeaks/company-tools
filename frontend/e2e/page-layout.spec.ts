import { expect, test } from "@playwright/test";

const user = {
  id: "user-1",
  email: "admin@agholding.net",
  display_name: "Admin User",
  given_name: "Admin",
  is_active: true,
  is_admin: true,
  role: "admin",
  status: "active",
  effective_permissions: [],
  managed_company_ids: [],
  created_at: "2026-01-01T00:00:00Z",
};

const company = {
  id: "ag",
  slug: "ag-holding",
  name: "AG Holding",
  primary_color: "#facc15",
  secondary_color: "#71717a",
  accent_color: "#facc15",
  is_active: true,
  is_default: true,
  created_at: "2026-01-01T00:00:00Z",
};

const routes = [
  "/", "/directory", "/cards", "/marketing-assets", "/branding", "/products",
  "/shared", "/asset-tracker", "/phone-lines", "/subscriptions", "/profile",
  "/org-chart", "/performance", "/hr", "/hr/custom-fields", "/hr/automations",
  "/reports", "/payroll", "/benefits", "/engagement", "/expenses", "/training",
  "/security", "/recruiting", "/time", "/tasks", "/approvals", "/leave",
  "/service-desk", "/cafe", "/bookings", "/visitors", "/purchases", "/calendar",
  "/ideas", "/ai-help", "/lost-found", "/knowledge", "/announcements", "/people-ops",
  "/hub", "/work-log", "/my-docs", "/crm", "/inbox", "/campaigns", "/qrcodes",
  "/landing-pages", "/signatures", "/shortener", "/transfers", "/companies",
  "/departments", "/audit", "/settings", "/webhooks", "/approval-workflows",
  "/api-tokens",
] as const;

test.beforeEach(async ({ page }) => {
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (!path.startsWith("/api/")) {
      await route.continue();
      return;
    }

    let body: unknown = [];
    if (path === "/api/auth/me") body = user;
    else if (path === "/api/companies") body = [company];
    else if (path === "/api/notifications/unread-count") body = { count: 0 };
    else if (path === "/api/auth/mfa/status") body = { enabled: false };
    else if (path === "/api/me/home") body = { celebrations: [], whos_out: [] };
    else if (path === "/api/analytics/overview") body = { counts: {}, engagement: { total_link_clicks: 0, total_card_scans: 0 }, series: { clicks: [], scans: [] }, assets: { by_status: {}, total_book_value: "0", warranty_alerts: [] }, recent_activity: [] };
    else if (path === "/api/me/dashboard-preferences") body = { widget_order: [], hidden_widgets: [], available_widgets: [], is_default: true };
    else if (path === "/api/me/work") body = { tasks_open: 0, tasks_overdue: 0, approvals_pending: 0, approvals_to_review: 0, tickets_open: 0, tickets_assigned: 0, announcements_unread: 0, onboarding_open: 0, my_tasks: [], my_approvals: [], review_approvals: [], my_tickets: [], my_onboarding_tasks: [] };
    else if (path === "/api/leave/balance") body = { user_id: user.id, year: 0, entitlement_days: 0, used_days: 0, remaining_days: 0, by_type: [] };
    else if (path === "/api/hr/overview") body = { headcount: 0, on_leave_today: 0, pending_leave: 0, docs_expiring: 0, contracts_expiring: 0, probation_ending: 0, open_review_cycles: 0, open_journeys: 0, by_department: [], by_employment_type: [], recent_joiners: [], upcoming_joiners: [] };
    else if (path === "/api/custom-fields/schema") body = { fields: [], tables: [] };
    else if (path === "/api/hr/automations") body = { config: {}, catalogue: [], last_run: null, last_result: null, outbound_enabled: false, scheduler_enabled: false };
    else if (path === "/api/time/timesheet") body = { id: null, user_id: user.id, week_start: "", status: "open", total_minutes: 0, expected_minutes: 0, overtime_minutes: 0, leave_days: 0, entries: [] };
    else if (/^\/api\/profiles\/(?:me|[^/]+)$/.test(path)) body = { id: user.id, role: "member", status: "active", is_admin: false, direct_reports: [], modules: [], access_grants: [], subscriptions: [], assets: [], phones: [], open_tasks: [], journeys: [], events: [], can_manage: false, can_see_sensitive: false };
    else if (/^\/api\/custom-fields\/values\/[^/]+$/.test(path)) body = { fields: [], tables: [], can_edit: false };
    else if (path === "/api/phone-lines/summary") body = { total: 0, assigned: 0, monthly_cost: "0", by_status: {} };
    else if (path === "/api/subscriptions/summary") body = { total: 0, monthly_spend: "0", renewing_soon: 0, by_status: {} };
    else if (path === "/api/audit") body = { items: [], actions: [], entity_types: [], has_more: false };
    else if (path === "/api/reports/catalog") body = [];

    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
});

test.setTimeout(120_000);

test("every internal page renders without viewport overflow", async ({ page }) => {
  for (const path of routes) {
    const errors: string[] = [];
    const onPageError = (error: Error) => errors.push(error.message);
    page.on("pageerror", onPageError);

    if (path === "/api-tokens") {
      await page.goto("/");
      await page.evaluate((target) => {
        history.pushState({}, "", target);
        dispatchEvent(new PopStateEvent("popstate"));
      }, path);
    } else {
      await page.goto(path);
    }
    await page.waitForTimeout(75);
    await expect(page.locator("main").first(), `main landmark on ${path}`).toBeVisible();
    expect(errors, `render errors on ${path}`).toEqual([]);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
      `viewport overflow on ${path}`,
    ).toBe(true);

    page.off("pageerror", onPageError);
  }
});
