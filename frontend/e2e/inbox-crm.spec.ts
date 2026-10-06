import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const user = { id: "user-1", email: "alex@example.com", display_name: "Alex Admin", is_active: true, is_admin: true, role: "admin", status: "active", effective_permissions: ["crm"], managed_company_ids: [], must_change_password: false };
const brand = { id: "brand-1", slug: "ag-holding", name: "AG Holding", primary_color: "#facc15", accent_color: "#facc15", is_active: true, is_default: true };

async function mockLists(page: Page) {
  const queries: URLSearchParams[] = [];
  const mutations: { path: string; body: Record<string, unknown> }[] = [];
  const leads = Array.from({ length: 61 }, (_, i) => ({
    id: `lead-${i}`, name: `Lead ${i}`, email: `lead${i}@example.com`, phone: `97150000${i}`, company: "A long company name for checking action visibility",
    source: i % 2 ? "manual" : "web", source_detail: "Website / contact form", status: i % 3 ? "new" : "qualified", owner_id: i % 2 ? "user-1" : null, owner_name: i % 2 ? "Alex Admin" : null, company_id: "brand-1", value: String(i * 100), notes: "Needs follow-up", fields: [{ key: "budget", label: "Budget range", value: "10k+" }], created_at: "2026-09-30T12:00:00Z", can_delete: true,
  }));
  const submissions = Array.from({ length: 61 }, (_, i) => ({
    id: `sub-${i}`, name: `Sender ${i}`, email: `sender${i}@example.com`, subject: `Enquiry ${i}`, message: "Please send a quotation.", type: i % 2 ? "inquiry" : "lead", status: "new", source_id: "site-1", source_name: "Main website", spam_score: 0, mapping_status: "mapped", created_at: "2026-09-30T12:00:00Z",
  }));
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (!path.startsWith("/api/")) { await route.continue(); return; }
    const params = url.searchParams;
    let body: unknown = [];
    if (path === "/api/auth/me") body = user;
    else if (path === "/api/companies") body = [brand];
    else if (path === "/api/users") body = [user];
    else if (path === "/api/intake/submission-sources") body = [{ id: "site-1", name: "Main website" }];
    else if (path === "/api/intake/summary") body = { by_status: { new: 61, quarantined: 2, archived: 1 } };
    else if (path === "/api/crm/summary") body = { total: leads.length, by_status: { new: 40, qualified: 21 }, by_source: { web: 31, manual: 30 }, open_value: "10000", won_value: "0" };
    else if (path.endsWith("/page")) {
      queries.push(params);
      const crm = path.includes("/crm/");
      let items: (typeof leads[number] | typeof submissions[number])[] = crm ? leads : submissions;
      if (!crm && params.get("scope") === "quarantine") items = [{ ...submissions[0], status: "quarantined", spam_score: 65 }];
      if (!crm && params.get("scope") === "archived") items = [{ ...submissions[0], status: "archived" }];
      for (const key of ["status", "source", "source_id", "company_id", "type", "owner_id"] as const) {
        const selected = params.get(key);
        if (selected) items = items.filter((item) => String((item as Record<string, unknown>)[key]) === selected);
      }
      if (params.get("unassigned") === "true") items = items.filter((item) => !(item as typeof leads[number]).owner_id);
      if (params.get("q")) items = items.filter((item) => `${item.name} ${item.email}`.toLowerCase().includes(params.get("q")!.toLowerCase()));
      if (params.get("sort") === "value_high") items = [...items].sort((a, b) => Number((b as typeof leads[number]).value) - Number((a as typeof leads[number]).value));
      const limit = Number(params.get("limit") ?? 25);
      const offset = Math.min(Math.floor(Number(params.get("offset") ?? 0) / limit), Math.max(0, Math.ceil(items.length / limit) - 1)) * limit;
      body = { items: items.slice(offset, offset + limit), total: items.length, offset, limit };
    } else if (path.startsWith("/api/crm/leads/")) {
      const lead = leads.find((item) => path.endsWith(`/${item.id}`));
      if (route.request().method() === "PATCH") {
        const change = route.request().postDataJSON();
        mutations.push({ path, body: change });
        Object.assign(lead!, change);
      }
      body = lead;
    } else if (path.startsWith("/api/intake/submissions/")) {
      const sub = submissions.find((item) => path.endsWith(`/${item.id}`));
      if (route.request().method() === "PATCH") {
        const change = route.request().postDataJSON();
        mutations.push({ path, body: change });
        Object.assign(sub!, change);
      }
      body = sub;
    }
    await route.fulfill({ json: body as object });
  });
  return { queries, mutations };
}

