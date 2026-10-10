import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { assetNames } from "../src/core/serialize";
import { cleanReviews, composerOf, frameOf, openKit, PNG_MAGIC, readEntry, sessionDir, waitForFile } from "./support";

/**
 * DESIGN 11.2 and 11.3: the real flow in the playground (dev, flag on), through the real store, the real
 * serializer and the real route (/api/proompter, T09). Needs T09 merged: without the route nothing reaches disk.
 *
 * Every test here writes under examples/playground/reviews/, so they run one after another and clean it
 * before and after.
 */
test.describe.configure({ mode: "serial" });
test.use({ viewport: { width: 1440, height: 900 } });
test.setTimeout(120_000); // the first hit compiles the page and the lazy UI chunk in `next dev`

test.beforeEach(cleanReviews);
test.afterEach(cleanReviews);

const SOURCE = /examples\/playground\/components\/avatar\.tsx:\d+:\d+$/;

/** Pick the post card's avatar with the mouse and file it with ⌘↵. `scope` is the page or the device frame. */
async function pickAndFile(page: Page, scope: Page | ReturnType<typeof frameOf>, title: string) {
  await page.getByRole("button", { name: "Pick element", exact: true }).click();
  const avatar = scope.getByTestId("post-avatar");
  await avatar.hover();
  await expect(page.locator(".pm-hlab")).toBeVisible(); // the hover label names what a click would pick
  await avatar.click();
  const composer = composerOf(page);
  await expect(composer).toBeVisible();
  await composer.getByLabel("Title").fill(title);
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(composer).toBeHidden();
}

test("11.2: picking the avatar in the post card writes entries/001-*.md and a PNG", async ({ page }) => {
  await page.goto("/");
  await openKit(page);
  await pickAndFile(page, page, "Avatar sits too close to the name");

  const session = await sessionDir();
  const file = await waitForFile(() => path.join(session, "entries"), "001-", ".md");
  const entry = readEntry(file);

  expect(entry.id).toBe("PRO-1");
  expect(entry.viewport).toBe("responsive");
  expect(entry.route).toBe("/");
  expect(entry.kind).toBe("element");
  expect(entry.target?.source).toMatch(SOURCE);
  expect(entry.target?.sourceInherited).toBe(false);
  // The selector is stored in the file and finds exactly the avatar again.
  const selector = entry.target?.selector ?? "";
  expect(selector).not.toBe("");
  await expect(page.locator(selector)).toHaveCount(1);
  await expect(page.locator(selector)).toHaveAttribute("data-testid", "post-avatar");
  expect(entry.target?.component).toContain("Avatar");

  // session.md sits next to the entries.
  const sessionMd = readFileSync(path.join(session, "session.md"), "utf8");
  expect(sessionMd).toContain("proompter: 1");
  expect(sessionMd).toContain("playground");

  const png = await waitForFile(() => path.join(session, "assets"), "001-", ".png");
  expect(readFileSync(png).subarray(0, 8).equals(PNG_MAGIC)).toBe(true);
  expect(path.basename(png)).toBe(assetNames(1, "responsive").element);
});

for (const [name, id, key] of [
  ["Tablet", "tablet", "3"],
  ["Mobile", "mobile", "4"],
] as const) {
  test(`11.3: the same flow on ${name}; the pin shows only on ${name}`, async ({ page }) => {
    await page.goto("/");
    await openKit(page);
    await page.getByRole("radio", { name, exact: true }).click();
    await expect(page.locator("iframe[title='App under review']")).toBeVisible();
    const frame = frameOf(page);
    await expect(frame.getByTestId("post-avatar")).toBeVisible();

    await pickAndFile(page, frame, `Avatar crop on ${id}`);

    const session = await sessionDir();
    const file = await waitForFile(() => path.join(session, "entries"), "001-", ".md");
    const entry = readEntry(file);
    expect(entry.viewport).toBe(id);
    expect(entry.size.width).toBe(id === "mobile" ? 390 : 834);
    expect(entry.target?.source).toMatch(SOURCE);
    expect(entry.target?.sourceInherited).toBe(false);
    await expect(frame.locator(entry.target?.selector ?? "")).toHaveCount(1);

    const png = await waitForFile(() => path.join(session, "assets"), "001-", ".png");
    expect(readFileSync(png).subarray(0, 8).equals(PNG_MAGIC)).toBe(true);
    expect(path.basename(png)).toBe(assetNames(1, id).element);

    // Pins belong to the viewport they were filed on.
    const pin = page.locator(".pm-pin[data-id='1']");
    await expect(pin).toBeVisible();
    await page.keyboard.press("1"); // Responsive
    await expect(page.getByRole("radio", { name: "Responsive" })).toBeChecked();
    await expect(pin).toHaveCount(0);
    await page.keyboard.press(key);
    await expect(page.getByRole("radio", { name, exact: true })).toBeChecked();
    await expect(pin).toBeVisible();
  });
}

test("11.5: a page note filed from the keyboard alone reaches disk", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => !!window.__proompter);
  await page.keyboard.press("ControlOrMeta+Shift+."); // show the kit
  await expect(page.getByRole("toolbar", { name: "Proompter" })).toBeVisible();
  await page.keyboard.press("n");
  const composer = composerOf(page);
  await expect(composer.getByLabel("Title")).toBeFocused();
  await page.keyboard.type("Feed needs an empty state");
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(composer).toBeHidden();

  const session = await sessionDir();
  const entry = readEntry(await waitForFile(() => path.join(session, "entries"), "001-", ".md"));
  expect(entry.kind).toBe("note");
  expect(entry.title).toBe("Feed needs an empty state");
  expect(entry.target).toBeUndefined();

  await page.keyboard.press("e");
  await expect(page.getByRole("button", { name: /^PRO-1: Feed needs an empty state/ })).toBeVisible();
});
