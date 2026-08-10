import { expect, test, type Page } from "@playwright/test";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z3S8AAAAASUVORK5CYII=",
  "base64",
);

const brands = [
  {
    id: "b1",
    slug: "ag-holding",
    name: "AG Holding",
    logo_url: "/media/ag-logo.png",
    icon_url: null,
    primary_color: "#eb890f",
    secondary_color: "#27703b",
    accent_color: "#eb890f",
    font_family: "Arial",
    base_font_size: 16,
    palette: JSON.stringify([{ name: "Green", hex: "#27703b" }]),
    website: "https://agholding.example",
    email_domain: "agholding.example",
    contact_email: "hello@agholding.example",
    phone: "+971 4 000 0000",
    address: "Dubai Science Park",
    tagline: "Building healthier companies",
    social: JSON.stringify({ linkedin: "https://linkedin.com/company/ag" }),
    is_active: true,
    is_default: true,
    created_at: "2026-08-01T00:00:00Z",
  },
  {
    id: "b2",
    slug: "litpeaks",
    name: "Litpeaks",
    logo_url: null,
    icon_url: null,
    primary_color: "#ba2345",
    secondary_color: "#1d3a54",
    accent_color: "#ba2345",
    font_family: "Arial",
    base_font_size: 15,
    palette: "[]",
    website: "https://litpeaks.com",
    email_domain: "litpeaks.com",
    contact_email: "hello@litpeaks.com",
    phone: "+971 4 111 1111",
    address: "Dubai",
    tagline: "Technology and automation",
    social: "{}",
    is_active: true,
    is_default: false,
    created_at: "2026-08-01T00:00:00Z",
  },
];

async function mockPlatform(page: Page) {
  await page.route("**/media/**", (route) => route.fulfill({ status: 200, contentType: "image/png", body: png }));
  await page.route("**/api/auth/me", (route) => route.fulfill({
    json: {
      id: "u1",
      email: "admin@example.com",
      display_name: "Shadi Almilhem",
      job_title: "AI Automation Engineer",
      department: "IT",
      business_phone: "+971 50 000 0000",
      is_active: true,
      is_admin: true,
      must_change_password: false,
      role: "admin",
      status: "active",
      effective_permissions: ["dashboard", "directory", "cards", "marketing_assets", "branding", "qrcodes", "landing_pages", "signatures", "transfers"],
      managed_company_ids: [],
      created_at: "2026-08-01T00:00:00Z",
    },
  }));
  await page.route("**/api/companies", (route) => route.fulfill({ json: brands }));
  await page.route("**/api/companies/b1/documents", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/companies/b2/documents", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/cards", (route) => route.fulfill({ json: [{
    id: "c1", slug: "shadi", owner_id: "u1", company_id: "b1", full_name: "Shadi Almilhem",
    title: "AI Automation Engineer", company: "AG Holding", email: "shadi@example.com", phone: "+971 50 000 0000",
    whatsapp: "+971500000000", website: "https://agholding.example", linkedin: "https://linkedin.com/in/shadi",
    address: "Dubai", bio: "Building useful internal tools.", photo_url: null, accent_color: "#eb890f",
    lead_capture_enabled: true, is_active: true, created_at: "2026-08-01T00:00:00Z",
  }] }));
  await page.route("**/api/cards/c1/qr.png", (route) => route.fulfill({ status: 200, contentType: "image/png", body: png }));
  await page.route("**/api/qrcodes", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/signatures/templates", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/assets/folders", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/assets", (route) => route.fulfill({ json: [{
    id: "a1", folder_id: null, name: "campaign.png", file_path: "campaign.png", content_type: "image/png",
    size_bytes: 100, download_count: 0, version: 1, is_public: false, share_code: null,
    share_expires_at: null, share_require_lead: false, share_has_passcode: false, created_at: "2026-08-01T00:00:00Z",
  }] }));
  await page.route("**/api/assets/a1/download", (route) => route.fulfill({ status: 200, contentType: "image/png", body: png }));
  await page.route("**/api/assets/a1/preview", (route) => route.fulfill({ status: 200, contentType: "image/png", body: png }));
  await page.route("**/api/landing-pages", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/transfers", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/users", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/departments", (route) => route.fulfill({ json: [{ id: "d1", name: "Marketing", description: "", permissions: ["dashboard", "campaigns", "marketing_assets"], member_count: 2, created_at: "2026-08-01T00:00:00Z" }] }));
}

test.beforeEach(async ({ page }) => {
  await mockPlatform(page);
});

test("digital cards have clear action hierarchy and compact icons", async ({ page }) => {
  await page.goto("/cards");
  await expect(page.getByRole("heading", { name: "Digital Cards" })).toBeVisible();
  await expect(page.getByRole("link", { name: "View card" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Download" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit" })).toBeVisible();

  const oversized = await page.locator("svg.lucide").evaluateAll((icons) => icons.filter((icon) => {
    const box = icon.getBoundingClientRect();
    return box.width > 16.1 || box.height > 16.1;
  }).length);
  expect(oversized).toBe(0);
});

test("brand, QR, signature, and employee access use company-owned settings", async ({ page }) => {
  await page.goto("/branding");
  await expect(page.getByLabel("Base font size")).toHaveValue("16");
  await expect(page.getByRole("button", { name: "Download logo" })).toBeVisible();

  await page.goto("/qrcodes");
  await expect(page.getByText("Dynamic by default.")).toBeVisible();
  await expect(page.getByLabel("QR brand color")).toBeVisible();

  await page.goto("/signatures");
  await expect(page.locator("#signature-company-heading")).toContainText("Choose a company");
  await expect(page.getByRole("button", { name: /Litpeaks/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy signature" })).toBeVisible();

  await page.goto("/directory");
  await page.getByRole("button", { name: "Add user" }).click();
  await expect(page.getByLabel("Access department")).toBeVisible();
});

test("marketing assets, AI draft entry, and secure transfers expose usable actions", async ({ page }) => {
  await page.goto("/marketing-assets");
  await page.getByTitle("View campaign.png").click();
  await expect(page.getByText("View — campaign.png", { exact: true })).toBeVisible();

  await page.goto("/landing-pages");
  await page.getByRole("button", { name: "Build with AI" }).click();
  await expect(page.getByText("does not call an external AI provider yet")).toBeVisible();
  await expect(page.getByRole("button", { name: "Build draft" })).toBeVisible();

  await page.goto("/transfers");
  await expect(page.getByText("Drop a file here or click to browse")).toBeVisible();
  await expect(page.getByRole("button", { name: /Encrypt and create link/ })).toBeVisible();
});
