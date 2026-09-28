import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const document = {
  id: "doc-1", name: "Agiomix Trade Licence.pdf", url: "https://example.sharepoint.com/doc",
  company_id: "company-1", company: "Agiomix", document_type: "trade_license",
  reference_number: "TL-123", expiry_date: "2026-12-15", renewal_date: null,
  notice_days: null, status: "active", processing_status: "ready", review_reasons: [],
  modified_at: null, uploaded_at: null, uploaded_by_email: null,
};
const task = {
  id: "task-1", document_id: "doc-1", document_name: document.name,
  title: "Renew Trade License", company: "Agiomix", document_type: "trade_license",
  due_date: "2026-12-15", basis: "expiry", status: "active", owner: "Alex Admin",
  owner_user_id: "admin-1", owner_department_id: null,
};

async function openView(page: Page, name: string) {
  if ((page.viewportSize()?.width ?? 0) >= 640) {
    await page.getByRole("tab", { name }).click();
    return;
  }
  await page.getByRole("combobox", { name: "Browse compliance" }).click();
  await page.getByRole("option", { name }).click();
}

test.beforeEach(async ({ page }) => {
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (!path.startsWith("/api/")) { await route.continue(); return; }
    let body: unknown = {};
    if (path === "/api/auth/me") body = {
      id: "admin-1", email: "admin@example.com", display_name: "Alex Admin",
      is_active: true, is_admin: true, role: "admin", status: "active",
      effective_permissions: ["sharepoint_intelligence"], managed_company_ids: [],
      created_at: "2026-01-01T00:00:00Z",
    };
    else if (path === "/api/settings/public") body = { platform_name: "Company Tools" };
    else if (path === "/api/companies" || path === "/api/notifications" || path === "/api/sharepoint/reminders") body = [];
    else if (path === "/api/notifications/unread-count") body = { count: 0 };
    else if (path === "/api/sharepoint/status") body = {
      enabled: true, configured: true, missing: [], connected: true,
      microsoft_sign_in_required: false, can_review: true, user_id: "admin-1",
      openai_configured: true, active_run: false, polling_enabled: true,
      scheduler_enabled: true, email_configured: false, teams_configured: true,
      sync_interval_seconds: 60, last_sync: null, run: null, languages: ["en"],
    };
    else if (path === "/api/sharepoint/compliance/dashboard") body = {
      summary: { expiring_60: 0, expiring_30: 0, due_this_week: 0, overdue: 0,
        needs_review: 0, unassigned: 0, tasks_by_owner: { "Alex Admin": 1 },
        documents_by_company: { Agiomix: 1 } },
      documents: [document], tasks: [task],
    };
    else if (path === "/api/sharepoint/compliance/options") body = {
      companies: [{ id: "company-1", name: "Agiomix" }],
      departments: [{ id: "finance-1", name: "Finance" }, { id: "admin-dept-1", name: "Admin" }],
      users: [{ id: "admin-1", name: "Alex Admin" }],
    };
    else if (path === "/api/sharepoint/compliance/rules") body = [];
    else if (path === "/api/sharepoint/documents/doc-1") body = {
      ...document, analysis: null, segments: [], compliance: {
        document_type: "trade_license", reference_number: { value: "TL-123" },
        expiry_date: { value: "2026-12-15" }, obligations: [],
      },
    };
    else if (path === "/api/sharepoint/compliance/documents/doc-1/history") body = {
      versions: [], events: [{ id: "event-1", action: "task_created", at: "2026-09-24T10:00:00Z", details: null }],
    };
    else if (path === "/api/sharepoint/compliance/tasks/task-1" && route.request().method() === "PATCH") body = { id: "task-1", status: "completed" };
    else if (path === "/api/sharepoint/compliance/tasks/task-1/assign" && route.request().method() === "POST") body = { id: "task-1", owner_department_id: "finance-1" };
    await route.fulfill({ json: body });
  });
});

