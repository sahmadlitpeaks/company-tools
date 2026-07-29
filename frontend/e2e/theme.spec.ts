import { expect, test } from "@playwright/test";

test("Lyra preset renders cleanly without viewport overflow", async ({ page }) => {
  await page.goto("/login");
  await expect(page.locator("[data-slot=card]")).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);

  const theme = await page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    const card = getComputedStyle(document.querySelector("[data-slot=card]")!);
    const submit = getComputedStyle(document.querySelector("button[type=submit]")!);
    return {
      primary: root.getPropertyValue("--primary").trim(),
      radius: root.getPropertyValue("--radius").trim(),
      font: getComputedStyle(document.body).fontFamily,
      cardRadius: card.borderRadius,
      buttonHeight: submit.height,
      overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    };
  });

  expect(theme.primary).toBe("#facc15");
  expect(theme.radius).toBe("0px");
  expect(theme.font).toContain("DM Sans Variable");
  expect(theme.cardRadius).toBe("0px");
  expect(theme.buttonHeight).toBe("36px");
  expect(theme.overflow).toBeFalsy();
});
