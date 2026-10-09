import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// Explicit opt-in: a migrated, disposable local PostgreSQL-backed stack only.
test.skip(process.env.PM_STACK_E2E !== "1", "Requires disposable local Projects stack");

test("workspace persists through the real API, cookie session and PostgreSQL", async ({ page, baseURL }) => {
  expect(new URL(baseURL!).hostname).toMatch(/^(127\.0\.0\.1|localhost)$/);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const login = await page.request.post("/api/auth/login", { data: { email: process.env.E2E_EMAIL ?? "admin@agholding.net", password: process.env.E2E_PASSWORD ?? "admin" } });
  expect(login.status()).toBe(200);
  const key = `QA${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  const created = await page.request.post("/api/pm/projects", { data: { key, name: `${key} delivery`, sprints_enabled: false } });
  expect(created.status()).toBe(201);
  const project = await created.json();
  const configResponse = await page.request.get(`/api/pm/projects/${project.id}/configuration`);
  const config = await configResponse.json();
  config.states.push({ key: "qa", name: "QA testing", category: "in_review", allowed_next: ["done"] });
  config.fields = [{ key: "customer", name: "Customer", kind: "text", required: true, options: [] }];
  config.templates = [{ key: "bug", name: "Bug report", issue_type: "bug", description: "## Acceptance\n\n- [ ] Confirm permissions", priority: "high" }];
  expect((await page.request.put(`/api/pm/projects/${project.id}/configuration`, { data: config })).status()).toBe(200);
  await page.goto(`/projects/${key}`);
  await expect(page.getByRole("heading", { name: `${key} delivery`, level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "Create issue in QA testing", exact: true }).click();
  const form = page.getByRole("dialog", { name: "Create issue", exact: true });
  await form.getByRole("combobox", { name: "Issue template" }).click();
  await page.getByRole("option", { name: "Bug report", exact: true }).click();
  await form.getByRole("button", { name: "Apply template" }).click();
  await form.getByRole("textbox", { name: "Summary", exact: true }).fill("Verify workspace persistence");
  await form.getByRole("textbox", { name: "Customer *", exact: true }).fill("Lab A");
  await form.getByLabel("Due date", { exact: true }).fill("2026-10-16");
  await form.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`[?&]issue=${key}-1`));
  const saved = await (await page.request.get(`/api/pm/issues/${key}-1`)).json();
  expect(saved).toMatchObject({ workflow_state: "qa", status: "in_review", custom_fields: { customer: "Lab A" }, priority: "high" });
  expect(saved.description).toContain("## Acceptance");
  await page.request.post(`/api/pm/projects/${project.id}/issues`, { data: { summary: "Second issue", custom_fields: { customer: "Lab B" } } });
  await page.goto(`/projects/${key}?tab=issues`);
  await page.getByRole("checkbox", { name: `Select ${key}-1`, exact: true }).check();
  await page.getByRole("checkbox", { name: `Select ${key}-2`, exact: true }).check();
  await page.getByRole("button", { name: "Bulk edit", exact: true }).click();
  await page.getByRole("combobox", { name: "Change field" }).click();
  await page.getByRole("option", { name: "Priority", exact: true }).click();
  await page.getByRole("combobox", { name: "New value" }).click();
  await page.getByRole("option", { name: "Highest", exact: true }).click();
  await page.getByRole("button", { name: "Apply changes" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const pageData = await (await page.request.get(`/api/pm/issues/page?project_id=${project.id}`)).json();
  expect(pageData.items.map((issue: { priority: string }) => issue.priority)).toEqual(["highest", "highest"]);
  if (page.viewportSize()!.width < 640) {
    await page.getByRole("button", { name: `Quick edit ${key}-1`, exact: true }).click();
    await page.getByRole("combobox", { name: "Workflow state", exact: true }).click();
    await page.getByRole("option", { name: "Done", exact: true }).click();
    await page.getByRole("button", { name: "Save changes", exact: true }).click();
  } else {
    await page.getByRole("combobox", { name: `State for ${key}-1`, exact: true }).click();
    await page.getByRole("option", { name: "Done", exact: true }).click();
  }
  await expect.poll(async () => (await (await page.request.get(`/api/pm/issues/${key}-1`)).json()).status).toBe("done");
  await page.goto(`/projects/${key}?tab=issues&issue_layout=calendar&month=2026-10`);
  await expect(page.getByRole("heading", { name: "October 2026", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: new RegExp("Verify workspace persistence") })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole("button", { name: "Toggle dark mode" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.evaluate(async () => { await Promise.all(document.getAnimations().filter((animation) => Number.isFinite(animation.effect?.getComputedTiming().iterations)).map((animation) => animation.finished.catch(() => {}))); });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: `test-results/workspace-live-dark-${page.viewportSize()!.width}.png`, fullPage: true });
  await page.reload();
  await expect(page.getByRole("heading", { name: "October 2026", exact: true })).toBeVisible();
  const history = await (await page.request.get(`/api/pm/issues/${saved.id}/history`)).json();
  expect(history.some((entry: { field: string }) => entry.field === "priority")).toBe(true);
  expect(history.some((entry: { field: string }) => entry.field === "workflow state")).toBe(true);
  expect(errors).toEqual([]);
});
