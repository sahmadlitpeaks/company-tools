import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const token = (over: Record<string, unknown> = {}) => ({
  id: "t1", name: "Claude on my laptop", can_write: false, state: "active", expires_at: "2027-01-06T08:00:00Z", revoked_at: null,
  last_used_at: "2026-10-07T09:00:00Z", created_at: "2026-10-01T08:00:00Z", owner_name: null, ...over,
});

async function mount(page: Page, admin: boolean) {
  const requests: Array<{ method: string; path: string; body: unknown }> = [];
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    const body = request.postData() ? request.postDataJSON() : null;
    if (method !== "GET") requests.push({ method, path, body });
    let json: unknown = [];
    if (path === "/api/auth/me") json = { id: "u1", email: "dev@example.com", display_name: "Ali Dev", role: admin ? "admin" : "member", is_admin: admin,
      is_active: true, status: "active", effective_permissions: ["projects"], managed_company_ids: [] };
    else if (path === "/api/settings/public") json = { platform_name: "AG Holding" };
    else if (path === "/api/notifications/unread-count") json = { count: 0 };
    else if (path === "/api/pm/ai/status") json = { mcp_path: "/api/mcp/", can_write_allowed: admin };
    else if (path === "/api/pm/ai/tokens" && method === "POST") json = { ...token({ id: "t2", name: body.name, can_write: body.can_write, last_used_at: null }), token: "pmt_secret123" };
    else if (path === "/api/pm/ai/tokens") json = [token()];
    else if (path === "/api/pm/ai/tokens/all") json = [token({ owner_name: "Ali Dev" }), token({ id: "t9", name: "Old GPT", owner_name: "Sara", state: "revoked", can_write: true })];
    else if (method === "DELETE") return route.fulfill({ status: 204, body: "" });
    await route.fulfill({ json });
  });
  return requests;
}

test("members create read-only tokens with ready-to-paste setup, then revoke them", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const requests = await mount(page, false);
  await page.goto("/ai-access");
  await expect(page.getByRole("heading", { name: "AI access", level: 1 })).toBeVisible();
  await expect(page.getByText(/\/api\/mcp\/$/)).toBeVisible();
  // Without the write permission, tokens can only be read-only.
  await expect(page.getByRole("checkbox", { name: "Allow changes" })).toBeDisabled();
  await expect(page.getByText(/Ask an administrator for "Projects: AI write access"/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "All tokens" })).toHaveCount(0);

  await page.getByLabel("Name").fill("Cursor");
  await page.getByRole("button", { name: "Create token" }).click();
  expect(requests[0]).toEqual({ method: "POST", path: "/api/pm/ai/tokens", body: { name: "Cursor", can_write: false, expires_in_days: 90 } });
  await expect(page.getByLabel("Token", { exact: true })).toHaveValue("pmt_secret123");
  await expect(page.getByLabel("Claude Code")).toHaveValue(/claude mcp add --transport http company-projects http:\/\/[^ ]+\/api\/mcp\/ --header "Authorization: Bearer pmt_secret123"/);
  await expect(page.getByLabel("Other MCP clients (JSON config)")).toHaveValue(/"Authorization": "Bearer pmt_secret123"/);
  await page.getByRole("button", { name: "Copy" }).first().click();
  await expect(page.getByRole("button", { name: "Copied" })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: `test-results/ai-access-${page.viewportSize()!.width}.png`, fullPage: true });

  await page.getByRole("button", { name: "Revoke Claude on my laptop" }).click();
  await page.getByRole("button", { name: "Revoke token" }).click();
  await expect.poll(() => requests.some((r) => r.method === "DELETE" && r.path === "/api/pm/ai/tokens/t1")).toBe(true);
});

test("people with write access can allow changes; admins see every token", async ({ page }) => {
  const requests = await mount(page, true);
  await page.goto("/ai-access");
  const all = page.getByRole("table", { name: "All AI access tokens" });
  await expect(all.getByRole("cell", { name: "Sara" })).toBeVisible();
  await expect(all.getByText("Revoked")).toBeVisible();
  await page.getByLabel("Name").fill("Claude Desktop");
  await page.getByRole("checkbox", { name: "Allow changes" }).check();
  await page.getByRole("button", { name: "Create token" }).click();
  await expect(page.getByText(/read and change your project issues/)).toBeVisible();
  expect(requests[0]?.body).toEqual({ name: "Claude Desktop", can_write: true, expires_in_days: 90 });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
