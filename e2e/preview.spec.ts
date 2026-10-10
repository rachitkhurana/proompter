import { expect, test, type Page } from "@playwright/test";
import { composerOf } from "./support";

/**
 * DESIGN D15, preview mode. Runs against the "preview" project: `next build` with NEXT_PUBLIC_PROOMPTER=true
 * (production NODE_ENV) into .next-preview, served by `next start` on BASE+4 (scripts/e2e-servers.mjs).
 * The kit ships dormant: a reviewer turns it on with `window.__proompter.enable()`.
 */
test.use({ viewport: { width: 1440, height: 900 } });

const UI_MARKER = "data-proompter-fonts"; // only the lazy UI chunk contains it
const dock = (page: Page) => page.getByRole("toolbar", { name: "Proompter" });

test("dormant, then enable() shows the kit and files PRO-1 in IndexedDB, and the choice persists", async ({ page }) => {
  const scripts: string[] = [];
  page.on("response", (res) => {
    if (res.request().resourceType() === "script") scripts.push(res.url());
  });
  const uiChunks = async () => {
    const hits: string[] = [];
    for (const url of scripts) if ((await (await page.request.get(url)).text()).includes(UI_MARKER)) hits.push(url);
    return hits;
  };

  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Feed");
  await page.waitForFunction(() => !!window.__proompter);
  await page.waitForLoadState("networkidle");
  await page.evaluate(
    () => new Promise<void>((resolve) => (typeof requestIdleCallback === "function" ? requestIdleCallback(() => resolve(), { timeout: 3000 }) : setTimeout(resolve, 100))),
  );
  expect(await page.evaluate(() => window.__proompter?.enabled())).toBe(false);
  expect(await page.evaluate(() => window.__proompter?.entries())).toEqual([]);
  await expect(page.locator("proompter-root")).toHaveCount(0);
  expect(scripts.length).toBeGreaterThan(0); // the check below can't pass vacuously
  expect(await uiChunks()).toEqual([]); // no UI chunk was requested

  await page.evaluate(() => window.__proompter?.enable());
  await expect(dock(page)).toBeVisible();
  await expect(page.locator(".dock")).not.toHaveClass(/\bintro\b/);
  expect((await uiChunks()).length).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.__proompter?.enabled())).toBe(true);

  // Pick the avatar and file it with ⌘↵: the entry lands in the browser (IndexedDB), no files route.
  await page.getByRole("button", { name: "Pick element", exact: true }).click();
  const avatar = page.getByTestId("post-avatar");
  await avatar.hover();
  await expect(page.locator(".pm-hlab")).toBeVisible();
  await avatar.click();
  const composer = composerOf(page);
  await expect(composer).toBeVisible();
  await composer.getByLabel("Title").fill("Avatar sits too close to the name");
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(composer).toBeHidden();
  await expect(page.locator(".pm-comp")).toHaveCount(0);
  await page.keyboard.press("e");
  await expect(page.getByRole("button", { name: /^PRO-1: Avatar sits too close/ })).toBeVisible();
  await expect(avatar).toHaveAttribute("data-src", /avatar\.tsx:\d+:\d+$/); // the loader ran in this build

  // A reload stays enabled; disable() and a reload is dormant again.
  await page.reload();
  await page.waitForFunction(() => !!window.__proompter);
  expect(await page.evaluate(() => window.__proompter?.enabled())).toBe(true);
  await page.evaluate(() => window.__proompter?.open());
  await expect(dock(page)).toBeVisible();
  await page.evaluate(() => window.__proompter?.disable());
  await expect(page.locator("proompter-root")).toHaveCount(0);
  await page.reload();
  await page.waitForFunction(() => !!window.__proompter);
  expect(await page.evaluate(() => window.__proompter?.enabled())).toBe(false);
  await expect(page.locator("proompter-root")).toHaveCount(0);
});