async function choose(page: Page, label: string, option: string) {
  await page.getByRole("combobox", { name: label, exact: true }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

async function expectInsideViewport(page: Page, button: ReturnType<Page["getByRole"]>) {
  await expect(button).toBeVisible();
  const box = await button.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

test("Inbox paginates, combines filters and resets to the first page", async ({ page }) => {
  const { queries } = await mockLists(page);
  await page.goto("/inbox");
  await expect(page.getByText("1–25 of 61", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Go to next page" }).click();
  await expect(page.getByText("26–50 of 61", { exact: true })).toBeVisible();
  await choose(page, "Type", "inquiry");
  await choose(page, "Website", "Main website");
  await expect(page.getByText("1–25 of 30", { exact: true })).toBeVisible();
  expect(queries.at(-1)?.get("source_id")).toBe("site-1");
  expect(queries.at(-1)?.get("type")).toBe("inquiry");
  expect(queries.at(-1)?.get("offset")).toBe("0");
  await choose(page, "Rows per page", "10");
  await expect(page.getByText("1–10 of 30", { exact: true })).toBeVisible();
  await page.getByLabel("Search submissions").fill("missing person");
  await expect(page.getByText("No matching submissions")).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).first().click();
  await expect(page.getByText("1–10 of 61", { exact: true })).toBeVisible();
});

test("Inbox has visible view and detail actions, quarantine and archived views", async ({ page }) => {
  await mockLists(page);
  await page.goto("/inbox");
  const view = page.getByRole("button", { name: "View submission from Sender 0", exact: true });
  await expectInsideViewport(page, view);
  await view.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expectInsideViewport(page, page.getByRole("button", { name: "Create CRM lead", exact: true }));
  await expectInsideViewport(page, page.getByRole("button", { name: "Create ticket", exact: true }));
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Quarantine (2)" }).click();
  await expect(page.getByText("1–1 of 1", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Archived", exact: true }).click();
  await expect(page.getByText("1–1 of 1", { exact: true })).toBeVisible();
});

test("CRM pipeline, owner, brand, dates and value sort reach the API", async ({ page }) => {
  const { queries } = await mockLists(page);
  await page.goto("/crm");
  await expect(page.getByText("1–25 of 61", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Go to next page" }).click();
  await expect(page.getByText("26–50 of 61", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Qualified (21)", exact: true }).click();
  await choose(page, "Owner", "Unassigned");
  await choose(page, "Brand", "AG Holding");
  await choose(page, "Sort", "Highest value");
  await page.getByLabel("From date (UTC)").fill("2026-09-01");
  await page.getByLabel("To date (UTC)").fill("2026-10-01");
  await expect(page.getByText("1–11 of 11", { exact: true })).toBeVisible();
  await expect.poll(() => queries.at(-1)?.get("before")).toBe("2026-10-01");
  const query = queries.at(-1)!;
  expect(Object.fromEntries(query)).toMatchObject({ status: "qualified", unassigned: "true", company_id: "brand-1", sort: "value_high", after: "2026-09-01", before: "2026-10-01", offset: "0" });
  await expect(page.getByRole("button", { name: "Edit Lead 60", exact: true })).toBeVisible();
});

test("CRM actions stay in view and edits preserve website fields", async ({ page }) => {
  const { mutations } = await mockLists(page);
  await page.goto("/crm");
  await expectInsideViewport(page, page.getByRole("button", { name: "Add lead", exact: true }));
  const edit = page.getByRole("button", { name: "Edit Lead 0", exact: true });
  await expectInsideViewport(page, edit);
  await expectInsideViewport(page, page.getByRole("button", { name: "Delete Lead 0", exact: true }));
  await edit.click();
  await expect(page.getByText("Budget range", { exact: true })).toBeVisible();
  await page.getByRole("dialog").getByLabel("Name", { exact: true }).fill("Updated lead");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  expect(mutations[0]).toMatchObject({ path: "/api/crm/leads/lead-0", body: { name: "Updated lead" } });
  await choose(page, "Stage for Updated lead", "Won");
  await expect.poll(() => mutations.at(-1)?.body.status).toBe("won");
});

test("API failures show a retry instead of an empty list", async ({ page }) => {
  await mockLists(page);
  let fail = true;
  await page.route("**/api/intake/submissions/page?**", async (route) => {
    if (fail) await route.fulfill({ status: 503, json: { detail: "Inbox temporarily unavailable" } });
    else await route.fallback();
  });
  await page.goto("/inbox");
  await expect(page.getByText("Inbox temporarily unavailable")).toBeVisible();
  await expect(page.getByText("No submissions yet")).not.toBeVisible();
  fail = false;
  await page.getByRole("button", { name: /retry|try again/i }).click();
  await expect(page.getByText("1–25 of 61", { exact: true })).toBeVisible();
});

test("Inbox and CRM main content is accessible in light and dark mode", async ({ page }) => {
  await mockLists(page);
  for (const path of ["/inbox", "/crm"]) {
    await page.goto(path);
    await expect(page.getByText("1–25 of 61", { exact: true })).toBeVisible();
    for (const dark of [false, true]) {
      await page.evaluate((darkMode) => document.documentElement.classList.toggle("dark", darkMode), dark);
      await page.evaluate(async () => {
        const transitions = document.getAnimations().filter((animation) => animation.effect?.getTiming().iterations !== Infinity);
        await Promise.all(transitions.map((animation) => animation.finished.catch(() => {})));
      });
      const results = await new AxeBuilder({ page }).include("main").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
      expect(results.violations.map((violation) => ({ id: violation.id, nodes: violation.nodes.map((node) => ({ target: node.target, failure: node.failureSummary })) }))).toEqual([]);
    }
  }
});
