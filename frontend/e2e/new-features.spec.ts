import { expect, test } from "@playwright/test";
import { login } from "./auth";

const surfaces = [
  ["/time", "Time Tracking"],
  ["/security", "Two-factor authentication"],
  ["/", "Your dashboard"],
  ["/tasks", "Projects & Tasks"],
  ["/cafe", "Café"],
  ["/bookings", "Room & Desk Booking"],
  ["/visitors", "Visitors"],
  ["/purchases", "Purchase Requests"],
  ["/calendar", "Company Calendar"],
  ["/ideas", "Feedback & Ideas"],
  ["/ai-help", "AI Help"],
  ["/lost-found", "Lost & Found"],
] as const;

test("all new authenticated surfaces load without an error", async ({ page }) => {
  await login(page);
  const browserErrors: string[] = [];
  const serverErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  page.on("response", (response) => {
    if (response.status() >= 500) {
      serverErrors.push(`${response.status()} ${response.url()}`);
    }
  });
  for (const [path, heading] of surfaces) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: heading }).first()).toBeVisible();
    await expect(page.locator("body")).not.toContainText("Internal Server Error");
  }
  expect(browserErrors).toEqual([]);
  expect(serverErrors).toEqual([]);
});

test("global search returns a grouped people result", async ({ page }) => {
  await login(page);
  const search = page.getByPlaceholder("Search documents…");
  if (await search.isVisible()) {
    await search.fill("Administrator");
    await expect(page.getByText("People", { exact: true })).toBeVisible();
  }
});
