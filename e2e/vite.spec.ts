import { readdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { assetNames } from "../src/core/serialize";
import { composerOf, openKit, PNG_MAGIC, readEntry, sessionDir, VITE_REVIEWS, waitForFile } from "./support";

/**
 * D14: the kit in a plain React app built with Vite (examples/vite, `proompter()` + `@vitejs/plugin-react`).
 * - :3102 is `vite` dev with VITE_PROOMPTER=true: stamping, the kit and the dev route write files.
 * - :3103 is `vite preview` of a `vite build` with the flag unset: nothing of the kit ships.
 */
const DEV = "http://localhost:3102";
const PREVIEW = "http://localhost:3103";
const DIST = fileURLToPath(new URL("../examples/vite/dist", import.meta.url));

test.describe.configure({ mode: "serial" });
test.use({ viewport: { width: 1440, height: 900 } });
test.setTimeout(120_000);

const clean = () => rmSync(VITE_REVIEWS, { recursive: true, force: true });
test.beforeEach(clean);
test.afterEach(clean);

test("vite dev: picking the avatar writes entries/001-*.md with its source and both PNGs", async ({ page }) => {
  await page.goto(DEV);
  await openKit(page);
  await page.getByRole("button", { name: "Pick element", exact: true }).click();
  const avatar = page.getByTestId("post-avatar");
  await avatar.hover();
  await expect(page.locator(".pm-hlab")).toBeVisible();
  await avatar.click();
  const composer = composerOf(page);
  await composer.getByLabel("Title").fill("Avatar needs a border");
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(composer).toBeHidden();

  const session = await sessionDir(VITE_REVIEWS);
  const entry = readEntry(await waitForFile(() => path.join(session, "entries"), "001-", ".md"));
  expect(entry.id).toBe("PRO-1");
  expect(entry.kind).toBe("element");
  expect(entry.target?.source).toMatch(/examples\/vite\/src\/avatar\.tsx:\d+:\d+$/);
  expect(entry.target?.sourceInherited).toBe(false);
  expect(entry.target?.component).toContain("Avatar");
  await expect(page.locator(entry.target?.selector ?? "")).toHaveAttribute("data-testid", "post-avatar");

  const names = assetNames(1, "responsive");
  for (const name of [names.element, names.viewport]) {
    const png = await waitForFile(() => path.join(session, "assets"), name, "");
    expect(readFileSync(png).subarray(0, 8).equals(PNG_MAGIC)).toBe(true);
  }
});

test("vite build, flag unset: no kit code in dist, no stamps, no route", async ({ page, request }) => {
  const files = readdirSync(DIST, { recursive: true, encoding: "utf8" }).filter((f) => /\.(js|html)$/.test(f));
  expect(files.length).toBeGreaterThan(0);
  for (const f of files) {
    const text = readFileSync(path.join(DIST, f), "utf8");
    for (const marker of ["proompter-root", "__proompter", "data-src"]) {
      expect(text, `${marker} in dist/${f}`).not.toContain(marker);
    }
  }

  await page.goto(PREVIEW);
  await expect(page.getByTestId("post-avatar")).toBeVisible();
  await expect(page.locator("proompter-root")).toHaveCount(0);
  expect(await page.evaluate(() => "__proompter" in window)).toBe(false);

  const res = await request.post(`${PREVIEW}/api/proompter`, {
    headers: { "x-proompter": "1", "content-type": "application/json" },
    data: { session: {} },
  });
  expect(res.ok()).toBe(false);
});
