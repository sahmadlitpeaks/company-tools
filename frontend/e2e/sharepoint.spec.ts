import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const user = {
  id: "admin-1",
  email: "admin@example.com",
  display_name: "Alex Admin",
  is_active: true,
  is_admin: true,
  role: "admin",
  status: "active",
  effective_permissions: ["sharepoint_intelligence"],
  managed_company_ids: [],
  created_at: "2026-01-01T00:00:00Z",
};

const readyStatus = {
  enabled: true,
  configured: true,
  missing: [],
  connected: true,
  microsoft_sign_in_required: false,
  can_review: true,
  user_id: "admin-1",
  openai_configured: true,
  active_run: false,
  polling_enabled: true,
  sync_interval_seconds: 60,
  last_sync: null,
  run: null,
  languages: ["ar", "en"],
};

const document = {
  id: "doc-1",
  name: "خطة المشروع – Project plan.txt",
  url: "https://example.sharepoint.com/document",
  status: "ready",
  error_code: null,
  languages: ["ar", "en"],
  modified_at: "2026-09-15T10:00:00Z",
  requires_attention: true,
  segments: [
    { id: "s1", location: "Text", text: "أحمد يراجع المشروع. Alice must review by 2026-10-02." },
  ],
  analysis: {
    sections: [
      {
        summary: "أحمد يراجع المشروع قبل الموعد المحدد.",
        summary_evidence: [{ segment_id: "s1", quote: "أحمد يراجع المشروع." }],
        tasks: [
          {
            title: "Review project",
            owner: "Alice",
            deadline: "2026-10-02",
            status: "pending",
            priority: "unknown",
            evidence: [{ segment_id: "s1", quote: "Alice must review by 2026-10-02." }],
          },
        ],
        deadlines: [],
        risks: [],
        blockers: [],
        contacts: [],
        project_status: null,
        requires_attention: true,
      },
    ],
    requires_attention: true,
  },
};

test.beforeEach(async ({ page }) => {
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (!path.startsWith("/api/")) {
      await route.continue();
      return;
    }
    let body: unknown = {};
    if (path === "/api/auth/me") body = user;
    else if (path === "/api/settings/public") body = { platform_name: "Company Tools" };
    else if (
      path === "/api/companies" ||
      path === "/api/notifications" ||
      path === "/api/sharepoint/reminders"
    )
      body = [];
    else if (path === "/api/notifications/unread-count") body = { count: 0 };
    else if (path === "/api/sharepoint/status") body = readyStatus;
    else if (path === "/api/sharepoint/search") body = { items: [document], next_cursor: null };
    else if (path === "/api/sharepoint/documents/doc-1") body = document;
    await route.fulfill({ json: body });
  });
});

test("multilingual document details preserve direction, evidence and mobile layout", async ({ page }) => {
  const componentErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && message.text().includes("Base UI:")) {
      componentErrors.push(message.text());
    }
  });

  await page.goto("/sharepoint");
  await expect(page.getByRole("heading", { name: /Good (morning|afternoon|evening)/ })).toBeVisible();

  // Button to view the document from either home or documents tab
  await page.getByRole("button", { name: /View (document|خطة)/ }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: document.name })).toBeVisible();

  const arabic = dialog.getByText(document.analysis.sections[0].summary);
  await expect(arabic).toHaveAttribute("dir", "auto");
  expect(await arabic.evaluate((element) => getComputedStyle(element).direction)).toBe("rtl");

  await expect(dialog.getByText("Alice", { exact: true })).toBeVisible();
  await expect(dialog.getByText("2026-10-02", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("link", { name: "Open in SharePoint" })).toHaveAttribute(
    "href",
    document.url
  );

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
  expect(componentErrors).toEqual([]);
});

