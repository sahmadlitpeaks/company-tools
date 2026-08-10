import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const user = {
  id: "manager-1",
  email: "manager@example.com",
  display_name: "Morgan Lee",
  given_name: "Morgan",
  job_title: "Facilities Manager",
  is_active: true,
  is_admin: true,
  role: "admin",
  status: "active",
  effective_permissions: ["routine_checks"],
  managed_company_ids: [],
  created_at: "2026-01-01T00:00:00Z",
};

const template = {
  id: "template-1",
  name: "Morning facilities round",
  description: "Open the building safely before staff arrive.",
  active: true,
  team: "facilities",
  schedule: "weekdays",
  days_of_week: null,
  day_of_month: null,
  due_time: "08:30",
  grace_minutes: 30,
  assignee_id: null,
  assignee_name: null,
  assignee_department_id: "department-1",
  assignee_department_name: "Facilities",
  reviewer_id: "manager-1",
  reviewer_name: "Morgan Lee",
  company_id: null,
  requires_verification: true,
  item_count: 3,
  next_run_date: "2026-07-31",
  created_at: "2026-07-01T08:00:00Z",
  items: [],
};

const run = {
  id: "run-1",
  title: "Morning facilities round",
  template_name: "Morning facilities round",
  status: "in_progress",
  run_date: "2026-07-30",
  due_date: "2026-07-30T08:30:00Z",
  template_id: "template-1",
  team: "facilities",
  assignee_id: "manager-1",
  assignee_name: "Morgan Lee",
  reviewer_id: "manager-1",
  reviewer_name: "Morgan Lee",
  started_at: "2026-07-30T08:00:00Z",
  submitted_at: null,
  verified_at: null,
  verified_by_id: null,
  verified_by_name: null,
  review_note: null,
  created_at: "2026-07-30T07:55:00Z",
  items_total: 3,
  items_answered: 1,
  issues: 0,
  is_late: false,
};

test.beforeEach(async ({ page }) => {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    let body: unknown = {};

    if (path === "/api/auth/me") body = user;
    else if (path === "/api/auth/mfa/status") body = { enabled: false };
    else if (path === "/api/companies" || path === "/api/notifications") body = [];
    else if (path === "/api/notifications/unread-count") body = { count: 0 };
    else if (path === "/api/checklist-templates") body = [template];
    else if (path === "/api/checklist-runs/summary") {
      body = {
        from_date: "2026-07-01",
        to_date: "2026-07-30",
        runs: 22,
        verified: 20,
        late: 1,
        issues: 3,
        completion_rate: 91,
        by_template: [
          {
            template_id: "template-1",
            template_name: "Morning facilities round",
            team: "facilities",
            runs: 22,
            verified: 20,
            submitted: 1,
            open: 1,
            late: 1,
            issues: 3,
            completion_rate: 91,
          },
        ],
        hotspots: [
          {
            title: "Check emergency exit",
            section: "Ground floor",
            asset_id: null,
            asset_name: null,
            issue_count: 2,
            last_seen: "2026-07-29T08:15:00Z",
          },
        ],
      };
    } else if (path === "/api/checklist-runs/run-1") {
      body = {
        ...run,
        description: "Open the building safely before staff arrive.",
        items: [
          {
            id: "item-1",
            task_id: "run-1",
            section: "Ground floor",
            title: "Check emergency exit",
            sort: 0,
            status: "ok",
            note: null,
            response_type: "ok_issue",
            value: null,
            photo_required: true,
            done: true,
            asset_id: null,
            asset_name: null,
            ticket_id: null,
            ticket_number: null,
            responded_by_id: "manager-1",
            responded_by_name: "Morgan Lee",
            responded_at: "2026-07-30T08:05:00Z",
            photo_count: 1,
          },
          {
            id: "item-2",
            task_id: "run-1",
            section: "Ground floor",
            title: "Record lobby temperature",
            sort: 1,
            status: "pending",
            note: null,
            response_type: "number",
            value: null,
            photo_required: false,
            done: false,
            asset_id: null,
            asset_name: "Lobby sensor",
            ticket_id: null,
            ticket_number: null,
            responded_by_id: null,
            responded_by_name: null,
            responded_at: null,
            photo_count: 0,
          },
          {
            id: "item-3",
            task_id: "run-1",
            section: "First floor",
            title: "Unlock meeting rooms",
            sort: 2,
            status: "pending",
            note: null,
            response_type: "done",
            value: null,
            photo_required: false,
            done: false,
            asset_id: null,
            asset_name: null,
            ticket_id: null,
            ticket_number: null,
            responded_by_id: null,
            responded_by_name: null,
            responded_at: null,
            photo_count: 0,
          },
        ],
      };
    } else if (path === "/api/checklist-runs") body = [run];
    else if (path === "/api/attachments") body = [];

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
});

test("routine checks uses shadcn controls across operational views", async ({ page }, testInfo) => {
  await page.goto("/routine-checks");
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("heading", { name: "Routine Checks" })).toBeVisible();
  await expect(page.locator("select")).toHaveCount(0);

  const teamFilter = page.getByLabel("Team", { exact: true }).first();
  await teamFilter.click();
  await expect(page.getByRole("listbox")).toBeVisible();
  await page.getByRole("option", { name: "Facilities" }).click();
  await expect(teamFilter).toContainText("Facilities");
  await page.screenshot({ path: testInfo.outputPath("rounds.png"), fullPage: true });

  await page.getByRole("button", { name: /Open (Morning facilities round|round)/ }).click();
  const dialog = page.getByRole("dialog", { name: "Morning facilities round" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: /OK: Check emergency exit/ })).toBeVisible();
  await expect(dialog.getByLabel("Numeric reading")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Submit for verification" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("round.png"), fullPage: true });
  await page.keyboard.press("Escape");

  await page.getByRole("tab", { name: "Compliance" }).click();
  const period = page.getByLabel("Period");
  await period.click();
  await expect(page.getByRole("listbox")).toBeVisible();
  await page.getByRole("option", { name: "Last 90 days" }).click();
  await expect(period).toContainText("Last 90 days");
  await expect(page.locator("select")).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("compliance.png"), fullPage: true });

  const accessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  expect(
    accessibility.violations.filter(
      (violation) => violation.impact === "serious" || violation.impact === "critical",
    ),
  ).toEqual([]);
});
