import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { mount, noOverflow, selectProjectTab } from "./projects-fixtures";

test("navigation separates project filters from all issues and survives history", async ({ page }, testInfo) => {
  const mutations = await mount(page, "admin", { workspace: true });
  await page.goto("/projects");
  const navigation = page.getByRole("tablist", { name: "Projects navigation" });
  await expect(navigation.getByRole("tab", { name: "Projects", exact: true })).toHaveAttribute("aria-selected", "true");
  const status = page.getByRole("group", { name: "Project status" });
  const layout = page.getByRole("group", { name: "Project layout" });
  await expect(status.getByRole("button", { name: "Active", exact: true })).toHaveAttribute("aria-pressed", "true");
  await layout.getByRole("button", { name: "Cards", exact: true }).press("ArrowRight");
  await expect(layout.getByRole("button", { name: "Timeline", exact: true })).toBeFocused();
  await page.keyboard.press("Space");
  await expect(page).toHaveURL(/layout=timeline/);
  await expect(page.getByRole("region", { name: "Project schedule" })).toBeVisible();
  await noOverflow(page);
  await page.screenshot({ path: `test-results/projects-timeline-${testInfo.project.name}.png`, fullPage: true });
  await status.getByRole("button", { name: "Archived", exact: true }).click();
  await expect(page).toHaveURL(/status=archived/);
  await page.reload();
  await expect(status.getByRole("button", { name: "Archived", exact: true })).toHaveAttribute("aria-pressed", "true");
  await navigation.getByRole("tab", { name: "All issues", exact: true }).click();
  await expect(status).toHaveCount(0);
  await expect(layout).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Search issues", exact: true })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await noOverflow(page);
  await page.screenshot({ path: `test-results/projects-all-issues-${testInfo.project.name}.png`, fullPage: true });
  await page.goBack();
  await expect(status.getByRole("button", { name: "Archived", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(layout.getByRole("button", { name: "Timeline", exact: true })).toHaveAttribute("aria-pressed", "true");
  expect(mutations).toEqual([]);
});

test("cards have a clear entry action and project views have return navigation", async ({ page }, testInfo) => {
  const mutations = await mount(page, "viewer", { workspace: true });
  await page.goto("/projects?layout=invalid");
  await expect(page.getByRole("button", { name: "Cards", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "New project", exact: true })).toHaveCount(0);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await noOverflow(page);
  await page.screenshot({ path: `test-results/projects-cards-${testInfo.project.name}.png`, fullPage: true });
  await page.getByRole("link", { name: "Open project LIMS v3", exact: true }).click();
  await expect(page.getByRole("heading", { name: "LIMS v3", level: 1 })).toBeVisible();
  await selectProjectTab(page, "People");
  await noOverflow(page);
  await expect(page.getByRole("button", { name: "Create issue", exact: true })).toHaveCount(0);
  await page.getByRole("link", { name: "Back to projects", exact: true }).click();
  await expect(page).toHaveURL(/\/projects$/);
  expect(mutations).toEqual([]);
});

test("undated timeline projects stay reachable", async ({ page }, testInfo) => {
  await mount(page, "viewer");
  const longName = "Laboratory information management and document compliance workspace";
  await page.route("**/api/pm/projects?*", async (route) => {
    await route.fulfill({ json: Array.from({ length: 8 }, (_, index) => ({ id: `p${index + 1}`, key: index === 0 ? "LIMS" : `OPS${index}`, name: index === 0 ? "LIMS without dates" : index === 1 ? longName : `Operations project ${index + 1}`, lead_name: index === 0 ? "Sara Admin" : null, status: "active", start_date: null, target_date: null, issue_count: index === 0 ? 3 : 0, done_count: index === 0 ? 1 : 0, health: "on_track", overdue_count: 0 })) });
  });
  await page.goto("/projects?layout=timeline");
  await expect(page.getByText("No scheduled projects", { exact: true })).toBeVisible();
  const undated = page.getByRole("region", { name: "Without dates 8", exact: true });
  await expect(undated.getByRole("link", { name: "LIMS without dates", exact: true })).toBeVisible();
  await expect(undated.getByRole("link", { name: longName, exact: true })).toBeVisible();
  await expect(undated.getByText("Lead: Sara Admin", { exact: true })).toBeVisible();
  await expect(undated.getByRole("link", { name: /^Open project / })).toHaveCount(8);
  await expect(page.getByRole("group", { name: "Time scale", exact: true })).toHaveCount(0);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await noOverflow(page);
  await page.screenshot({ path: `test-results/projects-undated-${testInfo.project.name}.png`, fullPage: true });
  await page.getByRole("button", { name: "Toggle dark mode", exact: true }).click();
  await page.screenshot({ path: `test-results/projects-undated-dark-${testInfo.project.name}.png`, fullPage: true, animations: "disabled" });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await noOverflow(page);
  await undated.getByRole("link", { name: "Open project LIMS without dates", exact: true }).press("Enter");
  await expect(page.getByRole("heading", { name: "LIMS v3", level: 1 })).toBeVisible();
});

test("mixed timeline keeps its schedule controls and undated project cards", async ({ page }) => {
  await mount(page, "viewer");
  await page.route("**/api/pm/projects?*", (route) => route.fulfill({ json: [
    { id: "p1", key: "LIMS", name: "Scheduled lab project", lead_name: "Sara Admin", status: "active", start_date: "2026-10-01", target_date: "2026-12-31", issue_count: 3, done_count: 1, health: "on_track", overdue_count: 0 },
    { id: "p2", key: "OPS", name: "Operations without dates", status: "active", start_date: null, target_date: null, issue_count: 0, done_count: 0, health: "on_track", overdue_count: 0 },
  ] }));
  await page.goto("/projects?layout=timeline");
  await expect(page.getByRole("region", { name: "Project schedule", exact: true })).toBeVisible();
  await expect(page.getByRole("group", { name: "Time scale", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open project Operations without dates", exact: true })).toBeVisible();
  await expect(page.getByText("No scheduled projects", { exact: true })).toHaveCount(0);
  await noOverflow(page);
});

test("project errors retry and archived empty state remains distinct", async ({ page }) => {
  await mount(page, "admin");
  let fail = true;
  await page.route("**/api/pm/projects?*", async (route) => {
    await route.fulfill(fail ? { status: 503, json: { detail: "Projects temporarily unavailable" } } : { json: [] });
  });
  await page.goto("/projects?status=archived");
  await expect(page.getByText("Projects temporarily unavailable", { exact: true })).toBeVisible();
  fail = false;
  await page.getByRole("button", { name: /retry/i }).click();
  await expect(page.getByText("No archived projects", { exact: true })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("0 archived projects");
  await noOverflow(page);
});

test("archived project return preserves status and invalid mobile view falls back", async ({ page }) => {
  const mutations = await mount(page, "viewer", { archived: true });
  await page.goto("/projects/LIMS?tab=settings");
  await expect(page.getByText("This project is archived. Its issues are read-only.", { exact: true })).toBeVisible();
  if (page.viewportSize()!.width < 1280) await expect(page.getByRole("combobox", { name: "Project view", exact: true })).toContainText("Boards & views");
  else await expect(page.getByRole("tab", { name: "Boards & views", exact: true })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("link", { name: "Back to projects", exact: true }).click();
  await expect(page).toHaveURL(/status=archived/);
  expect(mutations).toEqual([]);
});

test("switching status shows loading instead of stale projects", async ({ page }) => {
  await mount(page, "viewer");
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/pm/projects?status=archived", async (route) => {
    await pending;
    await route.fulfill({ json: [] });
  });
  await page.goto("/projects");
  await expect(page.getByRole("link", { name: "Open project LIMS v3", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Archived", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Loading projects" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open project LIMS v3", exact: true })).toHaveCount(0);
  release();
  await expect(page.getByText("No archived projects", { exact: true })).toBeVisible();
});

test("long project titles wrap and dark mode controls remain accessible", async ({ page }) => {
  await mount(page, "viewer");
  const name = "Laboratory information management and document compliance workspace";
  await page.route("**/api/pm/projects?*", (route) => route.fulfill({ json: [{ id: "p1", key: "LIMS", name, lead_name: "Sara Admin", status: "active", issue_count: 1647, done_count: 1377, member_count: 15, my_role: "viewer", health: "at_risk", overdue_count: 20 }] }));
  await page.goto("/projects");
  await expect(page.getByRole("link", { name, exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Toggle dark mode", exact: true }).click();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await noOverflow(page);
});