test("contact findings omit unknown priority and status badges", async ({ page }) => {
  await page.route("**/api/sharepoint/documents/doc-1", (route) => route.fulfill({ json: {
    ...document, analysis: { ...document.analysis, sections: [{
      ...document.analysis.sections[0], tasks: [], contacts: [{
        title: "General Manager", owner: "Nassim,Marie Hambouz", deadline: null,
        status: "unknown", priority: "unknown",
        evidence: [{ segment_id: "s1", quote: "General Manager" }],
      }],
    }] },
  } }));
  await page.goto("/sharepoint");
  await page.getByRole("button", { name: /View (document|خطة)/ }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("General Manager", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Unknown", { exact: true })).toHaveCount(0);
});

test("document details show a compact estimated AI cost", async ({ page }) => {
  await page.route("**/api/sharepoint/documents/doc-1", (route) => route.fulfill({ json: {
    ...document, model: "gpt-5.6-luna", processed_at: "2026-09-24T15:47:00Z",
    usage: { input_tokens: 2559, output_tokens: 1458 },
  } }));
  await page.goto("/sharepoint");
  await page.getByRole("button", { name: /View (document|خطة)/ }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("AI analysis", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Estimated cost <$0.01")).toBeVisible();
  await expect(dialog.getByText(/Input Tokens|Output Tokens|\/M in/)).toHaveCount(0);
});

test("home attention appears on alerts page without generated reminders", async ({ page }) => {
  await page.goto("/sharepoint");
  await expect(page.getByText("1 thing needs your attention")).toBeVisible();
  await page.getByRole("button", { name: /See all alerts and reminders/ }).click();
  await expect(page).toHaveURL(/\/sharepoint\/alerts$/);
  await expect(page.getByRole("heading", { name: "Documents needing attention" })).toBeVisible();
  await expect(page.getByText(document.name)).toBeVisible();
  await expect(page.getByText("No alerts or reminders")).toHaveCount(0);
});

test("authorized users see unassigned reminders on alerts page", async ({ page }) => {
  await page.route("**/api/auth/me", (route) => route.fulfill({ json: { ...user, is_admin: false, role: "member" } }));
  await page.route("**/api/sharepoint/reminders", (route) => route.fulfill({ json: [{
    id: "unassigned-1", document_id: "doc-1", title: "Renew trade licence",
    category: "renewal", target_date: "2026-12-15", reminder_date: "2026-10-16",
    lead_days: 60, recipient_email: null, responsible_name: null, status: "pending",
  }] }));
  await page.goto("/sharepoint/alerts");
  await expect(page.getByRole("heading", { name: "Renew trade licence" })).toBeVisible();
});

test("revoked access never leaves a stale document body visible", async ({ page }) => {
  await page.goto("/sharepoint");
  await page.getByRole("button", { name: /View (document|خطة)/ }).first().click();
  await expect(page.getByRole("dialog").getByText("Alice", { exact: true })).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();

  await page.route("**/api/sharepoint/documents/doc-1", (route) =>
    route.fulfill({ status: 403, json: { detail: "document_access_denied" } })
  );

  await page.getByRole("button", { name: /View (document|خطة)/ }).first().click();
  await expect(page.getByRole("dialog").getByText(/document access denied/)).toBeVisible();
  await expect(page.getByRole("dialog").getByText("Alice", { exact: true })).toHaveCount(0);
});

test("disabled setup is clear", async ({ page }) => {
  await page.route("**/api/sharepoint/status", (route) =>
    route.fulfill({
      json: { ...readyStatus, enabled: false, configured: false, missing: ["SHAREPOINT_CLIENT_ID"] },
    })
  );
  await page.goto("/sharepoint");
  await expect(page.getByText("SharePoint setup required", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sync now" })).toHaveCount(0);

});

test("pagination limits items to 20 per page and supports navigation", async ({ page }) => {
  const documents = Array.from({ length: 25 }, (_, i) => ({
    id: `doc-${i + 1}`,
    name: `Document ${i + 1}.txt`,
    url: "https://example.sharepoint.com/doc",
    status: "ready",
    error_code: null,
    languages: ["en"],
    modified_at: null,
    requires_attention: false,
    segments: [],
    analysis: null,
  }));

  await page.route("**/api/sharepoint/search**", async (route) => {
    const postData = route.request().postDataJSON() as { q?: string; cursor?: string | null } | null;
    const cursor = postData?.cursor;
    if (!cursor) {
      await route.fulfill({
        json: { items: documents.slice(0, 20), next_cursor: "cursor-page-2" },
      });
    } else {
      await route.fulfill({
        json: { items: documents.slice(20), next_cursor: null },
      });
    }
  });

  await page.goto("/sharepoint?tab=documents");
  await expect(page.getByRole("navigation", { name: "pagination" })).toBeVisible();
  await expect(page.getByText("Showing 20 documents (Max 20 per page)")).toBeVisible();

  const nextBtn = page.getByRole("button", { name: "Go to next page" });
  await expect(nextBtn).toBeEnabled();
  await nextBtn.click();

  await expect(page.getByText("Showing 5 documents (Max 20 per page)")).toBeVisible();
  const prevBtn = page.getByRole("button", { name: "Go to previous page" });
  await expect(prevBtn).toBeEnabled();
  await prevBtn.click();

  await expect(page.getByText("Showing 20 documents (Max 20 per page)")).toBeVisible();
});

test("Alerts & reminders displays timeline groups, actions, and responds without horizontal overflow", async ({ page }) => {
  const now = new Date();
  const overdueDate = new Date(now.getTime() - 86400000 * 3).toISOString().slice(0, 10);
  const thisWeekDate = new Date(now.getTime() + 86400000 * 2).toISOString().slice(0, 10);

  const reminders = [
    {
      id: "rem-1",
      title: "Quarterly Audit Report Filing",
      category: "task",
      status: "pending",
      target_date: overdueDate,
      lead_days: 7,
      recipient_email: "responsible.person@example.com",
      responsible_name: "Responsible Person",
      document_id: "doc-1",
      document_name: "Audit 2026.docx",
      document_path: "/Shared Documents/Audit 2026.docx",
      document_url: "https://example.sharepoint.com/doc",
      amount: 50000,
      currency: "USD",
    },
    {
      id: "rem-2",
      title: "Commercial Lease Renewal",
      category: "renewal",
      status: "pending",
      target_date: thisWeekDate,
      lead_days: 7,
      recipient_email: "responsible.person@example.com",
      responsible_name: "Responsible Person",
      document_id: "doc-1",
      document_name: "Lease 2026.docx",
      document_path: "/Shared Documents/Lease 2026.docx",
      document_url: "https://example.sharepoint.com/doc",
    },
  ];

  await page.route("**/api/sharepoint/reminders**", (route) => route.fulfill({ json: reminders }));
  await page.goto("/sharepoint/alerts");
  await expect(page.getByRole("heading", { name: "Alerts & reminders", exact: true })).toBeVisible();

  // Verify timeline group headings
  await expect(page.getByRole("heading", { name: "Overdue" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "This week" })).toBeVisible();

  // Verify reminder items and actions
  await expect(page.getByRole("heading", { name: "Quarterly Audit Report Filing" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Commercial Lease Renewal" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Mark done" }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Snooze" }).first()).toBeVisible();

  // Verify no page-level horizontal overflow
  const metrics = await page.evaluate(() => ({
    windowInnerWidth: window.innerWidth,
    htmlScrollWidth: document.documentElement.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth,
    mainClientWidth: document.querySelector("main")?.clientWidth,
    mainScrollWidth: document.querySelector("main")?.scrollWidth,
  }));

  expect(metrics.htmlScrollWidth).toBeLessThanOrEqual(metrics.windowInnerWidth);
  expect(metrics.bodyScrollWidth).toBeLessThanOrEqual(metrics.windowInnerWidth);
  expect(metrics.mainScrollWidth).toBeLessThanOrEqual(metrics.mainClientWidth!);
});

test("notification stages for one compliance task appear as one action", async ({ page }) => {
  const targetDate = "2027-07-31";
  const reminders = [60, 30, 28, 21, 14, 7, 6, 5, 4, 3, 2, 1, 0].map((leadDays) => ({
    id: `rem-${leadDays}`, task_id: "task-1", document_id: "doc-1",
    document_name: "Agiomix Trade Licence.pdf", title: "Renew Trade License",
    category: "compliance_task", target_date: targetDate,
    reminder_date: new Date(Date.UTC(2027, 6, 31 - leadDays)).toISOString().slice(0, 10),
    lead_days: leadDays, recipient_email: user.email, responsible_name: user.display_name,
    status: "pending",
  }));
  await page.route("**/api/sharepoint/reminders", (route) => route.fulfill({ json: reminders }));
  await page.goto("/sharepoint/alerts");
  await expect(page.getByText("1 action · 13 scheduled reminders · 1 document needs attention")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Renew Trade License" })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Mark done" })).toHaveCount(1);
  await expect(page.getByText("One action · 13 scheduled reminders", { exact: false })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
});

test("Documents sidebar group renders navigation items and urgent badge", async ({ page }, testInfo) => {
  const urgentReminders = [
    {
      id: "rem-1",
      title: "Expiring soon",
      category: "expiry",
      status: "pending",
      target_date: new Date(Date.now() + 86400000 * 5).toISOString().slice(0, 10),
      lead_days: 7,
      recipient_email: "test@example.com",
      responsible_name: "Tester",
      document_id: "doc-1",
      document_name: "License.pdf",
    },
  ];
  await page.route("**/api/sharepoint/reminders**", (route) => route.fulfill({ json: urgentReminders }));
  await page.goto("/sharepoint");

  if (testInfo.project.name === "mobile") {
    await page.getByRole("button", { name: "Open navigation menu" }).click();
  }

  const navigation = testInfo.project.name === "mobile"
    ? page.locator('[data-slot="sidebar"][data-mobile="true"]')
    : page.locator('[data-slot="sidebar-inner"]');

  const documentsGroup = navigation.locator('[data-slot="sidebar-group"]', { hasText: "Documents" });
  await expect(documentsGroup.getByText("Documents", { exact: true })).toBeVisible();
  await expect(documentsGroup.getByRole("link", { name: "Home" })).toBeVisible();
  await expect(documentsGroup.getByRole("link", { name: "Compliance" })).toBeVisible();
  await expect(documentsGroup.getByRole("link", { name: "My documents", exact: true })).toBeVisible();
  await expect(documentsGroup.getByRole("link", { name: "Assistant" })).toBeVisible();
  await expect(documentsGroup.getByRole("link", { name: "Alerts" })).toBeVisible();
  await expect(documentsGroup.getByRole("link", { name: "Document sources" })).toBeVisible();

  // Urgent badge on Alerts in sidebar
  await expect(documentsGroup.getByText("1")).toBeVisible();

  // Clicking My documents navigates to /sharepoint/documents
  await documentsGroup.getByRole("link", { name: "My documents", exact: true }).click();
  await expect(page).toHaveURL(/\/sharepoint\/documents/);
  await expect(page.getByRole("heading", { name: "My documents", exact: true })).toBeVisible();
});


test("Documents Home displays greeting, attention items, query suggestions, and recent files", async ({ page }) => {
  await page.goto("/sharepoint");
  await expect(page.getByRole("heading", { name: /Good (morning|afternoon|evening)/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Ask about your documents" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Which licences expire soon?" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Recently updated" })).toBeVisible();
  await expect(page.getByText(document.name, { exact: true })).toBeVisible();
});

test("Document sources admin tab is accessible to administrators", async ({ page }) => {
  await page.goto("/sharepoint?tab=admin");
  await expect(page.getByRole("main", { name: "Document sources" })).toBeVisible();
  await expect(page.getByText("Automatic sync")).toBeVisible();
  await expect(page.getByText("Compliance workflow")).toBeVisible();
  await expect(page.getByText("Processing health")).toBeVisible();
  await expect(page.getByRole("button", { name: "Open compliance dashboard" })).toBeVisible();
});

test("queued and ready documents have distinct statuses", async ({ page }) => {
  await page.route("**/api/sharepoint/search", (route) => route.fulfill({
    json: {
      items: [
        { ...document, id: "queued-doc", name: "Queued.pdf", status: "queued", requires_attention: false },
        { ...document, id: "ready-doc", name: "Ready.pdf", status: "ready", requires_attention: false },
      ],
      next_cursor: null,
    },
  }));
  await page.goto("/sharepoint/documents");
  await expect(page.getByText("Waiting for sync").first()).toBeVisible();
  await expect(page.getByText("Ready", { exact: true }).first()).toBeVisible();
});

test("document list refreshes while a sync is active", async ({ page }) => {
  let processed = false;
  await page.route("**/api/sharepoint/status", (route) => route.fulfill({
    json: { ...readyStatus, active_run: true },
  }));
  await page.route("**/api/sharepoint/search", (route) => route.fulfill({
    json: {
      items: [{ ...document, status: processed ? "ready" : "queued", requires_attention: false }],
      next_cursor: null,
    },
  }));
  await page.goto("/sharepoint/documents");
  await expect(page.getByText("Waiting for sync").first()).toBeVisible();
  processed = true;
  await expect(page.getByText("Ready", { exact: true }).first()).toBeVisible({ timeout: 15_000 });
});

test("clicking a suggestion in Ask about your documents opens Assistant and submits query", async ({ page }) => {
  let chatRequest: unknown;
  await page.route("**/api/sharepoint/chat", async (route) => {
    chatRequest = route.request().postDataJSON();
    await route.fulfill({
      json: {
        reply: "Here are the expiring licences found across documents.",
        citations: [],
      },
    });
  });

  await page.goto("/sharepoint");
  await page.getByRole("button", { name: "Which licences expire soon?" }).click();

  await expect(page).toHaveURL(/\/sharepoint\/assistant\?q=Which\+licences\+expire\+soon%3F/);
  await expect(page.getByRole("heading", { name: "Assistant", exact: true })).toBeVisible();
  await expect(page.getByText("Which licences expire soon?")).toBeVisible();
  await expect(page.getByText("Here are the expiring licences found across documents.")).toBeVisible();
  expect(chatRequest).toEqual({
    messages: [{ role: "user", content: "Which licences expire soon?" }],
  });
});