test("compliance overview, register, tasks and detail work at desktop and mobile widths", async ({ page }) => {
  await page.goto("/sharepoint/compliance");
  await expect(page.getByRole("heading", { name: "Document Compliance" })).toBeVisible();
  await expect(page.getByText("Expiring in 60 days")).toBeVisible();
  if ((page.viewportSize()?.width ?? 0) < 640) await expect(page.getByRole("combobox", { name: "Browse compliance" })).toBeVisible();
  await openView(page, "Documents");
  await expect(page.getByText("Document register · 1")).toBeVisible();
  await openView(page, "Tasks");
  await expect(page.getByText("Compliance tasks · 1")).toBeVisible();
  await page.getByRole("button", { name: document.name }).first().click();
  await expect(page.getByRole("dialog").getByText("TL-123")).toBeVisible();
  await expect(page.getByRole("dialog").getByText("Action created")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("document filters use readable labels, narrow results, and reset cleanly", async ({ page }) => {
  await page.goto("/sharepoint/compliance");
  await openView(page, "Documents");
  const search = page.getByRole("textbox", { name: "Search documents" });
  await search.fill("missing reference");
  await expect(page.getByText("Document register · 0")).toBeVisible();
  await expect(page.getByRole("button", { name: "Clear filters" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Clear filters" })).toHaveClass(/border-foreground\/50/);
  await page.getByRole("button", { name: /More filters/ }).click();
  await expect(page.getByRole("combobox", { name: "Company" })).toContainText("All companies");
  await expect(page.getByRole("combobox", { name: "Document type" })).toContainText("All document types");
  await expect(page.getByRole("combobox", { name: "Status" })).toContainText("All statuses");
  await page.getByRole("combobox", { name: "Document type" }).click();
  await page.getByRole("option", { name: "Trade license" }).click();
  await expect(page.getByRole("combobox", { name: "Document type" })).toContainText("Trade license");
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(search).toHaveValue("");
  await expect(page.getByRole("combobox", { name: "Document type" })).toContainText("All document types");
  await expect(page.getByText("Document register · 1")).toBeVisible();
  await expect(page.getByRole("button", { name: "Clear filters" })).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
});

test("completing an owned task calls the task workflow", async ({ page }) => {
  await page.goto("/sharepoint/compliance");
  await openView(page, "Tasks");
  const request = page.waitForRequest((request) => request.url().endsWith("/api/sharepoint/compliance/tasks/task-1") && request.method() === "PATCH");
  await page.getByRole("button", { name: "Complete" }).first().click();
  expect((await request).postDataJSON()).toEqual({ status: "completed" });
});

test("a reviewer can change an active task owner with an audit reason", async ({ page }) => {
  await page.goto("/sharepoint/compliance");
  await openView(page, "Tasks");
  await page.getByRole("button", { name: "Change owner" }).click();
  const dialog = page.getByRole("dialog", { name: "Change task owner" });
  await expect(dialog.getByText("Current owner: Alex Admin")).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await dialog.getByRole("combobox", { name: "Assign to" }).click();
  await page.getByRole("option", { name: "Department" }).click();
  await dialog.getByRole("combobox", { name: "New owner" }).click();
  await page.getByRole("option", { name: "Finance" }).click();
  await dialog.getByRole("textbox", { name: "Reason for change" }).fill("Finance handles this renewal.");
  const request = page.waitForRequest((item) => item.url().endsWith("/api/sharepoint/compliance/tasks/task-1/assign") && item.method() === "POST");
  await dialog.getByRole("button", { name: "Save owner" }).click();
  expect((await request).postDataJSON()).toEqual({ owner_user_id: null, owner_department_id: "finance-1", note: "Finance handles this renewal." });
  await expect(dialog).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
});

test("governance edits a folder rule and shows real notification channel state", async ({ page }) => {
  await page.route("**/api/sharepoint/compliance/rules", (route) => route.fulfill({ json: [{
    id: "rule-1", company_id: null, document_type: null, folder_name: "Finance",
    owner_user_id: null, owner_department_id: "finance-1", reminder_leads: [30, 7, 0, -1],
    priority: 100, is_active: true,
  }] }));
  await page.route("**/api/sharepoint/compliance/rules/rule-1", (route) => route.fulfill({ json: { id: "rule-1" } }));
  await page.route("**/api/sharepoint/reminders?category=compliance_task", (route) => route.fulfill({ json: [{
    id: "reminder-1", task_id: "task-1", document_id: "doc-1", document_name: document.name,
    title: "Renew Trade License", category: "compliance_task", target_date: "2026-12-15",
    reminder_date: "2026-09-24", lead_days: 60, responsible_name: "Alex Admin",
    recipient_email: "admin@example.com", amount: null, currency: null,
    status: "sent", sent_at: "2026-09-24T10:00:00Z", delivery_channels: ["teams"],
  }] }));
  await page.goto("/sharepoint/compliance");
  await openView(page, "Governance");
  await expect(page.getByText("Finance folder · Any · Any document type")).toBeVisible();
  await expect(page.getByText("Teams configured")).toBeVisible();
  await expect(page.getByText("Email off")).toBeVisible();
  await expect(page.getByText("Sent via teams")).toBeVisible();
  expect((await new AxeBuilder({ page }).include('[role="tabpanel"]').analyze()).violations).toEqual([]);
  await page.getByRole("button", { name: "Edit" }).click();
  await expect(page.getByRole("textbox", { name: "SharePoint folder name" })).toHaveValue("Finance");
  await page.getByRole("combobox", { name: "Responsible owner" }).click();
  await page.getByRole("option", { name: "Admin" }).click();
  const request = page.waitForRequest((item) => item.url().endsWith("/api/sharepoint/compliance/rules/rule-1") && item.method() === "PUT");
  await page.getByRole("button", { name: "Save changes" }).click();
  expect((await request).postDataJSON()).toMatchObject({ folder_name: "Finance", owner_department_id: "admin-dept-1" });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
});

test("uncertain extraction waits for a reviewer before activating tasks", async ({ page }) => {
  await page.route("**/api/sharepoint/compliance/dashboard", (route) => route.fulfill({ json: {
    summary: { expiring_60: 0, expiring_30: 0, due_this_week: 0, overdue: 0,
      needs_review: 1, unassigned: 0, tasks_by_owner: {}, documents_by_company: { Agiomix: 1 } },
    documents: [{ ...document, status: "needs_review", review_reasons: ["notice_period"] }], tasks: [],
  } }));
  await page.route("**/api/sharepoint/compliance/documents/doc-1/review", (route) => route.fulfill({ json: { status: "active", tasks_created: 1 } }));
  await page.goto("/sharepoint/compliance");
  const reviewAction = page.getByRole("button", { name: "Open review queue" });
  await expect(reviewAction).toBeVisible();
  if ((page.viewportSize()?.width ?? 0) >= 640) {
    const actionBox = await reviewAction.boundingBox();
    const badgeBox = await page.getByText("Action needed").boundingBox();
    expect(actionBox && badgeBox && Math.abs(actionBox.y - badgeBox.y) < 8).toBeTruthy();
    expect(actionBox && badgeBox && actionBox.x > badgeBox.x + 200).toBeTruthy();
  }
  await openView(page, "Review");
  await expect(page.getByText("Needs review · 1")).toBeVisible();
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page.getByLabel("Review note (optional)")).toBeVisible();
  const request = page.waitForRequest((item) => item.url().endsWith("/api/sharepoint/compliance/documents/doc-1/review") && item.method() === "POST");
  await page.getByRole("button", { name: "Verify and create tasks" }).click();
  expect((await request).postDataJSON()).toMatchObject({ company_id: "company-1", document_type: "trade_license", review_note: null });
});
