import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { mount, noOverflow } from "./projects-fixtures";

const brief = {
  id: "r1", key: "LIMS-REQ-1", project_id: "p1", project_key: "LIMS", project_name: "LIMS v3", project_status: "active",
  title: "Complete laboratory request", original_request: "Please centralize laboratory processing.", context: "Avoid duplicate work.",
  functional_requirements: "Upload and analyze files.", technical_requirements: "Use existing access controls.", scope: "Internal laboratory teams.",
  expected_outcome: "Faster analysis.", acceptance_criteria: "A team can process a file.", supporting_information: "Meeting notes.",
  status: "ready", owner_id: "dev", owner_name: "Ali Dev", my_role: "admin", version: 1,
  created_at: "2026-10-16T08:00:00Z", updated_at: "2026-10-16T08:00:00Z", task_count: 0, task_done: 0, decision_count: 0,
  issues: [], decisions: [], events: [{ id: "ev1", actor_name: "Sara Admin", action: "created", details: {}, created_at: "2026-10-16T08:00:00Z" }],
};

test("requirements are the default project view and read-only viewers can read the full brief", async ({ page }) => {
  await mount(page, "viewer");
  await page.route("**/api/pm/requirements**", (route) => route.fulfill({ json: new URL(route.request().url()).pathname.endsWith("/r1") ? { ...brief, my_role: "viewer" } : { items: [{ ...brief, my_role: "viewer" }], total: 1 } }));
  await page.goto("/projects/LIMS");
  await expect(page.getByRole("heading", { name: "Requirements", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create requirement" })).toHaveCount(0);
  await page.getByRole("link", { name: brief.title, exact: true }).filter({ visible: true }).click();
  const detail = page.getByRole("dialog", { name: brief.title, exact: true });
  await expect(detail.getByText(brief.original_request, { exact: true })).toBeVisible();
  await expect(detail.getByRole("button", { name: "Edit brief" })).toHaveCount(0);
  await expect(detail.getByRole("button", { name: "+ Attach file" })).toHaveCount(0);
  await detail.getByRole("tab", { name: "Work & decisions" }).click();
  for (const name of ["Create task", "Record decision", "Link existing task", "Link existing decision"]) await expect(detail.getByRole("button", { name, exact: true })).toHaveCount(0);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await noOverflow(page);
});

test("failed register and detail requests explain the error and retry", async ({ page }) => {
  await mount(page, "admin");
  let failed = true;
  await page.route("**/api/pm/requirements**", (route) => failed ? route.fulfill({ status: 503, json: { detail: "Requirements temporarily unavailable" } }) : route.fulfill({ json: new URL(route.request().url()).pathname.endsWith("/r1") ? brief : { items: [brief], total: 1 } }));
  await page.goto("/projects/LIMS");
  await expect(page.getByText("Requirements temporarily unavailable", { exact: true })).toBeVisible();
  failed = false;
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByRole("link", { name: brief.title, exact: true }).filter({ visible: true })).toBeVisible();
  failed = true;
  await page.getByRole("link", { name: brief.title, exact: true }).filter({ visible: true }).click();
  const detail = page.getByRole("dialog", { name: "Requirement", exact: true });
  await expect(detail.getByText("Requirements temporarily unavailable", { exact: true })).toBeVisible();
  failed = false;
  await detail.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByRole("dialog", { name: brief.title, exact: true }).getByText(brief.context, { exact: true })).toBeVisible();
  await noOverflow(page);
});

test("archived requirements keep files readable and stale saves preserve form input", async ({ page }) => {
  await mount(page, "admin");
  await page.route("**/api/pm/requirements/r1", (route) => route.request().method() === "PATCH" ? route.fulfill({ status: 409, json: { detail: "This requirement changed. Reload it before saving." } }) : route.fulfill({ json: { ...brief, status: "archived" } }));
  await page.goto("/projects/LIMS?requirement=r1");
  const detail = page.getByRole("dialog", { name: brief.title, exact: true });
  await expect(detail.getByText(/This requirement is archived/)).toBeVisible();
  await expect(detail.getByRole("button", { name: "+ Attach file" })).toHaveCount(0);
  await detail.getByRole("button", { name: "Restore / edit" }).click();
  const form = page.getByRole("dialog", { name: "Edit LIMS-REQ-1", exact: true });
  await form.getByLabel("Title", { exact: true }).fill("Preserve this unsaved title");
  await form.getByRole("button", { name: "Save requirement", exact: true }).click();
  await expect(form.getByRole("alert")).toContainText("This requirement changed");
  await expect(form.getByLabel("Title", { exact: true })).toHaveValue("Preserve this unsaved title");
  await noOverflow(page);
});

test("existing tasks and decisions can be linked from a requirement", async ({ page }) => {
  await mount(page, "admin");
  const linked: string[] = [];
  await page.route("**/api/pm/requirements/r1**", async (route) => {
    if (route.request().method() === "POST") linked.push(new URL(route.request().url()).pathname.split("/").pop()!);
    await route.fulfill({ status: route.request().method() === "POST" ? 201 : 200, json: brief });
  });
  await page.route("**/api/pm/projects/p1/decisions**", (route) => route.fulfill({ json: { total: 1, items: [{ id: "d1", key: "LIMS-DEC-1", title: "Existing architecture", status: "approved" }] } }));
  await page.goto("/projects/LIMS?requirement=r1");
  const detail = page.getByRole("dialog", { name: brief.title, exact: true });
  await detail.getByRole("tab", { name: "Work & decisions" }).click();
  for (const [kind, name, label] of [["issues", "task", /LIMS-2/], ["decisions", "decision", /LIMS-DEC-1/]] as const) {
    await detail.getByRole("button", { name: `Link existing ${name}`, exact: true }).click();
    const dialog = page.getByRole("dialog", { name: `Link existing ${name}`, exact: true });
    await dialog.getByRole("combobox", { name: "Record", exact: true }).click();
    await page.getByRole("option", { name: label }).click();
    await dialog.getByRole("button", { name: "Link record", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(linked).toContain(kind);
  }
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await noOverflow(page);
});
