import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { mount, noOverflow } from "./projects-fixtures";
import type { DecisionDetailData } from "../src/api/pm-decisions";

const now = "2026-10-15T08:00:00Z";
function draft(): DecisionDetailData {
  return { id: "d1", project_id: "p1", key: "LIMS-DEC-1", title: "Finance approval threshold", category: "business",
    context: "Control purchasing", approach: "Finance approves above 5000", rationale: "Reduce delays", alternatives: "Review every purchase",
    owner_id: "admin", owner_name: "Sara Admin", approver_id: "drt", approver_name: "Dr T", proposed_by_id: "admin", proposed_by_name: "Sara Admin",
    effective_date: null, status: "draft", version: 1, revision_number: 0, approved_revision_number: null, approved_at: null,
    superseded_by_id: null, created_at: now, updated_at: now, evidence: [{ type: "meeting", label: "Meeting notes", url: "https://example.test/meeting", added_by_name: "Sara Admin", added_at: now }],
    issues: [{ id: "s1", key: "LIMS-2", summary: "Analyse uploaded PDFs", issue_type: "story", status: "todo", reporter_name: "Dr T", assignee_name: "Ali Dev" }],
    can_edit: true, can_submit: true, can_revise: false, can_decide: false, can_archive: false, can_supersede: false,
    revisions: [], events: [{ id: "event1", action: "created", actor_name: "Sara Admin", note: "", revision_number: null, created_at: now }], related_decisions: [],
  };
}
async function decisions(page: Page, role: "admin" | "viewer" = "admin", initial = "draft", failure = "") {
  await mount(page, role);
  let row = draft();
  const requests: { path: string; body: Record<string, unknown> }[] = [];
  function rights() {
    const edit = role === "admin";
    return { ...row, can_edit: edit && row.status === "draft", can_submit: edit && row.status === "draft", can_decide: !edit && row.status === "pending_approval",
      can_revise: edit && ["approved", "rejected", "pending_approval"].includes(row.status), can_archive: edit && ["approved", "rejected", "superseded"].includes(row.status), can_supersede: edit && row.status === "approved" };
  }
  function snapshot() { const { title, category, context, approach, rationale, alternatives, owner_id, approver_id, effective_date, key, owner_name, approver_name, proposed_by_name, evidence, issues } = row; return structuredClone({ title, category, context, approach, rationale, alternatives, owner_id, approver_id, effective_date, key, owner_name, approver_name, proposed_by_name, evidence, issues }); }
  if (initial !== "draft") {
    row.status = initial; row.revision_number = 1; row.version = 2;
    row.revisions = [{ number: 1, snapshot: snapshot(), change_summary: "Initial proposal", submitted_by_name: "Sara Admin", created_at: now }];
    if (initial === "approved") { row.approved_revision_number = 1; row.approved_at = now; }
  }
  if (failure === "changed_sources") {
    row.issues = [];
    row.owner_name = "Renamed after submission";
  }
  await page.route("**/api/pm/**", async (route) => {
    const req = route.request(); const url = new URL(req.url()); const path = url.pathname;
    if (!path.includes("/decisions")) return route.fallback();
    if (failure === "denied" && path === "/api/pm/decisions/d1") return route.fulfill({ status: 404, json: { detail: "Decision not found" } });
    if (failure === "list" && path.endsWith("/projects/p1/decisions")) return route.fulfill({ status: 503, json: { detail: "Decision service unavailable" } });
    let json: unknown = rights();
    if (req.method() === "GET" && path.endsWith("/projects/p1/decisions")) {
      const listed = url.searchParams.get("status") === "approved" ? { ...rights(), id: "d2", key: "LIMS-DEC-2", title: "Updated finance policy" } : rights();
      json = { items: failure === "empty" ? [] : [listed], total: failure === "empty" ? 0 : 1 };
    } else if (req.method() === "GET" && path.endsWith("/issues/s1/decisions")) json = [rights()];
    else if (req.method() !== "GET") {
      const body = req.postDataJSON(); requests.push({ path, body });
      if (failure === "stale") return route.fulfill({ status: 409, json: { detail: "This decision changed. Reload it before trying again." } });
      if (req.method() === "PATCH" || path.endsWith("/projects/p1/decisions")) {
        row = { ...row, ...body, evidence: body.evidence, issues: body.issue_ids.includes("s1") ? draft().issues : [] };
      } else if (path.endsWith("/submit")) {
        row.status = "pending_approval"; row.revision_number += 1;
        row.revisions.unshift({ number: row.revision_number, snapshot: snapshot(), change_summary: body.change_summary, submitted_by_name: "Sara Admin", created_at: now });
      } else if (path.endsWith("/approval")) {
        row.status = body.outcome;
        if (body.outcome === "approved") { row.approved_revision_number = row.revision_number; row.approved_at = now; }
      } else if (path.endsWith("/revise")) row.status = "draft";
      else if (path.endsWith("/archive")) row.status = "archived";
      else if (path.endsWith("/supersede")) {
        row.status = "superseded"; row.superseded_by_id = body.replacement_id;
        row.related_decisions = [{ id: "d2", key: "LIMS-DEC-2", title: "Updated finance policy", relationship: "replaced_by" }];
      }
      row.version += 1;
      row.events.push({ id: `event${row.version}`, action: body.outcome ?? (path.endsWith("/revise") ? "returned_to_draft" : path.endsWith("/submit") ? "submitted" : "draft_updated"), actor_name: role === "viewer" ? "Dr T" : "Sara Admin", revision_number: row.revision_number || null, note: body.note ?? body.reason ?? body.change_summary ?? "", created_at: now });
      json = rights();
    }
    await route.fulfill({ json });
  });
  return requests;
}

