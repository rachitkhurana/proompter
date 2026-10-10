import { expect, test, type Page } from "@playwright/test";

/**
 * Visual baselines at 1440x900 for the dock, composer, ticket and sheet, on the kit fixture (/fixtures/kit:
 * seeded in-memory entries, so the content is the same every run).
 *
 * Baselines are per platform: e2e/__screenshots__/visual.spec.ts/<platform>/*.png. The macOS set is committed.
 * A platform with none (CI on Linux) runs with `--update-snapshots=missing`, which writes its own and passes;
 * later runs on that platform compare. Regenerate on purpose with `pnpm e2e --update-snapshots`.
 */
test.use({ viewport: { width: 1440, height: 900 } });
test.setTimeout(90_000);

const shot = { animations: "disabled", caret: "hide", maxDiffPixelRatio: 0.01 } as const;

async function open(page: Page) {
  await page.goto("/fixtures/kit");
  await expect(page.getByRole("toolbar", { name: "Proompter" })).toBeVisible();
  await expect(page.locator(".dock")).not.toHaveClass(/\bintro\b/);
  await page.evaluate(() => document.fonts.ready);
}

test("dock", async ({ page }) => {
  await open(page);
  await expect(page.locator(".dock")).toHaveScreenshot("dock.png", shot);
});

test("composer", async ({ page }) => {
  await open(page);
  await page.keyboard.press("n");
  const composer = page.getByRole("dialog", { name: "New entry" });
  await expect(composer).toBeVisible();
  await page.waitForTimeout(500); // the grow-in is over
  await expect(composer).toHaveScreenshot("composer.png", shot);
});

test("sheet", async ({ page }) => {
  await open(page);
  await page.keyboard.press("e");
  const sheet = page.getByLabel("Review session", { exact: true });
  await expect(sheet).toHaveClass(/\bon\b/);
  await page.waitForTimeout(500);
  await expect(sheet).toHaveScreenshot("sheet.png", { ...shot, mask: [sheet.getByRole("time")] });
});

test("ticket", async ({ page }) => {
  await open(page);
  await page.keyboard.press("e");
  await page.getByRole("button", { name: /^PRO-1: / }).click();
  await expect(page.getByRole("button", { name: "Back to entries" })).toBeVisible();
  await page.waitForTimeout(500);
  const sheet = page.getByLabel("Review session", { exact: true });
  await expect(sheet).toHaveScreenshot("ticket.png", { ...shot, mask: [sheet.getByRole("time")] });
});

// The REAL composer (the kit fixture above uses a stand-in): pick the avatar on the playground page.
// Guards the element-case composer's CSS. The captured-context counts depend on the dev server, so they are masked.
test("composer (real, element)", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => !!window.__proompter);
  await page.keyboard.press("ControlOrMeta+Shift+.");
  await expect(page.locator(".dock")).not.toHaveClass(/\bintro\b/);
  await page.evaluate(() => document.fonts.ready);
  await page.getByRole("button", { name: "Pick element", exact: true }).click();
  const avatar = page.getByTestId("post-avatar");
  await avatar.hover();
  await avatar.click();
  const composer = page.getByRole("dialog", { name: "New entry" });
  await expect(composer).toBeVisible();
  await page.mouse.move(0, 0);
  await page.waitForTimeout(500); // the grow-in is over
  await expect(composer).toHaveScreenshot("composer-real.png", { ...shot, mask: [composer.locator("summary, .pm-ctx")] });
});
