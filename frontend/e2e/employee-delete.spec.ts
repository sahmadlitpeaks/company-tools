import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const employee = { id: "employee", email: "typo@example.com", display_name: "New Employee", role: "member", status: "active", is_active: true, is_admin: false, effective_permissions: ["tasks"], extra_permissions: [], revoked_permissions: [], managed_company_ids: [] };
async function setup(page: Page, blocked=false, admin=true) {
  let deleted=false;
  let changed: unknown;
  await page.route("**/api/**", async (route) => {
    const path=new URL(route.request().url()).pathname;
    if (!path.startsWith("/api/")) { await route.continue(); return; }
    const method=route.request().method();
    let json: unknown=[];
    if (path === "/api/auth/me") json={ ...employee, id:"admin", email:"admin@example.com", display_name:"Admin", is_admin:admin, role:admin ? "admin":"member", effective_permissions:["directory","tasks","settings"] };
    else if (path === "/api/settings/public") json={ platform_name:"AG Holding" };
    else if (path === "/api/notifications/unread-count") json={ count:0 };
    else if (path === "/api/users") json=deleted ? []:[employee];
    else if (path === "/api/users/modules") json={ modules:[{ key:"tasks", label:"Tasks" }],role_defaults:{ member:["tasks"],admin:["tasks"] } };
    else if (path === "/api/users/employee/deletion") json={ can_delete:!blocked, reason:blocked ? "This employee has linked business records.":null, blockers:blocked ? [{ label:"Tasks and projects",count:1 }]:[] };
    else if (path === "/api/users/employee" && method === "DELETE") { deleted=true; return route.fulfill({status:204}); }
    else if (path === "/api/users/employee" && method === "PATCH") { changed=route.request().postDataJSON(); json={...employee,...changed as object}; }
    await route.fulfill({json});
  });
  return { changed:()=>changed };
}
test("admin confirms permanent deletion with exact account email",async ({page})=>{
  await setup(page);
  await page.goto("/directory");
  await page.getByRole("button",{name:"Delete employee: New Employee"}).click();
  const dialog=page.getByRole("alertdialog");
  await expect(dialog.getByRole("button",{name:"Delete employee",exact:true})).toBeDisabled();
  await dialog.getByRole("textbox").fill("typo@example.com");
  await expect(dialog.getByRole("button",{name:"Delete employee",exact:true})).toBeEnabled();
  await expect(dialog.getByRole("button",{name:"Delete employee",exact:true})).toHaveCSS("opacity", "1");
  expect((await new AxeBuilder({page}).analyze()).violations).toEqual([]);
  await page.screenshot({path: "test-results/employee-delete-" + page.viewportSize()!.width + ".png", fullPage:true});
  await dialog.getByRole("button",{name:"Delete employee",exact:true}).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("button",{name:"Delete employee: New Employee"})).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
test("linked employee deletion explains blocking records",async ({page})=>{
  await setup(page,true);
  await page.goto("/directory");
  await page.getByRole("button",{name:"Delete employee: New Employee"}).click();
  const dialog=page.getByRole("alertdialog");
  await expect(dialog.getByText("Tasks and projects: 1")).toBeVisible();
  await expect(dialog.getByRole("button",{name:"Delete employee",exact:true})).toBeDisabled();
});
test("admin can correct login email without replacing employee identity",async ({page})=>{
  const mock=await setup(page);
  await page.goto("/directory");
  await page.getByRole("button",{name:"Access",exact:true}).click();
  await page.getByRole("textbox",{name:"Official / login email"}).fill("correct@example.com");
  await page.getByRole("button",{name:"Save",exact:true}).click();
  await expect.poll(mock.changed).toMatchObject({email:"correct@example.com"});
});
test("non-admin has no employee deletion action",async ({page})=>{
  await setup(page,false,false);
  await page.goto("/directory");
  await expect(page.getByText("New Employee",{exact:true})).toBeVisible();
  await expect(page.getByRole("button",{name:"Delete employee: New Employee"})).toHaveCount(0);
});
