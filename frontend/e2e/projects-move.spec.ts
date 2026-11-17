import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { mount, noOverflow } from "./projects-fixtures";

// BRD section 8: preview every change, then move; the moved issue opens at its new key.
test("an issue moves to another project after a preview of the changes", async ({ page }) => {
  await mount(page, "admin");
  const target = { id: "p2", key: "WIMS", name: "WIMS360", status: "active", my_role: "admin", my_permissions: ["project.view", "issue.move_in"],
    lead_name: null, issue_count: 0, done_count: 0, member_count: 1, overdue_count: 0, health: "on_track", description: null,
    lead_id: null, sprints_enabled: true, start_date: null, target_date: null, created_at: "2026-01-01T00:00:00Z" };
  const bodies: unknown[] = [];
  // The source project is filtered out of the choices, so the list only needs the target.
  await page.route("**/api/pm/projects", (route) => route.fulfill({ json: [target] }));
  await page.route("**/api/pm/issues/move/preview", async (route) => {
    bodies.push(route.request().postDataJSON());
    await route.fulfill({ json: {
      target: { id: "p2", key: "WIMS", name: "WIMS360" }, count: 1, assignees_added: 0, left_behind: [],
      people_losing_access: ["Dr T"],
      issues: [{ id: "s1", old_key: "LIMS-2", new_key: "WIMS-1", summary: "Upload files", issue_type: "story", selected: true,
        status_from: "todo", status_to: "todo", dropped: ["component api"], notes: [] }],
    } });
  });
  await page.route("**/api/pm/issues/move", async (route) => {
    bodies.push(route.request().postDataJSON());
    await route.fulfill({ json: { target: "WIMS", moved: [{ id: "s1", old_key: "LIMS-2", new_key: "WIMS-1" }] } });
  });

  await page.goto("/projects/LIMS?issue=LIMS-2");
  const panel = page.getByRole("dialog").first();
  await panel.getByRole("button", { name: "Move", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: /Move issue to another project/ });
  await dialog.getByRole("combobox", { name: "Target project" }).click();
  await page.getByRole("option", { name: "WIMS · WIMS360" }).click();
  await dialog.getByRole("button", { name: "Review changes" }).click();
  await expect(dialog.getByText("WIMS-1")).toBeVisible();
  await expect(dialog.getByText("Dropped (kept in history): component api")).toBeVisible();
  await expect(dialog.getByText(/Dr T can't see WIMS/)).toBeVisible();
  expect(bodies[0]).toMatchObject({ target_project_id: "p2", assignee_action: "unassign" });

  const accessibility = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(accessibility.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
  await noOverflow(page);

  await dialog.getByRole("button", { name: "Move issue" }).click();
  await expect(page).toHaveURL(/\/projects\/WIMS\?issue=WIMS-1/);
  expect(bodies).toHaveLength(2);
});
