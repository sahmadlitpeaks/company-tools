import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const user = { id: "user-1", email: "alex@example.com", display_name: "Alex Admin", is_active: true, is_admin: true, role: "admin", status: "active", effective_permissions: ["crm"], managed_company_ids: [], must_change_password: false };
const colleague = { ...user, id: "user-2", email: "rana@example.com", display_name: "Rana Sales", is_admin: false, role: "member" };
const brand = { id: "brand-1", slug: "ag-holding", name: "AG Holding", primary_color: "#facc15", accent_color: "#facc15", is_active: true, is_default: true };
const today = new Date().toISOString().slice(0, 10);

type Call = { method: string; path: string; body: unknown; raw: string | null; params: URLSearchParams };

async function mockCrm(page: Page) {
  const calls: Call[] = [];
  const leads = Array.from({ length: 4 }, (_, i) => ({
    id: `lead-${i}`, name: `Lead ${i}`, email: `lead${i}@example.com`, phone: `+97150000000${i}`, company: "Acme Labs",
    source: "import", source_detail: "leads.xlsx", status: "new", owner_id: null as string | null, owner_name: null as string | null, company_id: null,
    value: "1500", notes: "Wants a quote", priority: i === 0 ? "high" : null, tags: i === 0 ? ["distributor"] : [],
    follow_up_date: i === 0 ? "2020-01-01" : i === 1 ? today : null, next_step: i === 0 ? "Send quotation" : null,
    expected_close_date: null, lost_reason: null as string | null, last_contacted_at: null, fields: [],
    created_at: "2026-09-30T12:00:00Z", can_delete: i !== 3,
  }));
  const activities = [{ id: "act-1", lead_id: "lead-0", kind: "import", body: "Imported from leads.xlsx (row 2)", author_id: "user-1", author_name: "Alex Admin", created_at: "2026-09-30T12:00:00Z", can_delete: false }];
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (!path.startsWith("/api/")) { await route.continue(); return; }
    const method = request.method();
    const raw = request.postData();
    let body: unknown = [];
    if (method !== "GET") {
      let parsed: unknown = raw;
      try { parsed = raw ? JSON.parse(raw) : null; } catch { /* multipart */ }
      calls.push({ method, path, body: parsed, raw, params: url.searchParams });
    } else calls.push({ method, path, body: null, raw: null, params: url.searchParams });
    if (path === "/api/auth/me") body = user;
    else if (path === "/api/companies") body = [brand];
    else if (path === "/api/users") body = [user, colleague];
    else if (path === "/api/crm/summary") body = { total: leads.length, by_status: { new: 4 }, by_source: { import: 4 }, open_value: "6000", won_value: "0", overdue: 1, due_today: 1 };
    else if (path === "/api/crm/leads/page") body = { items: leads, total: leads.length, offset: 0, limit: 25 };
    else if (path === "/api/crm/leads/bulk") body = { updated: (JSON.parse(raw ?? "{}") as { ids: string[] }).ids.length };
    else if (path === "/api/crm/import/preview") body = {
      sheets: ["Overview", "Potential Leads"], sheet: "Potential Leads", columns: ["Name", "Email", "Department / Company", "Full Message"],
      mapping: { Name: "name", Email: "email", "Department / Company": "company", "Full Message": "notes" },
      total_rows: 3, valid_rows: 3, duplicates_in_file: 1, existing_matches: 1, errors: [], warnings: [{ row: 3, message: "Priority “Review” isn't high, medium or low; left blank" }],
      sample: [{ row: 2, name: "Ana", email: "ana@example.com", status: "new", match: "new" }, { row: 3, name: "Ana", email: "ana@example.com", status: "new", match: "duplicate_in_file" }, { row: 4, name: "Lead 0", email: "lead0@example.com", status: "new", match: "exists" }],
    };
    else if (path === "/api/crm/import") body = { created: 1, merged: 2, skipped: 0, errors: [] };
    else if (/\/api\/crm\/leads\/[^/]+\/activities$/.test(path)) {
      if (method === "POST") {
        const entry = { id: `act-${activities.length + 1}`, lead_id: "lead-0", ...(JSON.parse(raw!) as { kind: string; body: string }), author_id: "user-1", author_name: "Alex Admin", created_at: new Date().toISOString(), can_delete: true };
        activities.unshift(entry);
        body = entry;
      } else body = activities;
    } else if (path.startsWith("/api/crm/leads/")) {
      const lead = leads.find((item) => path.endsWith(`/${item.id}`));
      if (!lead) { await route.fulfill({ status: 404, json: { detail: "Lead not found" } }); return; }
      if (method === "PATCH") Object.assign(lead, JSON.parse(raw!));
      body = lead;
    }
    await route.fulfill({ json: body as object });
  });
  return { calls, leads, activities };
}

