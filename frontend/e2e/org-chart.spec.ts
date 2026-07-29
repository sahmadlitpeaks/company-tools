import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const user = {
  id: "user-1",
  email: "alex@example.com",
  display_name: "Alex Morgan",
  given_name: "Alex",
  is_active: true,
  is_admin: true,
  role: "admin",
  status: "active",
  effective_permissions: [],
  managed_company_ids: [],
  created_at: "2026-01-01T00:00:00Z",
};

const companies = [{
  id: "ag",
  slug: "ag-holding",
  name: "AG Holding",
  primary_color: "#facc15",
  accent_color: "#facc15",
  is_active: true,
  is_default: true,
  created_at: "2026-01-01T00:00:00Z",
}];

const organization = [{
  id: "person-1",
  name: "Alex Morgan",
  job_title: "Chief Executive Officer",
  department_name: "Leadership",
  avatar_url: null,
  report_count: 2,
  reports: [
    {
      id: "person-2",
      name: "Jamie Lee",
      job_title: "Operations Director",
      department_name: "Operations",
      avatar_url: null,
      report_count: 1,
      reports: [{
        id: "person-3",
        name: "Sam Patel",
        job_title: "Office Manager",
        department_name: "Operations",
        avatar_url: null,
        report_count: 0,
        reports: [],
      }],
    },
    {
      id: "person-4",
      name: "Taylor Kim",
      job_title: "Finance Director",
      department_name: "Finance",
      avatar_url: null,
      report_count: 0,
      reports: [],
    },
  ],
}];

test.beforeEach(async ({ page }) => {
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (!path.startsWith("/api/")) {
      await route.continue();
      return;
    }
    let body: unknown = {};
    if (path === "/api/auth/me") body = user;
    else if (path === "/api/companies") body = companies;
    else if (path === "/api/people/org-chart") body = organization;
    else if (path === "/api/notifications") body = [];
    else if (path === "/api/notifications/unread-count") body = { count: 0 };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
});

test("org chart list and tree use the company theme without overflow", async ({ page }) => {
  await page.goto("/org-chart");
  await expect(page.getByRole("heading", { name: "Org Chart" })).toBeVisible();
  await expect(page.getByRole("tree", { name: "Organization hierarchy" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Alex Morgan" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Jamie Lee" }).locator("xpath=ancestor::*[@role='treeitem'][1]")).toHaveAttribute("aria-level", "2");
  await expect(page.getByText("Leadership", { exact: true })).toBeVisible();
  await expect(page.getByLabel("2 direct reports")).toBeVisible();
  await expect(page.getByRole("button", { name: /reports for Taylor Kim/ })).toHaveCount(0);

  const rootStyles = await page.evaluate(() => {
    const styles = getComputedStyle(document.documentElement);
    return { primary: styles.getPropertyValue("--primary").trim(), radius: styles.getPropertyValue("--radius").trim() };
  });
  expect(rootStyles).toEqual({ primary: "#facc15", radius: "0px" });

  await page.getByRole("button", { name: "Tree", exact: true }).click();
  const canvas = page.getByTestId("org-chart-flow");
  await expect(canvas).toBeVisible();
  await expect(canvas).toHaveAttribute("aria-label", /Organization tree canvas/);
  await expect(page.getByRole("link", { name: "Alex Morgan" })).toBeVisible();
  const alexDisclosure = page.getByRole("button", { name: "Collapse reports for Alex Morgan" });
  await expect(alexDisclosure).toHaveAttribute("aria-expanded", "true");
  const nodePointerState = await alexDisclosure.evaluate((button) => {
    const node = button.closest<HTMLElement>(".react-flow__node");
    if (!node) throw new Error("React Flow node wrapper not found");
    const nodeBounds = node.getBoundingClientRect();
    const buttonBounds = button.getBoundingClientRect();
    const buttonStyles = getComputedStyle(button);
    return {
      pointerEvents: getComputedStyle(node).pointerEvents,
      width: Number.parseFloat(buttonStyles.width),
      height: Number.parseFloat(buttonStyles.height),
      insideNode:
        buttonBounds.left >= nodeBounds.left
        && buttonBounds.top >= nodeBounds.top
        && buttonBounds.right <= nodeBounds.right
        && buttonBounds.bottom <= nodeBounds.bottom,
    };
  });
  expect(nodePointerState.pointerEvents).not.toBe("none");
  expect(nodePointerState.width).toBeGreaterThanOrEqual(32);
  expect(nodePointerState.height).toBeGreaterThanOrEqual(32);
  expect(nodePointerState.insideNode).toBe(true);
  await alexDisclosure.click();
  await expect(page.getByRole("link", { name: "Jamie Lee" })).toBeHidden();
  await expect(page.getByRole("link", { name: "Taylor Kim" })).toBeHidden();
  const expandAlex = page.getByRole("button", { name: "Expand reports for Alex Morgan" });
  await expect(expandAlex).toHaveAttribute("aria-expanded", "false");
  await expandAlex.click();
  await expect(page.getByRole("link", { name: "Jamie Lee" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Sam Patel" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Taylor Kim" })).toBeVisible();
  await page.getByRole("button", { name: "Zoom in" }).click();
  await page.keyboard.press("Escape");
  await expect(page.locator('[data-slot="tooltip-content"]')).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  const accessibility = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(accessibility.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical")).toEqual([]);

  await page.getByRole("link", { name: "Alex Morgan" }).click();
  await expect(page).toHaveURL(/\/people\/person-1$/);
});
