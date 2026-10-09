import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const user = { id: "admin-1", email: "admin@example.com", display_name: "Admin", is_active: true,
  is_admin: true, role: "admin", status: "active", effective_permissions: ["sharepoint_intelligence"],
  managed_company_ids: [], created_at: "2026-01-01T00:00:00Z" };
const status = { enabled: true, configured: true, missing: [], connected: true, user_id: user.id,
  openai_configured: true, active_run: false, polling_enabled: true, sync_interval_seconds: 60,
  languages: ["en", "ar"], last_sync: null, run: null };
const finance = { id: "source-1", name: "Finance", site_id: "site-1", drive_id: "library-1", folder_id: "folder-1",
  enabled: true, active_run: false, last_sync: null, baseline_completed: false, teams_notify_uploads: false,
  teams_channel_name: "", teams_webhook_configured: false, run: null, deliveries: {}, last_delivery_error: null };
const operations = { ...finance, id: "source-2", name: "Operations", folder_id: "operations",
  teams_notify_uploads: true, teams_channel_name: "Operations / Uploads", teams_webhook_configured: true,
  baseline_completed: true, deliveries: { sent: 3, failed: 1 }, last_delivery_error: "teams_upload_delivery_failed" };

test.beforeEach(async ({ page }) => {
  // Axe should inspect the final rendered state, including toast contrast.
  await page.emulateMedia({ reducedMotion: "reduce" });
  let sources = [{ ...finance }, { ...operations }];
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (!path.startsWith("/api/")) return route.continue();
    let body: unknown = {};
    if (path === "/api/auth/me") body = user;
    else if (path === "/api/settings/public") body = { platform_name: "Company Tools" };
    else if (["/api/companies", "/api/notifications", "/api/sharepoint/reminders"].includes(path)) body = [];
    else if (path === "/api/notifications/unread-count") body = { count: 0 };
    else if (path === "/api/sharepoint/status") body = status;
    else if (path === "/api/sharepoint/source-options") body = sources.map(({ id, name }) => ({ id, name }));
    else if (path === "/api/sharepoint/sources" && route.request().method() === "GET") body = sources;
    else if (path === "/api/sharepoint/sources" && route.request().method() === "POST") {
      const input = route.request().postDataJSON();
      const { teams_webhook_url, ...safeInput } = input;
      const saved = { ...finance, ...safeInput, id: "source-3", teams_webhook_configured: Boolean(teams_webhook_url) };
      sources.push(saved);
      await route.fulfill({ status: 201, json: saved });
      return;
    } else if (path.startsWith("/api/sharepoint/sources/") && route.request().method() === "PUT") {
      const input = route.request().postDataJSON();
      const sourceId = path.split("/").pop();
      sources = sources.map((source) => source.id === sourceId ? { ...source, ...input } : source);
      body = sources.find((source) => source.id === sourceId);
    } else if (path.endsWith("/test-connection")) body = { ok: true };
    else if (path.endsWith("/sync")) body = { id: "run-1", status: "queued" };
    else if (path === "/api/sharepoint/search") {
      const input = route.request().postDataJSON();
      const docs = sources.filter((source) => !input.source_id || source.id === input.source_id).map((source) => ({
        id: source.id + "-doc", source_id: source.id, name: source.name + " contract.txt",
        url: "https://example.sharepoint.com/file", path: "/Documents/contract.txt",
        status: "ready", error_code: null, languages: ["en"], modified_at: null, requires_attention: false,
      }));
      body = { items: docs, next_cursor: null };
    }
    await route.fulfill({ json: body });
  });
});

test("admin adds a source with optional Teams upload notifications", async ({ page }, testInfo) => {
  await page.goto("/sharepoint/admin");
  await expect(page.getByText("Finance", { exact: true })).toBeVisible();
  await expect(page.getByText("Operations / Uploads", { exact: true })).toBeVisible();
  await expect(page.getByText("3 sent · 0 pending · 1 retrying · 0 skipped")).toBeVisible();
  await page.getByRole("button", { name: "Add source", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Add document source" });
  await expect(dialog.getByRole("switch", { name: "Notify Teams on new upload" })).not.toBeChecked();
  await dialog.getByLabel("Source name", { exact: true }).fill("HR documents");
  await dialog.getByLabel("SharePoint site ID", { exact: true }).fill("hr-site");
  await dialog.getByLabel("Document library ID", { exact: true }).fill("hr-library");
  await dialog.getByLabel("Folder ID", { exact: true }).fill("root");
  await dialog.getByRole("switch", { name: "Notify Teams on new upload" }).click();
  await dialog.getByLabel("Teams destination channel", { exact: true }).fill("HR / Documents");
  await dialog.getByLabel("Teams workflow webhook URL", { exact: true }).fill("https://example.logic.azure.com/workflows/test?sig=fake");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  const requestPromise = page.waitForRequest((request) => new URL(request.url()).pathname === "/api/sharepoint/sources" && request.method() === "POST");
  await dialog.getByRole("button", { name: "Add source", exact: true }).click();
  expect((await requestPromise).postDataJSON()).toMatchObject({ teams_notify_uploads: true, teams_channel_name: "HR / Documents", folder_id: "root" });
  await expect(dialog).not.toBeVisible();
  await expect(page.getByText("HR documents", { exact: true })).toBeVisible();
  await expect(page.getByText("First sync will establish a baseline without sending notifications.")).toBeVisible();
  expect(await page.locator("body").innerText()).not.toContain("sig=fake");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const violations = (await new AxeBuilder({ page }).analyze()).violations.filter((item) => ["serious", "critical"].includes(item.impact || ""));
  expect(violations).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("document-sources.png"), fullPage: true });
});