async function choose(page: Page, label: string, option: string) {
  await page.getByRole("combobox", { name: label, exact: true }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

async function noHorizontalScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

test("lead detail logs a call and asks for a reason before marking lost", async ({ page }) => {
  const { calls } = await mockCrm(page);
  await page.goto("/crm/lead-0");
  await expect(page.getByRole("heading", { level: 1, name: "Lead 0" })).toBeVisible();
  await expect(page.getByText("Imported from leads.xlsx (row 2)")).toBeVisible();
  await expect(page.getByText("Overdue", { exact: true })).toBeVisible();
  await noHorizontalScroll(page);

  await page.getByRole("radio", { name: "Call" }).or(page.getByRole("button", { name: "Call", exact: true })).first().click();
  await page.getByLabel("Details").fill("Discussed the ASL loader quote");
  await page.getByRole("button", { name: "Log call", exact: true }).click();
  await expect(page.getByText("Discussed the ASL loader quote")).toBeVisible();
  expect(calls.find((call) => call.method === "POST" && call.path.endsWith("/activities"))?.body).toEqual({ kind: "call", body: "Discussed the ASL loader quote" });

  await choose(page, "Stage", "Lost");
  const dialog = page.getByRole("dialog", { name: "Mark Lead 0 as lost" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Why was it lost?").fill("Chose another supplier");
  await dialog.getByRole("button", { name: "Mark as lost" }).click();
  await expect(dialog).not.toBeVisible();
  expect(calls.filter((call) => call.method === "PATCH").at(-1)?.body).toEqual({ status: "lost", lost_reason: "Chose another supplier" });
});

test("unknown lead shows an error with a way back", async ({ page }) => {
  await mockCrm(page);
  await page.goto("/crm/missing");
  await expect(page.getByText("Lead not found")).toBeVisible();
  await expect(page.getByText("Back to leads")).toBeVisible();
});

test("list shows follow-ups, bulk-assigns and bulk-marks lost with a reason", async ({ page }) => {
  const { calls } = await mockCrm(page);
  await page.goto("/crm");
  await expect(page.getByRole("link", { name: "Lead 0" })).toBeVisible();
  await expect(page.getByText(/^Overdue · /).filter({ visible: true })).toBeVisible();
  await expect(page.getByText("High priority").filter({ visible: true })).toBeVisible();
  // Only admins and owners see delete; the mock marks Lead 3 as not deletable.
  await expect(page.getByRole("button", { name: "Delete Lead 0", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Delete Lead 3", exact: true })).toHaveCount(0);
  await noHorizontalScroll(page);

  await page.getByRole("checkbox", { name: "Select Lead 1" }).click();
  await page.getByRole("checkbox", { name: "Select Lead 2" }).click();
  await expect(page.getByText("2 selected")).toBeVisible();
  await choose(page, "Assign to", "Rana Sales");
  await expect.poll(() => calls.find((call) => call.path === "/api/crm/leads/bulk")?.body).toEqual({ ids: ["lead-1", "lead-2"], action: "assign", owner_id: "user-2" });
  await expect(page.getByText("2 selected")).not.toBeVisible();

  await page.getByRole("checkbox", { name: "Select Lead 3" }).click();
  await expect(page.getByRole("region", { name: "Bulk actions" }).getByRole("button", { name: "Delete" })).toHaveCount(0);
  await choose(page, "Move to stage", "Lost");
  const dialog = page.getByRole("dialog", { name: "Mark 1 lead as lost" });
  await dialog.getByLabel("Why was it lost?").fill("No budget");
  await dialog.getByRole("button", { name: "Mark as lost" }).click();
  await expect.poll(() => calls.filter((call) => call.path === "/api/crm/leads/bulk").at(-1)?.body).toEqual({ ids: ["lead-3"], action: "status", status: "lost", lost_reason: "No budget" });

  await choose(page, "Follow-up", "Overdue");
  await choose(page, "Owner", "Assigned to me");
  await expect.poll(() => calls.filter((call) => call.path === "/api/crm/leads/page").at(-1)?.params.get("owner_id")).toBe("user-1");
  expect(calls.filter((call) => call.path === "/api/crm/leads/page").at(-1)?.params.get("follow_up")).toBe("overdue");
});

test("import previews the file and sends the chosen duplicate handling", async ({ page }) => {
  const { calls } = await mockCrm(page);
  await page.goto("/crm");
  await page.getByRole("button", { name: "Import", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Import leads" });
  await dialog.getByLabel("Spreadsheet").setInputFiles({ name: "leads.csv", mimeType: "text/csv", buffer: Buffer.from("Name,Email\nAna,ana@example.com\n") });
  await expect(dialog.getByText("3 rows · 3 ready · 1 repeated in the file · 1 already in the CRM")).toBeVisible();
  await expect(dialog.getByText("Already in CRM", { exact: true }).filter({ visible: true })).toBeVisible();
  await expect(dialog.getByText(/Priority “Review”/)).toBeVisible();

  await choose(page, "Department / Company", "Don't import");
  await expect.poll(() => calls.filter((call) => call.path === "/api/crm/import/preview").length).toBe(2);
  expect(calls.filter((call) => call.path === "/api/crm/import/preview").at(-1)?.raw).toContain('"Department / Company":null');

  await dialog.getByRole("radio", { name: "Merge into the existing lead" }).or(dialog.getByRole("button", { name: "Merge into the existing lead" })).first().click();
  await dialog.getByRole("button", { name: "Import 3 rows" }).click();
  await expect(dialog).not.toBeVisible();
  const sent = calls.find((call) => call.path === "/api/crm/import")!;
  expect(sent.raw).toMatch(/name="on_duplicate"\r\n\r\nmerge/);
  expect(sent.raw).toMatch(/name="sheet"\r\n\r\nPotential Leads/);
  await expect(page.getByText("Import finished: 1 added, 2 merged.")).toBeVisible();
});

test("lead detail is accessible in light and dark mode", async ({ page }) => {
  await mockCrm(page);
  await page.goto("/crm/lead-0");
  await expect(page.getByText("Imported from leads.xlsx (row 2)")).toBeVisible();
  for (const dark of [false, true]) {
    await page.evaluate((darkMode) => document.documentElement.classList.toggle("dark", darkMode), dark);
    await page.evaluate(async () => {
      const transitions = document.getAnimations().filter((animation) => animation.effect?.getTiming().iterations !== Infinity);
      await Promise.all(transitions.map((animation) => animation.finished.catch(() => {})));
    });
    const results = await new AxeBuilder({ page }).include("main").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    expect(results.violations.map((violation) => ({ id: violation.id, nodes: violation.nodes.map((node) => node.target) }))).toEqual([]);
  }
});
