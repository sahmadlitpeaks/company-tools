import { expect, test } from "@playwright/test";
test("admin sees missing deployment email settings and can check without sending",async ({page})=>{
  const posts:string[]=[];
  await page.route("**/api/**",async route=>{
    const path=new URL(route.request().url()).pathname;
    if (!path.startsWith("/api/")) { await route.continue(); return; }
    if(route.request().method()==="POST") posts.push(path);
    let json:unknown=[];
    if(path==="/api/auth/me") json={id:"admin",email:"admin@example.com",display_name:"Admin",is_admin:true,role:"admin",is_active:true,status:"active",effective_permissions:[],managed_company_ids:[]};
    else if(path==="/api/settings/public") json={platform_name:"AG Holding"};
    else if(path==="/api/notifications/unread-count") json={count:0};
    else if(path==="/api/notifications/channels") json={outbound_enabled:false,email_configured:false,slack_configured:false,teams_configured:false,email_diagnostics:{configured:false,missing:["SMTP_USER","SMTP_PASSWORD","SMTP_FROM"],issues:[]}};
    else if(path==="/api/notifications/email/check") json={ok:false,message:"The mail server rejected the login. Check the SMTP credentials and mailbox authentication settings."};
    await route.fulfill({json});
  });
  await page.goto("/settings");
  await expect(page.getByText("Missing deployment settings: SMTP_USER, SMTP_PASSWORD, SMTP_FROM.")).toBeVisible();
  await page.getByRole("button",{name:"Check email connection"}).click();
  await expect(page.getByText("The mail server rejected the login. Check the SMTP credentials and mailbox authentication settings.")).toBeVisible();
  expect(posts).toEqual(["/api/notifications/email/check"]);
  await page.screenshot({path:"test-results/email-check-" + page.viewportSize()!.width + ".png",fullPage:true});
});