test("source examples and help work without changing the form or closing its dialog", async ({ page }, testInfo) => {
  await page.goto("/sharepoint/admin");
  await page.getByRole("button", { name: "Add source", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Add document source" });
  await expect(dialog.getByLabel("Source name", { exact: true })).toHaveAttribute("placeholder", "e.g. Finance documents");
  await expect(dialog.getByLabel("SharePoint site ID", { exact: true })).toHaveAttribute("placeholder", "contoso.sharepoint.com,site-guid,web-guid");
  await expect(dialog.getByLabel("Document library ID", { exact: true })).toHaveAttribute("placeholder", "e.g. b!AbCdEf…");
  await expect(dialog.getByLabel("Folder ID", { exact: true })).toHaveAttribute("placeholder", "root or e.g. 01ABCDEF…");
  await dialog.getByLabel("Source name", { exact: true }).fill("My documents");
  const nameHelp = dialog.getByRole("button", { name: "About Source name", exact: true });
  await nameHelp.focus();
  await nameHelp.press("Enter");
  const popup = page.locator('[data-slot="popover-content"]');
  await expect(popup).toContainText("appears in source filters");
  await page.keyboard.press("Escape");
  await expect(popup).not.toBeVisible();
  await expect(nameHelp).toBeFocused();
  await dialog.getByRole("switch", { name: "Notify Teams on new upload" }).click();
  await expect(dialog.getByLabel("Teams destination channel", { exact: true })).toHaveAttribute("placeholder", "e.g. Finance / Documents");
  await expect(dialog.getByLabel("Teams workflow webhook URL", { exact: true })).toHaveAttribute("placeholder", "https://…logic.azure.com/workflows/…");
  for (const [label, text] of [
    ["SharePoint site ID", "GET /sites/contoso.sharepoint.com:/sites/Finance"],
    ["Document library ID", "GET /sites/{site-id}/drives"],
    ["Folder ID", "GET /drives/{drive-id}/root:/Finance"],
    ["Enable sync", "pause both"],
    ["Notify Teams on new upload", "Existing files stay silent"],
    ["Teams destination channel", "only a label"],
    ["Teams workflow webhook URL", "copy the webhook URL from the workflow details"],
  ]) {
    await dialog.getByRole("button", { name: `About ${label}`, exact: true }).click();
    await expect(popup).toContainText(text);
    const bounds = await popup.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    if (label === "SharePoint site ID") {
      await expect(popup.getByRole("link")).toHaveAttribute("href", "https://learn.microsoft.com/en-us/graph/api/site-getbypath?view=graph-rest-1.0");
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      await page.screenshot({ path: testInfo.outputPath("source-field-help.png") });
    }
    await page.keyboard.press("Escape");
    await expect(popup).not.toBeVisible();
    await expect(dialog).toBeVisible();
  }
  await expect(dialog.getByRole("switch", { name: "Enable sync" })).toBeChecked();
  await expect(dialog.getByRole("switch", { name: "Notify Teams on new upload" })).toBeChecked();
  await expect(dialog.getByLabel("Source name", { exact: true })).toHaveValue("My documents");
});

test("admin edits settings without revealing the saved webhook and pauses a source", async ({ page }) => {
  await page.goto("/sharepoint/admin");
  const card = page.locator('[data-slot="card"]').filter({ has: page.getByText("Operations", { exact: true }) });
  await card.getByRole("button", { name: "Edit", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Edit document source" });
  await expect(dialog.getByLabel("Teams workflow webhook URL", { exact: true })).toHaveValue("");
  await expect(dialog.getByLabel("Teams workflow webhook URL", { exact: true })).toHaveAttribute("placeholder", "Saved securely — leave blank to keep");
  await expect(dialog.getByLabel("SharePoint site ID", { exact: true })).toHaveAttribute("readonly", "");
  const requestPromise = page.waitForRequest((request) => request.method() === "PUT");
  await dialog.getByRole("button", { name: "Save source" }).click();
  expect((await requestPromise).postDataJSON()).not.toHaveProperty("teams_webhook_url");
  await expect(dialog).not.toBeVisible();
  await card.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(card.getByText("Paused", { exact: true })).toBeVisible();
  await expect(card.getByRole("button", { name: "Sync now" })).toBeDisabled();
  await card.getByRole("button", { name: "Resume", exact: true }).click();
  await expect(card.getByText("Enabled", { exact: true })).toBeVisible();
  await card.getByRole("button", { name: "Test read access" }).click();
  await expect(page.getByText("SharePoint read access verified.")).toBeVisible();
});

test("failed access keeps the source form open with an actionable error", async ({ page }) => {
  await page.route("**/api/sharepoint/sources", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    return route.fulfill({ status: 403, json: { detail: "document_access_denied" } });
  });
  await page.goto("/sharepoint/admin");
  await page.getByRole("button", { name: "Add source", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Source name", { exact: true }).fill("Restricted");
  await dialog.getByLabel("SharePoint site ID", { exact: true }).fill("site");
  await dialog.getByLabel("Document library ID", { exact: true }).fill("drive");
  await dialog.getByLabel("Folder ID", { exact: true }).fill("folder");
  await dialog.getByRole("button", { name: "Add source", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("grant this app access");
  await expect(dialog.getByLabel("Source name", { exact: true })).toHaveValue("Restricted");
});

test("document source selection filters the server request and clears prior results", async ({ page }) => {
  await page.goto("/sharepoint/documents");
  await expect(page.getByText("Finance contract.txt", { exact: true })).toBeVisible();
  await page.getByRole("combobox", { name: "Document source" }).click();
  await page.getByRole("option", { name: "Operations", exact: true }).click();
  await expect(page.getByText("Operations contract.txt", { exact: true })).toBeVisible();
  await expect(page.getByText("Finance contract.txt", { exact: true })).not.toBeVisible();
  await page.getByRole("combobox", { name: "Document source" }).click();
  await page.getByRole("option", { name: "All sources", exact: true }).click();
  await expect(page.getByText("Finance contract.txt", { exact: true })).toBeVisible();
});


test("compliance filters all sections and queues a sync for the selected source", async ({ page }) => {
  await page.route("**/api/sharepoint/compliance/dashboard*", async (route) => {
    const selected = new URL(route.request().url()).searchParams.get("source_id");
    const names = selected === "source-2" ? ["Operations"] : ["Finance", "Operations"];
    await route.fulfill({ json: {
      summary: { expiring_60: 0, expiring_30: 0, due_this_week: 0, overdue: 0,
        needs_review: 0, unassigned: 0, tasks_by_owner: {}, documents_by_company: {} },
      documents: names.map((name) => ({ id: name, name: name+" contract.txt", company: name,
        document_type: "contract", status: "active", processing_status: "ready", review_reasons: [] })), tasks: [],
    } });
  });
  await page.goto("/sharepoint/compliance");
  await page.getByRole("combobox", { name: "Document source" }).click();
  const filtered = page.waitForRequest((request) => request.url().includes("dashboard?source_id=source-2"));
  await page.getByRole("option", { name: "Operations", exact: true }).click();
  await filtered;
  const synced = page.waitForRequest((request) => request.url().endsWith("/api/sharepoint/sources/source-2/sync"));
  await page.getByRole("button", { name: "Sync now", exact: true }).click();
  await synced;
  if ((page.viewportSize()?.width ?? 0) < 640) {
    await page.getByRole("combobox", { name: "Browse compliance" }).click();
    await page.getByRole("option", { name: "Documents", exact: true }).click();
  } else {
    await page.getByRole("tab", { name: "Documents", exact: true }).click();
  }
  await expect(page.getByText("Document register · 1")).toBeVisible();
  await expect(page.getByText("Finance contract.txt", { exact: true })).not.toBeVisible();
  await expect(page.getByRole("button", { name: "Operations contract.txt", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});


test("long source and channel names stay readable without horizontal overflow", async ({ page }) => {
  await page.route("**/api/sharepoint/sources", (route) => route.fulfill({ json: [
    { ...operations, name: "A".repeat(128), teams_channel_name: "Channel".repeat(18) },
  ] }));
  await page.goto("/sharepoint/admin");
  await expect(page.getByText("A".repeat(128), { exact: true })).toBeVisible();
  await expect(page.getByText("Teams could not accept the upload alert. Check the workflow URL and channel; delivery will retry.")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