test("decision register is accessible on desktop and mobile with persistent filters", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  await decisions(page);
  await page.goto("/projects/LIMS?tab=decisions");
  await expect(page.getByRole("heading", { name: "Decisions", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create issue", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Finance approval threshold/ }).filter({ visible: true })).toHaveCount(1);
  await page.getByLabel("Search decisions or linked issue key").fill("LIMS-DEC-1");
  await expect(page).toHaveURL(/d_q=LIMS-DEC-1/);
  await page.reload();
  await expect(page.getByLabel("Search decisions or linked issue key")).toHaveValue("LIMS-DEC-1");
  await page.getByRole("button", { name: "More filters", exact: true }).click();
  await page.getByRole("combobox", { name: "Decision approver", exact: true }).click();
  await page.getByRole("option", { name: "Dr T", exact: true }).click();
  await page.getByLabel("From date (UTC)").fill("2026-10-01");
  await expect(page).toHaveURL(/d_approver_id=drt/);
  await expect(page).toHaveURL(/d_after=2026-10-01/);
  await page.reload();
  await expect(page.getByLabel("From date (UTC)")).toHaveValue("2026-10-01");
  await expect(page.getByRole("button", { name: "More filters (2 applied)", exact: true })).toHaveAttribute("aria-expanded", "true");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await noOverflow(page);
  expect(consoleErrors).toEqual([]);
  await page.screenshot({ path: `test-results/decisions-register-${page.viewportSize()!.width}.png`, fullPage: true });
});

test("tablet navigation stays clear of decision content and form actions", async ({ page }) => {
  await decisions(page);
  for (const width of [768, 1024]) {
    await page.setViewportSize({ width, height: 1024 });
    await page.goto("/projects/LIMS?tab=decisions");
    const views = page.getByRole("combobox", { name: "Project view", exact: true });
    await expect(views).toContainText("Decisions");
    await expect(page.getByRole("tablist", { name: "Project views", exact: true })).toBeHidden();
    await views.click();
    await page.getByRole("option", { name: "People", exact: true }).click();
    await expect(page).toHaveURL(/tab=people/);
    await views.click();
    await page.getByRole("option", { name: "Decisions", exact: true }).click();
    const heading = page.getByRole("heading", { name: "Decisions", exact: true });
    await expect(heading).toBeVisible();
    const control = await views.boundingBox();
    const content = await heading.boundingBox();
    expect(control!.y + control!.height).toBeLessThan(content!.y);
    await expect(page.getByRole("navigation", { name: "breadcrumb", exact: true })).toHaveJSProperty("clientHeight", 16);
    await page.getByRole("button", { name: "Create decision", exact: true }).click();
    const form = page.getByRole("dialog", { name: "Create decision", exact: true });
    await form.getByLabel("Find issues", { exact: true }).scrollIntoViewIfNeeded();
    await expect(form.getByRole("heading", { name: "Create decision", exact: true })).toBeInViewport();
    await expect(form.getByRole("button", { name: "Save draft", exact: true })).toBeInViewport();
    await form.getByRole("button", { name: "Cancel", exact: true }).click();
    await noOverflow(page);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({ path: `test-results/decisions-tablet-${width}.png`, fullPage: true });
  }
});

test("create draft with evidence and issue links then submit an exact version", async ({ page }) => {
  const requests = await decisions(page);
  await page.goto("/projects/LIMS?tab=decisions");
  await page.getByRole("button", { name: "Create decision", exact: true }).click();
  const form = page.getByRole("dialog", { name: "Create decision", exact: true });
  await expect(form.getByRole("button", { name: "Save draft", exact: true })).toBeInViewport();
  await form.getByLabel("Title", { exact: true }).fill("Approval for large purchases");
  await form.getByLabel("Context / problem").fill("Control spending");
  await form.getByLabel("Chosen approach").fill("Finance reviews purchases over 5000");
  await form.getByLabel("Rationale", { exact: true }).fill("Keep small purchases fast");
  await form.getByRole("combobox", { name: "Approver", exact: true }).click();
  await page.getByRole("option", { name: "Dr T", exact: true }).click();
  await form.getByRole("checkbox", { name: /LIMS-2/ }).check();
  await form.getByLabel("Find issues", { exact: true }).fill("does not match");
  await expect(form.getByText("No matching issues. Try another key or title.", { exact: true })).toBeVisible();
  await form.getByLabel("Find issues", { exact: true }).fill("");
  await expect(form.getByRole("checkbox", { name: /LIMS-2/ })).toBeChecked();
  await form.getByRole("button", { name: "Add reference" }).click();
  await form.getByLabel("Reference 1 description").fill("Signed meeting notes");
  await form.getByLabel("Reference 1 URL").fill("https://example.test/notes");
  await expect(form.getByRole("heading", { name: "Create decision", exact: true })).toBeInViewport();
  await expect(form.getByRole("button", { name: "Save draft", exact: true })).toBeInViewport();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await noOverflow(page);
  await form.getByRole("button", { name: "Save draft", exact: true }).click();
  const detail = page.getByRole("dialog", { name: "Approval for large purchases", exact: true });
  await expect(detail.getByText("Draft", { exact: true })).toBeVisible();
  await detail.getByRole("button", { name: "Submit for approval", exact: true }).click();
  const submit = page.getByRole("dialog", { name: "Submit for approval", exact: true });
  await submit.getByLabel("Summary of this submission").fill("Initial business agreement");
  await submit.getByRole("button", { name: "Submit for approval", exact: true }).click();
  await expect(detail.getByText("Pending approval", { exact: true })).toBeVisible();
  expect(requests[0].body).toMatchObject({ issue_ids: ["s1"], approver_id: "drt", evidence: [{ type: "document", label: "Signed meeting notes", url: "https://example.test/notes" }] });
  expect(requests[1].body).toMatchObject({ version: 2, change_summary: "Initial business agreement" });
  await detail.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByRole("region", { name: "Decision register" }).getByText("Pending approval").filter({ visible: true })).toHaveCount(1);
});

test("approval opens the frozen submission after linked source records change", async ({ page }) => {
  const requests = await decisions(page, "viewer", "pending_approval", "changed_sources");
  await page.goto("/projects/LIMS?tab=decisions&decision=d1");
  const detail = page.getByRole("dialog", { name: "Finance approval threshold", exact: true });
  await expect(detail.getByRole("link", { name: "LIMS-2 · Analyse uploaded PDFs", exact: true })).toBeVisible();
  await expect(detail.getByRole("heading", { name: "Linked issues at submission", exact: true })).toBeVisible();
  await expect(detail.getByText("Renamed after submission", { exact: true })).toHaveCount(0);
  await detail.getByRole("button", { name: "Approve revision 1", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Approve revision", exact: true });
  await dialog.getByRole("button", { name: "Approve revision", exact: true }).click();
  expect(requests[0].body).toMatchObject({ version: 2, revision_number: 1, outcome: "approved" });
  await expect(detail.getByRole("link", { name: "LIMS-2 · Analyse uploaded PDFs", exact: true })).toBeVisible();
});

for (const outcome of ["Approve", "Reject"] as const) test(`assigned project viewer can ${outcome.toLowerCase()} a submitted revision`, async ({ page }) => {
  const requests = await decisions(page, "viewer", "pending_approval");
  await page.goto("/projects/LIMS?tab=decisions&decision=d1");
  const detail = page.getByRole("dialog", { name: "Finance approval threshold", exact: true });
  await expect(detail.getByRole("button", { name: "Edit draft" })).toHaveCount(0);
  await detail.getByRole("button", { name: `${outcome} revision 1`, exact: true }).click();
  const dialog = page.getByRole("dialog", { name: `${outcome} revision`, exact: true });
  if (outcome === "Reject") {
    await expect(dialog.getByRole("button", { name: "Reject revision", exact: true })).toBeDisabled();
    await dialog.getByLabel("Reason", { exact: true }).fill("Need impact estimate");
  }
  await dialog.getByRole("button", { name: `${outcome} revision`, exact: true }).click();
  await expect(detail.getByText(outcome === "Approve" ? "Approved" : "Rejected", { exact: true })).toBeVisible();
  expect(requests[0].body).toMatchObject({ version: 2, revision_number: 1, outcome: outcome === "Approve" ? "approved" : "rejected" });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await noOverflow(page);
});

test("approved revision stays readable and actions follow the viewed version", async ({ page }) => {
  await decisions(page, "admin", "approved");
  await page.goto("/projects/LIMS?tab=decisions&decision=d1");
  const detail = page.getByRole("dialog", { name: "Finance approval threshold", exact: true });
  await detail.getByRole("button", { name: "Propose a revision" }).click();
  const dialog = page.getByRole("dialog", { name: "Return to draft", exact: true });
  await dialog.getByLabel("Reason", { exact: true }).fill("Change the spending threshold");
  await dialog.getByRole("button", { name: "Return to draft", exact: true }).click();
  await detail.getByRole("button", { name: "Edit draft" }).click();
  const edit = page.getByRole("dialog", { name: "Edit LIMS-DEC-1", exact: true });
  await edit.getByLabel("Chosen approach").fill("Finance approves above 10000");
  await edit.getByRole("button", { name: "Save draft" }).click();
  await expect(detail.getByText("Finance approves above 10000", { exact: true })).toBeVisible();
  await detail.getByRole("button", { name: "View approved version" }).click();
  await expect(detail.getByText("Finance approves above 5000", { exact: true })).toBeVisible();
  await expect(detail.getByText("Finance approves above 10000", { exact: true })).toHaveCount(0);
  await expect(detail.getByRole("button", { name: "Edit draft", exact: true })).toHaveCount(0);
  await expect(detail.getByRole("button", { name: "Submit for approval", exact: true })).toHaveCount(0);
  await expect(detail.getByRole("link", { name: "Meeting notes" })).toBeVisible();
  await detail.getByRole("heading", { name: "Decision and approval history", exact: true }).scrollIntoViewIfNeeded();
  await expect(detail.getByRole("heading", { name: "Finance approval threshold", exact: true, level: 2 })).toBeInViewport();
  await expect(detail.getByRole("button", { name: "Close", exact: true })).toBeInViewport();
  await noOverflow(page);
  await page.screenshot({ path: `test-results/decisions-approved-history-${page.viewportSize()!.width}.png`, fullPage: true });
  await detail.getByRole("button", { name: "View current draft", exact: true }).click();
  await expect(detail.getByText("Finance approves above 10000", { exact: true })).toBeVisible();
  await detail.getByRole("button", { name: "Submit for approval", exact: true }).click();
  const submit = page.getByRole("dialog", { name: "Submit for approval", exact: true });
  await submit.getByLabel("Summary of this submission").fill("Raise the threshold");
  await submit.getByRole("button", { name: "Submit for approval", exact: true }).click();
  await detail.getByRole("button", { name: "View approved version", exact: true }).click();
  await expect(detail.getByRole("button", { name: "Withdraw submission", exact: true })).toHaveCount(0);
  await detail.getByRole("button", { name: "View current content", exact: true }).click();
  await expect(detail.getByRole("button", { name: "Withdraw submission", exact: true })).toBeVisible();
});

test("issue and decision links navigate in both directions", async ({ page }) => {
  await decisions(page);
  await page.goto("/projects/LIMS?issue=LIMS-2");
  await page.getByRole("region", { name: "Linked decisions" }).getByRole("link", { name: /LIMS-DEC-1/ }).click();
  await expect(page).toHaveURL(/tab=decisions&decision=d1/);
  const detail = page.getByRole("dialog", { name: "Finance approval threshold", exact: true });
  await detail.getByRole("link", { name: /LIMS-2/ }).click();
  await expect(page).toHaveURL(/tab=issues&issue=LIMS-2/);
  await expect(page.getByRole("dialog", { name: /Analyse uploaded PDFs/ })).toBeVisible();
});

test("replace an approved decision and archive it while retaining its history", async ({ page }) => {
  const requests = await decisions(page, "admin", "approved");
  await page.goto("/projects/LIMS?tab=decisions&decision=d1");
  const detail = page.getByRole("dialog", { name: "Finance approval threshold", exact: true });
  await detail.getByRole("button", { name: "More actions", exact: true }).click();
  await page.getByRole("menuitem", { name: "Replace decision", exact: true }).click();
  const replace = page.getByRole("dialog", { name: "Replace decision", exact: true });
  await replace.getByRole("combobox", { name: "Approved replacement", exact: true }).click();
  await page.getByRole("option", { name: "LIMS-DEC-2 · Updated finance policy", exact: true }).click();
  await replace.getByLabel("Reason", { exact: true }).fill("An approved policy replaces this threshold.");
  await replace.getByRole("button", { name: "Replace decision", exact: true }).click();
  await expect(detail.getByText("Superseded", { exact: true })).toBeVisible();
  await expect(detail.getByRole("link", { name: "Replaced by LIMS-DEC-2 · Updated finance policy", exact: true })).toBeVisible();
  expect(requests[0].body).toMatchObject({ version: 2, replacement_id: "d2" });
  await detail.getByRole("button", { name: "More actions", exact: true }).click();
  await page.getByRole("menuitem", { name: "Archive decision", exact: true }).click();
  const archive = page.getByRole("dialog", { name: "Archive decision", exact: true });
  await archive.getByLabel("Reason", { exact: true }).fill("Retain the original agreement for reference.");
  await archive.getByRole("button", { name: "Archive decision", exact: true }).click();
  await expect(detail.getByText("Archived", { exact: true })).toBeVisible();
  await expect(detail.getByRole("button", { name: "Edit draft", exact: true })).toHaveCount(0);
  await detail.getByRole("button", { name: "View approved version", exact: true }).click();
  await expect(detail.getByText("Finance approves above 5000", { exact: true })).toBeVisible();
  await noOverflow(page);
});

test("draft save errors stay visible and preserve the entered changes", async ({ page }) => {
  await decisions(page, "admin", "draft", "stale");
  await page.goto("/projects/LIMS?tab=decisions&decision=d1");
  await page.getByRole("button", { name: "Edit draft", exact: true }).click();
  const form = page.getByRole("dialog", { name: "Edit LIMS-DEC-1", exact: true });
  await form.getByLabel("Title", { exact: true }).fill("Revised finance threshold");
  await form.getByLabel("Find issues", { exact: true }).fill("LIMS-2");
  await form.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(form.getByRole("alert")).toContainText("This decision changed. Reload it before trying again.");
  await expect(form.getByRole("alert")).toBeInViewport();
  await expect(form.getByLabel("Title", { exact: true })).toHaveValue("Revised finance threshold");
  await expect(form.getByRole("button", { name: "Save draft", exact: true })).toBeInViewport();
});

test("stale submission keeps the error actionable", async ({ page }) => {
  await decisions(page, "admin", "draft", "stale");
  await page.goto("/projects/LIMS?tab=decisions&decision=d1");
  await page.getByRole("button", { name: "Submit for approval", exact: true }).click();
  const submit = page.getByRole("dialog", { name: "Submit for approval", exact: true });
  await submit.getByLabel("Summary of this submission").fill("Initial agreement");
  await submit.getByRole("button", { name: "Submit for approval", exact: true }).click();
  await expect(submit.getByRole("alert")).toContainText("This decision changed");
  await expect(submit.getByLabel("Summary of this submission")).toHaveValue("Initial agreement");
});

for (const mode of ["empty", "list", "denied"]) test(`decision ${mode} state is clear`, async ({ page }) => {
  await decisions(page, "viewer", "draft", mode);
  await page.goto(`/projects/LIMS?tab=decisions${mode === "denied" ? "&decision=d1" : ""}`);
  await expect(page.getByText(mode === "empty" ? "No decisions found" : mode === "list" ? "Decision service unavailable" : "Decision not found", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create decision", exact: true })).toHaveCount(0);
  await noOverflow(page);
});
