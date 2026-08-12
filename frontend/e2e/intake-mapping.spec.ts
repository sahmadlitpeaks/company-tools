import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator } from "@playwright/test";

const user = {
  id: "admin-1",
  email: "admin@example.com",
  display_name: "Alex Admin",
  given_name: "Alex",
  job_title: "Operations Lead",
  is_active: true,
  is_admin: true,
  role: "admin",
  status: "active",
  effective_permissions: ["crm"],
  managed_company_ids: [],
  created_at: "2026-01-01T00:00:00Z",
};

const form = {
  id: "form-1",
  source_id: "source-1",
  source_name: "Acme Website",
  form_key: "cf7:17",
  name: "Contact form 1",
  provider: "cf7",
  site_url: "https://acme.com",
  mapping_status: "auto",
  destination: "crm_lead",
  default_type: null,
  auto_convert: null,
  notify_user_id: null,
  job_id: null,
  active: true,
  submission_count: 12,
  last_submission_at: "2026-08-10T09:00:00Z",
  field_count: 3,
  created_at: "2026-08-01T09:00:00Z",
};

const formDetail = {
  ...form,
  fields: [
    {
      name: "your-name",
      label: "Your name",
      type: "text",
      options: null,
      required: true,
      sample: "Jane Roe",
      seen_count: 12,
      origin: "schema",
    },
    {
      name: "tel-123",
      label: "Phone",
      type: "tel",
      options: null,
      required: false,
      sample: "+97•••67",
      seen_count: 12,
      origin: "schema",
    },
    {
      name: "menu-789",
      label: "Budget range",
      type: "select",
      options: ["<10k", "10k+"],
      required: false,
      sample: "10k+",
      seen_count: 9,
      origin: "observed",
    },
  ],
  mapping: {
    version: 1,
    rules: [
      { sources: ["your-name"], target: "name", combine: "first", join: " ", transform: ["trim"] },
      { sources: ["tel-123"], target: "phone", combine: "first", join: " ", transform: ["digits"] },
    ],
  },
  unmapped_targets: ["email", "message"],
};

const targets = {
  targets: ["name", "email", "phone", "company", "subject", "message", "page_url", "type", "extra"],
  transforms: ["trim", "lower", "upper", "title", "digits", "strip_html", "join_array", "first_line", "email_only"],
  destinations: ["candidate", "crm_lead", "inbox_only", "ticket"],
  types: ["complaint", "feedback", "inquiry", "job_application", "lead", "other", "support"],
  condition_kinds: ["page_url", "form_key", "form_name", "field", "subject", "message", "type"],
  condition_ops: ["equals", "contains", "starts_with", "regex", "exists"],
  blocklist_kinds: ["cidr", "country", "domain", "email", "fingerprint", "ip", "keyword"],
  blocklist_actions: ["allow", "block", "quarantine"],
};

const rule = {
  id: "rule-1",
  name: "Careers pages are applications",
  source_id: null,
  form_id: null,
  priority: 100,
  active: true,
  conditions: [{ kind: "page_url", op: "contains", value: "/careers", field: null }],
  outcome: { type: "job_application", destination: "candidate" },
  match_count: 4,
  created_at: "2026-08-01T09:00:00Z",
};

const blockEntry = {
  id: "block-1",
  kind: "domain",
  value: "spam.example",
  action: "block",
  reason: "Persistent link spam",
  source_id: null,
  hit_count: 27,
  expires_at: null,
  created_at: "2026-08-01T09:00:00Z",
};

/** The page renders a mobile card list and a desktop table; only one is
 *  visible per viewport, but both are in the DOM. Assert against whichever is
 *  actually shown so a single spec covers both projects. */
const shown = (locator: Locator) => locator.filter({ visible: true }).first();

let previewCalls = 0;

