import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const id = "44444444-4444-4444-8444-444444444444";
test("document task reconnect returns to its card, unlocks status and persists", async ({page}) => {
  let connected = false;
  let status = "todo";
  const mutations: unknown[] = [];
  const preview = {id, source:"compliance",title:"Document task assigned",status,priority:"normal",
    assignee_id:"member",assignee_name:"Maya",can_change_status:false,can_assign:false,can_delete:false,
    access_state:"microsoft_connection_required",access_message:"Connect Microsoft to verify file access.",
    created_at:"2026-09-30T09:00:00Z",subtasks_total:0,subtasks_done:0,comment_count:0};
  await page.route("**/api/**", async route => {
    const url=new URL(route.request().url());
    if (!url.pathname.startsWith("/api/")) return route.continue();
    let json: unknown = [];
    if (url.pathname==="/api/auth/me") json={id:"member",display_name:"Maya",role:"member",is_admin:false,
      status:"active",is_active:true,effective_permissions:["tasks","sharepoint_intelligence"],managed_company_ids:[]};
    else if (url.pathname==="/api/settings/public") json={platform_name:"AG Holding"};
    else if (url.pathname==="/api/notifications/unread-count") json={count:0};
    else if (url.pathname==="/api/tasks/options") json={users:[],departments:[]};
    else if (url.pathname==="/api/sharepoint/connect") {
      expect(url.searchParams.get("return_to")).toBe("/tasks?task="+id);
      connected=true;
      return route.fulfill({status:303,headers:{location:"/tasks?task="+id+"&connected=1"}});
    } else if (route.request().method()==="PATCH") {
      const body=route.request().postDataJSON(); mutations.push(body);
      expect(url.pathname).toBe("/api/sharepoint/compliance/tasks/"+id+"/progress");
      status=body.status; json={ok:true};
    } else if (url.pathname==="/api/tasks/compliance") {
      const task = connected && !url.searchParams.has("preview")
        ? {...preview,status,title:"Renew trade license",access_state:"ready",can_change_status:true,
            due_date:"2027-01-20",company:"Vendor LLC",document_name:"Trade license.docx",basis:"expiry"}
        : {...preview,status};
      json={tasks:[task],available:true,message:null};
    }
    return route.fulfill({json});
  });
  await page.goto("/tasks");
  await expect(page.getByRole("button",{name:"Move task: Document task assigned"})).toBeDisabled();
  await page.getByRole("button",{name:"Connect Microsoft to use this task"}).click();
  await expect(page).toHaveURL(new RegExp("task="+id+"&connected=1"));
  const dialog=page.getByRole("dialog",{name:"Renew trade license"});
  await expect(dialog.getByText("Trade license.docx",{exact:true})).toBeVisible();
  const choice=dialog.getByRole("combobox",{name:"Status",exact:true});
  await expect(choice).toBeEnabled();
  await choice.click();
  await page.getByRole("option",{name:"In progress",exact:true}).click();
  await expect.poll(()=>mutations).toEqual([{status:"in_progress"}]);
  await expect(dialog.getByRole("combobox",{name:"Status",exact:true})).toContainText("In progress");
  await page.keyboard.press("Escape");
  await page.getByRole("button",{name:"Dismiss",exact:true}).click();
  await expect(page).not.toHaveURL(/connected=/);
  await page.reload();
  await expect(page.getByRole("region",{name:"Tasks for In progress"}).getByRole("button",{name:"Open task: Renew trade license"})).toBeVisible();
  await page.screenshot({path:"test-results/reconnected-task-"+page.viewportSize()!.width+".png",fullPage:true});
  expect((await new AxeBuilder({page}).analyze()).violations).toEqual([]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});

test("failed callback offers fresh connection and dismiss keeps task deep link",async ({page})=>{
  await page.route("**/api/**",async route=>{
    const path=new URL(route.request().url()).pathname;
    if(!path.startsWith("/api/")) return route.continue();
    let json: unknown=[];
    if(path==="/api/auth/me") json={id:"member",role:"member",status:"active",is_active:true,is_admin:false,effective_permissions:["tasks"],managed_company_ids:[]};
    else if(path==="/api/settings/public") json={platform_name:"AG Holding"};
    else if(path==="/api/notifications/unread-count") json={count:0};
    else if(path==="/api/tasks/options") json={users:[],departments:[]};
    else if(path==="/api/tasks/compliance") json={tasks:[{id,title:"Document task assigned",source:"compliance",status:"todo",priority:"normal",
      assignee_id:"member",assignee_name:"Maya",can_change_status:false,can_assign:false,can_delete:false,
      access_state:"microsoft_connection_required",access_message:"Connect Microsoft to verify file access.",
      created_at:"2026-09-30T09:00:00Z",subtasks_total:0,subtasks_done:0,comment_count:0}],available:true,message:null};
    return route.fulfill({json});
  });
  await page.goto("/tasks?task="+id+"&microsoft_error=microsoft_connection_save_failed");
  const dialog=page.getByRole("dialog",{name:"Document task assigned"});
  await expect(dialog).toBeVisible();
  const alert=dialog.getByRole("alert").filter({hasText:"workspace could not save"});
  await expect(alert).toBeVisible();
  await page.screenshot({path:"test-results/microsoft-recovery-"+page.viewportSize()!.width+".png",fullPage:true});
  const retry=alert.getByRole("button",{name:"Try Microsoft connection again"});
  await expect(retry).toHaveAttribute("href","/api/sharepoint/connect?return_to=%2Ftasks%3Ftask%3D"+id);
  await alert.getByRole("button",{name:"Dismiss",exact:true}).click();
  await expect(page).toHaveURL(new RegExp("/tasks\\?task="+id+"$"));
  await expect(alert).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await expect(page.getByText("This task is no longer available",{exact:false})).toHaveCount(0);
});
