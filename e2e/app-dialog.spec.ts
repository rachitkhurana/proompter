import path from "node:path";
import { expect, test } from "@playwright/test";
import { cleanReviews, composerOf, openKit, readEntry, sessionDir, waitForFile } from "./support";

/**
 * D11: an open app modal (a Radix Dialog, /dialog) stays open while the kit is used. Radix listens on the document
 * for outside pointerdown/focus, traps focus, locks wheel scroll and closes on Esc; none of that may fire for
 * interactions inside the kit, while a click on the app itself still closes the dialog.
 */
test.describe.configure({ mode: "serial" });
test.use({ viewport: { width: 1440, height: 900 } });
test.setTimeout(120_000);

test.beforeEach(cleanReviews);
test.afterEach(cleanReviews);

test("D11: pick, compose, scroll and Esc inside the kit keep an app dialog open", async ({ page }) => {
  await page.goto("/dialog");
  await openKit(page);
  await page.getByRole("button", { name: "Open settings" }).click();
  const dialog = page.getByRole("dialog", { name: "Settings" });
  await expect(dialog).toBeVisible();
  // Radix hides the dialog's siblings from assistive tech; the kit must stay reachable.
  await expect(page.getByRole("toolbar", { name: "Proompter" })).toBeVisible();

  // Pick an element inside the dialog (Radix has set pointer-events:none on <body>).
  const pick = page.getByRole("button", { name: "Pick element", exact: true });
  await pick.click();
  await expect(dialog).toBeVisible();
  const field = page.getByTestId("dialog-field");
  await field.hover();
  await expect(page.locator(".pm-hlab")).toBeVisible();
  await field.click();
  const composer = composerOf(page);
  await expect(composer).toBeVisible();
  await expect(dialog).toBeVisible();

  // Type in the composer: the dialog's focus trap must not pull focus back.
  const title = composer.getByLabel("Title");
  await title.click();
  await page.keyboard.type("Label is vague");
  await expect(title).toBeFocused();
  await expect(title).toHaveValue("Label is vague");
  await expect(dialog).toBeVisible();
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(composer).toBeHidden();
  await expect(dialog).toBeVisible();

  const session = await sessionDir();
  const entry = readEntry(await waitForFile(() => path.join(session, "entries"), "001-", ".md"));
  expect(entry.target?.source).toMatch(/examples\/playground\/app\/\(site\)\/dialog\/page\.tsx:\d+:\d+$/);
  await expect(page.locator(entry.target?.selector ?? "")).toHaveAttribute("data-testid", "dialog-field");

  // Wheel in the entries panel: the dialog's scroll lock must not cancel it.
  await page.getByRole("button", { name: /^Entries/ }).click();
  const body = page.locator(".pm-sheet .sh-bd");
  await expect(body).toBeVisible();
  await body.evaluate((el) => {
    el.addEventListener("wheel", (e) => setTimeout(() => el.setAttribute("data-wheel", String(e.defaultPrevented))));
  });
  await body.hover();
  await page.mouse.wheel(0, 120);
  await expect(body).toHaveAttribute("data-wheel", "false");
  await expect(dialog).toBeVisible();

  // Esc in the composer closes the composer only.
  if ((await pick.getAttribute("aria-pressed")) !== "true") await pick.click();
  await field.hover();
  await field.click();
  await expect(composer).toBeVisible();
  await expect(composer.getByLabel("Title")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(composer).toBeHidden();
  await expect(page.locator(".pm-comp")).toHaveCount(0); // its exit animation ends; the engine is free again
  await expect(dialog).toBeVisible();

  // Esc on the page right after the composer's own Esc, while its exit animation still runs: the kit's ladder
  // takes it, never the dialog. (Reopen the composer first; the previous one is gone.)
  if ((await pick.getAttribute("aria-pressed")) !== "true") await pick.click();
  await field.hover();
  await field.click();
  await expect(composer).toBeVisible();
  await expect(composer.getByLabel("Title")).toBeFocused();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape"); // no wait for `.pm-comp` to go
  await expect(composer).toBeHidden();
  await expect(page.locator(".pm-comp")).toHaveCount(0);
  await expect(dialog).toBeVisible();
  if ((await pick.getAttribute("aria-pressed")) !== "true") await pick.click();

  // Esc on the page while picking leaves the pick mode, not the app's dialog. Then a click on the page
  // outside the dialog (the app itself) still dismisses it.
  await page.keyboard.press("Escape");
  await expect(pick).toHaveAttribute("aria-pressed", "false");
  await expect(dialog).toBeVisible();
  await page.mouse.click(400, 800);
  await expect(dialog).toBeHidden();
});

test("D11: focus moving into the kit still blurs an app input outside any modal", async ({ page }) => {
  await page.goto("/dialog");
  await openKit(page);
  const outside = page.getByLabel("Outside field");
  await outside.focus();
  await expect(outside).toBeFocused();
  await page.getByRole("button", { name: /^Entries/ }).click();
  await expect(outside).not.toBeFocused();
  expect(await page.evaluate(() => (window as unknown as { __outsideBlurs?: number }).__outsideBlurs)).toBeGreaterThan(0);
});