test.beforeEach(async ({ page }) => {
  previewCalls = 0;
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    let body: unknown = {};

    if (path === "/api/auth/me") body = user;
    else if (path === "/api/auth/mfa/status") body = { enabled: false };
    else if (path === "/api/companies" || path === "/api/notifications") body = [];
    else if (path === "/api/notifications/unread-count") body = { count: 0 };
    else if (path === "/api/intake/targets") body = targets;
    else if (path === "/api/intake/forms") body = [form];
    else if (path === "/api/intake/forms/form-1") body = formDetail;
    else if (path === "/api/intake/forms/form-1/preview-mapping") {
      previewCalls += 1;
      body = {
        items: [
          {
            submission_id: "sub-1",
            received_at: "2026-08-10T09:00:00Z",
            core: { name: "Jane Roe", phone: "+971501234567" },
            extras: { "menu-789": "10k+" },
            labels: { "menu-789": "Budget range" },
            status: "partial",
            notes: ["Email recovered from unmapped field 'abc-111'"],
            spam_score: 10,
            spam_reasons: [],
          },
        ],
        unmapped_targets: ["email", "message"],
      };
    } else if (path === "/api/intake/routing-rules") body = [rule];
    else if (path === "/api/intake/blocklist") body = [blockEntry];
    else if (path === "/api/intake/sources") body = [];
    else if (path === "/api/intake/submissions") body = [];

    await route.fulfill({ json: body as object });
  });
});

test("the mapping editor shows sample values so opaque field names can be read", async ({ page }) => {
  await page.goto("/inbox/forms/form-1");

  await expect(page.getByRole("heading", { name: "Contact form 1" })).toBeVisible();
  // The whole point of the page: tel-123 is meaningless without its sample.
  await expect(shown(page.getByText("tel-123"))).toBeVisible();
  await expect(shown(page.getByText("+97•••67"))).toBeVisible();
  await expect(shown(page.getByText("Budget range"))).toBeVisible();
});

test("unmapped core columns are called out", async ({ page }) => {
  await page.goto("/inbox/forms/form-1");
  await expect(page.getByText(/No field maps to/)).toBeVisible();
});

test("previewing does not save anything", async ({ page }) => {
  await page.goto("/inbox/forms/form-1");
  await page.getByRole("button", { name: "Preview" }).click();

  await expect(shown(page.getByText("Jane Roe"))).toBeVisible();
  await expect(shown(page.getByText(/Email recovered from unmapped field/))).toBeVisible();
  expect(previewCalls).toBe(1);
});

test("re-applying a mapping asks for confirmation first", async ({ page }) => {
  await page.goto("/inbox/forms/form-1");
  await page.getByRole("button", { name: "Re-apply mapping" }).click();
  await expect(page.getByRole("heading", { name: "Re-apply this mapping?" })).toBeVisible();
});

test("the forms tab lists each website form and its mapping state", async ({ page }) => {
  await page.goto("/inbox");
  await page.getByRole("button", { name: "Forms" }).click();

  await expect(shown(page.getByRole("link", { name: "Contact form 1" }))).toBeVisible();
  await expect(shown(page.getByText("Acme Website"))).toBeVisible();
});

test("routing rules read as plain English", async ({ page }) => {
  await page.goto("/inbox/rules");

  await expect(shown(page.getByText("Careers pages are applications"))).toBeVisible();
  await expect(
    shown(page.getByText(/Page URL contains "\/careers".*recruiting candidate/i)),
  ).toBeVisible();
});

test("the blocklist explains that blocked submissions are never stored", async ({ page }) => {
  await page.goto("/inbox/rules");
  await page.getByRole("button", { name: "Blocklist" }).click();

  await expect(page.getByText(/refused outright and never stored/)).toBeVisible();
  await expect(shown(page.getByText("spam.example"))).toBeVisible();
});

test("the mapping editor is accessible and does not scroll sideways", async ({ page }) => {
  await page.goto("/inbox/forms/form-1");
  await expect(page.getByRole("heading", { name: "Contact form 1" })).toBeVisible();

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  expect(results.violations).toEqual([]);
});
