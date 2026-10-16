import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { noOverflow, waitForTransitions } from "./projects-fixtures";

test.use({ actionTimeout: 15000 });

test.skip(process.env.PM_STACK_E2E !== "1", "Requires disposable migrated local PostgreSQL stack");

test("requirement brief drives multiple tasks, files and supporting decisions", async ({ page, baseURL }) => {
  test.setTimeout(120_000);
  expect(new URL(baseURL!).hostname).toMatch(/^(localhost|127\.0\.0\.1)$/);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  expect((await page.request.post("/api/auth/login", { data: { email: process.env.E2E_EMAIL ?? "admin@agholding.net", password: process.env.E2E_PASSWORD } })).status()).toBe(200);
  const key = `RQ${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  await page.goto("/requirements");
  await page.getByRole("button", { name: "Create requirement", exact: true }).click();
  await page.getByRole("button", { name: "New project for this request", exact: true }).click();
  const projectForm = page.getByRole("dialog", { name: "New project", exact: true });
  await projectForm.getByLabel("Key", { exact: true }).fill(key);
  await projectForm.getByLabel("Name", { exact: true }).fill(`${key} workspace`);
  await projectForm.getByRole("combobox", { name: "Starting board", exact: true }).click();
  await page.getByRole("option", { name: "Kanban · continuous flow", exact: true }).click();
  await projectForm.getByRole("button", { name: "Create project", exact: true }).click();
  const form = page.getByRole("dialog", { name: "Create requirement", exact: true });
  const sections = {
    "Title": `${key}: Build an internal Jira clone`, "Original request": "The operations team requested a shared Jira-style workspace.",
    "Context": "Teams currently track work in separate spreadsheets.", "Functional requirements": "Create projects, boards, tasks and assignments.",
    "Technical requirements": "Use React, FastAPI and PostgreSQL. Keep project permissions.", "Scope": "Internal teams only. External customer portals are excluded.",
    "Expected outcome": "Teams can track delivery in one place.", "Acceptance criteria": "Members can create and move a task; viewers cannot edit.",
    "Supporting information": "Source meeting: https://example.test/jira-request",
  };
  for (const [label, text] of Object.entries(sections)) await form.getByLabel(label, { exact: true }).fill(text);
  await form.getByRole("combobox", { name: "Requirement status" }).click();
  await page.getByRole("option", { name: "Ready", exact: true }).click();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await noOverflow(page);
  await form.getByRole("button", { name: "Save requirement", exact: true }).click();
  const detail = page.getByRole("dialog", { name: sections.Title, exact: true });
  await expect(detail.getByText(sections["Original request"], { exact: true })).toBeVisible();
  const id = new URL(page.url()).searchParams.get("requirement")!;
  await detail.getByLabel("Upload supporting documents").setInputFiles({ name: "request.txt", mimeType: "text/plain", buffer: Buffer.from("The original Jira clone request") });
  await expect(detail.getByText("request.txt", { exact: true })).toBeVisible();
  await detail.getByRole("tab", { name: "Work & decisions", exact: true }).click();
  for (const summary of ["Frontend board", "Backend API", "Database design"]) {
    await detail.getByRole("button", { name: "Create task", exact: true }).click();
    const task = page.getByRole("dialog", { name: "Create issue", exact: true });
    await expect(task.getByText(new RegExp(`${key}-REQ-1`))).toBeVisible();
    await task.getByLabel("Summary", { exact: true }).fill(summary);
    await task.getByRole("button", { name: "Create", exact: true }).click();
    await expect(detail.getByRole("link", { name: new RegExp(summary) })).toBeVisible();
  }
  await detail.getByRole("button", { name: "Record decision", exact: true }).click();
  const decision = page.getByRole("dialog", { name: "Create decision", exact: true });
  await decision.getByLabel("Title", { exact: true }).fill("Choose PostgreSQL for the task database");
  await decision.getByLabel("Context / problem").fill("Multiple teams update tasks concurrently.");
  await decision.getByLabel("Chosen approach").fill("Use PostgreSQL with transactional updates.");
  await decision.getByLabel("Rationale", { exact: true }).fill("Keep updates consistent and auditable.");
  await decision.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(detail.getByRole("link", { name: /Choose PostgreSQL/ })).toBeVisible();
  const persisted = await (await page.request.get(`/api/pm/requirements/${id}`)).json();
  expect(persisted.issues).toHaveLength(3);
  expect(persisted.decisions).toHaveLength(1);
  expect(persisted.original_request).toBe(sections["Original request"]);
  expect((await page.request.patch(`/api/pm/issues/${persisted.issues[0].id}`, { data: { status: "done" } })).status()).toBe(200);
  await page.reload();
  await expect(detail.getByText("1 of 3 tasks done · 1 decision", { exact: true })).toBeVisible();
  await detail.getByRole("tab", { name: "Work & decisions", exact: true }).click();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await noOverflow(page);
  await page.screenshot({ path: `test-results/requirements-work-${page.viewportSize()!.width}.png`, fullPage: true });
  await detail.getByRole("link", { name: /Frontend board/ }).click();
  const taskDetail = page.getByRole("dialog", { name: "Task Frontend board", exact: true });
  await expect(taskDetail.getByRole("link", { name: new RegExp(`${key}-REQ-1`) })).toBeVisible();
  await taskDetail.getByRole("button", { name: "Record decision", exact: true }).click();
  await expect(decision.getByRole("checkbox", { name: /Frontend board/ })).toBeChecked();
  await decision.getByRole("button", { name: "Cancel", exact: true }).click();
  await taskDetail.getByRole("link", { name: new RegExp(`${key}-REQ-1`) }).click();
  await detail.getByRole("button", { name: "Edit brief", exact: true }).click();
  const edit = page.getByRole("dialog", { name: `Edit ${key}-REQ-1`, exact: true });
  await edit.getByLabel("Scope", { exact: true }).fill("Internal teams, with a phased rollout.");
  await edit.getByRole("button", { name: "Save requirement", exact: true }).click();
  await detail.getByRole("tab", { name: "History", exact: true }).click();
  await detail.getByText("View changes (1)", { exact: true }).click();
  await expect(detail.getByText(sections.Scope, { exact: true })).toBeVisible();
  await expect(detail.getByText("Internal teams, with a phased rollout.", { exact: true })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await noOverflow(page);
  await page.screenshot({ path: `test-results/requirements-history-${page.viewportSize()!.width}.png`, fullPage: true });
  await page.goto("/requirements");
  await page.getByRole("searchbox", { name: "Search requirements" }).fill(sections.Title);
  await expect(page.getByRole("link", { name: sections.Title, exact: true }).filter({ visible: true })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await noOverflow(page);
  await page.screenshot({ path: `test-results/requirements-register-${page.viewportSize()!.width}.png`, fullPage: true });
  await page.getByRole("button", { name: "Toggle dark mode", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await waitForTransitions(page);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await noOverflow(page);
  await page.screenshot({ path: `test-results/requirements-dark-${page.viewportSize()!.width}.png`, fullPage: true });
  expect(errors).toEqual([]);
  expect(persisted.project_key).toBe(key);
});
