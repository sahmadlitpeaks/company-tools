import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("admin can add and remove existing department members", async ({ page }) => {
  let members: Array<{ id: string; display_name: string; email: string; role: string; status: string; is_active: boolean }> = [];
  const department = { id: "department-1", name: "Finance", description: "Finance ownership",
    permissions: ["dashboard", "sharepoint_intelligence"], member_count: 0, created_at: "2026-01-01T00:00:00Z" };
  const person = { id: "user-1", display_name: "Alex Finance", email: "alex@example.com",
    role: "member", status: "active", is_active: true, is_admin: false,
    department_id: null, department_name: null, effective_permissions: ["dashboard"],
    managed_company_ids: [], created_at: "2026-01-01T00:00:00Z" };
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (!path.startsWith("/api/")) return route.continue();
    if (path === "/api/auth/me") return route.fulfill({ json: {
      id: "admin-1", email: "admin@example.com", display_name: "Administrator",
      is_admin: true, is_active: true, role: "admin", status: "active",
      effective_permissions: ["dashboard"], managed_company_ids: [], created_at: "2026-01-01T00:00:00Z",
    } });
    if (path === "/api/settings/public") return route.fulfill({ json: { platform_name: "Company Tools" } });
    if (path === "/api/departments") return route.fulfill({ json: [{ ...department, member_count: members.length }] });
    if (path === "/api/users/modules") return route.fulfill({ json: {
      modules: [{ key: "dashboard", label: "Dashboard" }, { key: "sharepoint_intelligence", label: "SharePoint Intelligence" }],
      role_defaults: { admin: ["dashboard"], member: ["dashboard"] },
    } });
    if (path === "/api/users") return route.fulfill({ json: [person] });
    if (path === "/api/departments/department-1/members") {
      if (route.request().method() === "POST") {
        members = [{ id: person.id, display_name: person.display_name, email: person.email,
          role: person.role, status: person.status, is_active: person.is_active }];
        return route.fulfill({ status: 201, json: members[0] });
      }
      return route.fulfill({ json: members });
    }
    if (path === "/api/departments/department-1/members/user-1" && route.request().method() === "DELETE") {
      members = [];
      return route.fulfill({ status: 204, body: "" });
    }
    if (path === "/api/notifications" || path === "/api/companies") return route.fulfill({ json: [] });
    if (path === "/api/notifications/unread-count") return route.fulfill({ json: { count: 0 } });
    return route.fulfill({ json: {} });
  });

  await page.goto("/departments");
  await expect(page.getByRole("heading", { name: "Departments" })).toBeVisible();
  await page.getByRole("button", { name: "Manage people" }).click();
  const dialog = page.getByRole("dialog", { name: "Finance people" });
  await expect(dialog.getByText("No people in this access group yet.")).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await dialog.getByRole("combobox", { name: "Person" }).click();
  await page.getByRole("option", { name: "Alex Finance" }).click();
  await dialog.getByRole("button", { name: "Add to Finance" }).click();
  await expect(page.getByRole("alertdialog", { name: "Add to Finance?" })).toBeVisible();
  await page.getByRole("alertdialog").getByRole("button", { name: "Add person" }).click();
  await expect(dialog.getByText("alex@example.com")).toBeVisible();
  await dialog.getByRole("button", { name: "Remove" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Remove person" }).click();
  await expect(dialog.getByText("No people in this access group yet.")).toBeVisible();
});
