import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const initial = { id: "work", title: "Renew lab accreditation", status: "todo", priority: "normal", due_date: "2027-01-20",
  assignee_id: "member", assignee_name: "Maya", can_change_status: true, can_delete: false,
  created_at: "2026-09-30T08:00:00Z", subtasks_total: 0, subtasks_done: 0, comment_count: 0 };
async function setup(page: Page, source: "ordinary" | "compliance" = "ordinary", reject = false) {
  let task = { ...initial, ...(source === "compliance" ? { source: "compliance", access_state: "ready", document_id: "file" } : {}) };
  const requests: Array<{ path: string; body: Record<string, unknown> }> = [];
  async function mount(target: Page, admin = false) {
    await target.route("**/api/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (!path.startsWith("/api/")) return route.continue();
      const method = route.request().method();
      let json: unknown = [];
      if (path === "/api/auth/me") json = { id: admin ? "admin" : "member", email: "maya@example.com", display_name: "Maya", role: admin ? "admin" : "member", is_admin: admin,
        is_active: true, status: "active", effective_permissions: ["tasks", "sharepoint_intelligence"], managed_company_ids: [] };
      else if (path === "/api/settings/public") json = { platform_name: "AG Holding" };
      else if (path === "/api/notifications/unread-count") json = { count: 0 };
      else if (path === "/api/tasks/options") json = { users: [{id:"member",name:"Maya",in_team:true}], departments: [] };
      else if (path === "/api/tasks" && method === "GET") json = source === "ordinary" ? [task] : [];
      else if (path === "/api/tasks/compliance") json = { tasks: source === "compliance" ? [task] : [], available: true, message: null };
      else if (method === "PATCH") {
        const body = route.request().postDataJSON();
        requests.push({path,body});
        if (reject) return route.fulfill({status:403,json:{detail:"This task can no longer be changed."}});
        task = { ...task, status: body.status === "completed" ? "done" : body.status === "active" ? body.work_status ?? "todo" : body.status };
        json = task;
      }
      await route.fulfill({json});
    });
    await target.goto("/tasks");
    if (admin) await target.getByRole("button", {name:"By status",exact:true}).click();
    await expect(target.getByRole("button", {name:"Move task: Renew lab accreditation"})).toBeVisible();
  }
  await mount(page);
  return {requests,mount};
}
async function keyboardMove(page: Page) {
  const handle = page.getByRole("button",{name:"Move task: Renew lab accreditation"});
  await page.bringToFront();
  await handle.focus();
  await page.keyboard.press("Space");
  await expect(page.getByText("Over To do.", {exact:true})).toBeAttached();
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.keyboard.press(page.viewportSize()!.width < 768 ? "ArrowDown" : "ArrowRight");
  await expect(page.getByText("Over In progress.",{exact:true})).toBeAttached();
  await page.keyboard.press("Space");
}
test("keyboard Kanban move persists and admin automatically sees employee progress", async ({page,context}) => {
  const state = await setup(page);
  const admin = await context.newPage();
  await admin.clock.install();
  await state.mount(admin,true);
  await keyboardMove(page);
  await expect(page.getByRole("region",{name:"Tasks for In progress"}).getByRole("button",{name:"Open task: Renew lab accreditation"})).toBeVisible();
  expect(state.requests).toEqual([{path:"/api/tasks/work",body:{status:"in_progress"}}]);
  await admin.clock.fastForward(16_000);
  await expect(admin.getByRole("region",{name:"Tasks for In progress"}).getByRole("button",{name:"Open task: Renew lab accreditation"})).toBeVisible();
  await page.reload();
  await expect(page.getByRole("region",{name:"Tasks for In progress"}).getByRole("button",{name:"Open task: Renew lab accreditation"})).toBeVisible();
  expect((await new AxeBuilder({page}).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({path:`test-results/kanban-${page.viewportSize()!.width}.png`,fullPage:true});
});
test("pointer drag moves ordinary task and cancellation leaves state unchanged", async ({page}) => {
  const state = await setup(page);
  const handle = page.getByRole("button",{name:"Move task: Renew lab accreditation"});
  const target = page.getByRole("region",{name:"Tasks for In progress"});
  await target.scrollIntoViewIfNeeded();
  // Mouse events also exercise the pointer sensor in the configured mobile layout.
  const from = await handle.boundingBox();
  await handle.scrollIntoViewIfNeeded();
  const start = await handle.boundingBox();
  const end = await target.boundingBox();
  expect(from).not.toBeNull();
  await page.mouse.move(start!.x+start!.width/2,start!.y+start!.height/2);
  await page.mouse.down();
  await page.mouse.move(start!.x+start!.width/2+12,start!.y+start!.height/2,{steps:3});
  await page.mouse.move(end!.x+end!.width/2,end!.y+30,{steps:10});
  await page.mouse.up();
  await expect(target.getByRole("button",{name:"Open task: Renew lab accreditation"})).toBeVisible();
  expect(state.requests[0]).toEqual({path:"/api/tasks/work",body:{status:"in_progress"}});
  await handle.focus(); await page.keyboard.press("Space"); await page.keyboard.press("Escape");
  expect(state.requests).toHaveLength(1);
});
test("failed move reports error and keeps original status",async ({page}) => {
  await setup(page,"ordinary",true);
  await keyboardMove(page);
  await expect(page.getByRole("alert").filter({hasText:"This task can no longer be changed."})).toBeVisible();
  await expect(page.getByRole("region",{name:"Tasks for To do"}).getByRole("button",{name:"Open task: Renew lab accreditation"})).toBeVisible();
});
test("Compliance drag completes and reopens in one atomic request",async ({page}) => {
  const state = await setup(page,"compliance");
  const status = page.getByRole("combobox",{name:"Status for Renew lab accreditation"});
  await status.click(); await page.getByRole("option",{name:"Done",exact:true}).click();
  await expect(page.getByRole("region",{name:"Tasks for Done"}).getByRole("button",{name:"Open task: Renew lab accreditation"})).toBeVisible();
  await status.click(); await page.getByRole("option",{name:"Blocked",exact:true}).click();
  await expect(page.getByRole("region",{name:"Tasks for Blocked"}).getByRole("button",{name:"Open task: Renew lab accreditation"})).toBeVisible();
  expect(state.requests).toEqual([
    {path:"/api/sharepoint/compliance/tasks/work",body:{status:"completed"}},
    {path:"/api/sharepoint/compliance/tasks/work",body:{status:"active",work_status:"blocked"}}]);
});

test("touch drag changes an employee task on a phone", async ({page,context,isMobile}) => {
  test.skip(!isMobile, "Real touch is exercised on the configured Pixel 5 project.");
  const state = await setup(page);
  const column = page.getByRole("region",{name:"Tasks for To do"});
  await column.evaluate((node) => node.scrollIntoView({block:"start"}));
  const handle = await page.getByRole("button",{name:"Move task: Renew lab accreditation"}).boundingBox();
  const target = await page.getByRole("region",{name:"Tasks for In progress"}).boundingBox();
  const session = await context.newCDPSession(page);
  const from = {x: handle!.x+handle!.width/2,y: handle!.y+handle!.height/2};
  const to = {x: target!.x+target!.width/2,y: target!.y+30};
  await session.send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[from]});
  for(let step=1;step<=12;step++) await session.send("Input.dispatchTouchEvent",{type:"touchMove",
    touchPoints:[{x:from.x+(to.x-from.x)*step/12,y:from.y+(to.y-from.y)*step/12}]});
  await session.send("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]});
  await expect(page.getByRole("region",{name:"Tasks for In progress"}).getByRole("button",{name:"Open task: Renew lab accreditation"})).toBeVisible();
  expect(state.requests).toEqual([{path:"/api/tasks/work",body:{status:"in_progress"}}]);
  await session.detach();
});
