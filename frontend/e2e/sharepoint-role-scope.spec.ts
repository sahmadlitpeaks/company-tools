import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

for (const role of ["member","manager","admin"] as const) {
  test(role+" sees only relevant document pages and role scope",async ({page,isMobile})=>{
    await page.clock.install();
    const requests:string[]=[];
    let searchDenied = false;
    const docs = [{id:"own",name:"Assigned Finance contract.txt",path:"/Finance/own.txt",status:"ready",
      languages:["en"],requires_attention:false,modified_at:null,analysis:null,segments:[],url:"https://example.sharepoint.com/own"}];
    if(role!=="member") docs.push({...docs[0],id:"peer",name:"Team Finance license.txt",path:"/Finance/peer.txt"});
    if(role==="admin") docs.push({...docs[0],id:"other",name:"Marketing plan.txt",path:"/Marketing/plan.txt"});
    await page.route("**/api/**",async route=>{
      const path=new URL(route.request().url()).pathname;
      if(!path.startsWith("/api/")) return route.continue();
      requests.push(path);
      let json:unknown=[];
      if(path==="/api/auth/me") json={id:"user",display_name:"Ash",role,is_admin:role==="admin",is_active:true,status:"active",
        department_id:"finance",effective_permissions:["sharepoint_intelligence","tasks"],managed_company_ids:[]};
      else if(path==="/api/settings/public") json={platform_name:"AG Holding"};
      else if(path==="/api/notifications/unread-count") json={count:0};
      else if(path==="/api/sharepoint/status") json={enabled:true,configured:true,connected:true,missing:[],can_review:role!=="member",
        active_run:false,last_sync:null,user_id:"user",openai_configured:false,polling_enabled:true};
      else if(path==="/api/sharepoint/search") {
        if (searchDenied) return route.fulfill({status:403,json:{detail:"document_access_denied"}});
        json={items:docs,next_cursor:null};
      }
      else if(path==="/api/sharepoint/compliance/options") json={companies:[],departments:[],users:[]};
      else if(path==="/api/sharepoint/compliance/dashboard") json={summary:{expiring_60:0,expiring_30:0,due_this_week:0,overdue:0,
        needs_review:0,unassigned:0,tasks_by_owner:{},documents_by_company:{}},documents:[],tasks:[]};
      return route.fulfill({json});
    });
    await page.goto("/sharepoint");
    await expect(page.getByRole("heading",{name:/Good .*Ash/})).toBeVisible();
    await expect(page.getByText("Assigned Finance contract.txt",{exact:true})).toBeVisible();
    await expect(page.getByText("Marketing plan.txt",{exact:true})).toHaveCount(role==="admin"?1:0);
    await expect(page.getByText("Team Finance license.txt",{exact:true})).toHaveCount(role==="member"?0:1);
    if(isMobile) await page.getByRole("button",{name:"Open navigation menu"}).click();
    const nav=isMobile?page.locator('[data-slot="sidebar"][data-mobile="true"]'):page.locator('[data-slot="sidebar-inner"]');
    const group=nav.locator('[data-slot="sidebar-group"]',{hasText:"Documents"});
    await expect(group.getByRole("link",{name:"Compliance",exact:true})).toHaveCount(role==="member"?0:1);
    await expect(group.getByRole("link",{name:"Document sources",exact:true})).toHaveCount(role==="admin"?1:0);
    const label=role==="admin"?"Documents":role==="manager"?"Team documents":"My documents";
    await expect(group.getByRole("link",{name:label,exact:true})).toBeVisible();
    await group.getByRole("link",{name:label,exact:true}).click();
    if (isMobile) {
      await page.clock.runFor(500);
      await expect(nav).toHaveCount(0);
    }
    await expect(page.getByRole("heading",{name:label,exact:true})).toBeVisible();
    await expect(page.getByRole("main",{name:label,exact:true})).toBeVisible();
    expect((await new AxeBuilder({page}).analyze()).violations).toEqual([]);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
    await page.screenshot({path:"test-results/document-scope-"+role+"-"+page.viewportSize()!.width+".png",fullPage:true});

    // Assignments can change while this tab is open and no sync is running.
    const own = docs.shift()!;
    await page.clock.fastForward(31_000);
    await expect(page.getByRole("button",{name:own.name,exact:true})).toHaveCount(0);
    docs.unshift(own);
    await page.evaluate(()=>window.dispatchEvent(new Event("focus")));
    await expect(page.getByRole("button",{name:own.name,exact:true})).toBeVisible();
    searchDenied = true;
    await page.evaluate(()=>window.dispatchEvent(new Event("focus")));
    await expect(page.getByRole("button",{name:own.name,exact:true})).toHaveCount(0);

    if(role!=="admin"){
      await page.goto("/sharepoint/admin");
      await expect(page.getByText("No access",{exact:true})).toBeVisible();
      expect(requests.filter(path=>path==="/api/sharepoint/sources")).toHaveLength(0);
    }
    if(role==="member"){
      const before=requests.length;
      await page.goto("/sharepoint/compliance");
      await expect(page.getByText("No access",{exact:true})).toBeVisible();
      expect(requests.slice(before)).not.toContain("/api/sharepoint/compliance/dashboard");
      await page.keyboard.press("Control+k");
      const palette=page.getByRole("dialog");
      await expect(palette.getByRole("option",{name:/Compliance/})).toHaveCount(0);
      await expect(palette.getByRole("option",{name:/Document sources/})).toHaveCount(0);
    }
  });
}
