import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { assetNames } from "../src/core/serialize";
import { cleanReviews, composerOf, openKit, sessionDir, waitForFile } from "./support";

/** D17: PNG snapshots have typed values and `[data-proompter-redact]` blocks painted #000. */
test.describe.configure({ mode: "serial" });
test.use({ viewport: { width: 1440, height: 900 } });
test.setTimeout(120_000);

test.beforeEach(cleanReviews);
test.afterEach(cleanReviews);

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Decodes the PNG by drawing it on a canvas inside the page (no PNG library). `boxes` are border boxes in CSS px
 * relative to the PNG's top-left; the image's own width gives the scale. Per box it counts the pixels that are NOT
 * exactly #000 inside it (inset 1 device px from each edge, where rounding could bite), and the pixels that ARE
 * #000 in a strip 4 CSS px beyond its right edge (white page there): the mask is the element, not a bigger block. `leaks` counts #f0f pixels anywhere (the field border colour).
 */
async function check(page: Page, file: string, cssWidth: number, boxes: Box[]) {
  const b64 = readFileSync(file).toString("base64");
  return page.evaluate(
    async ({ b64, cssWidth, boxes }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = document.createElement("canvas");
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const ctx = c.getContext("2d")!;
      ctx.drawImage(img, 0, 0);
      const k = img.naturalWidth / cssWidth;
      const count = (x: number, y: number, w: number, h: number, black: boolean) => {
        const d = ctx.getImageData(x, y, w, h).data;
        let n = 0;
        for (let i = 0; i < d.length; i += 4) {
          if ((d[i] === 0 && d[i + 1] === 0 && d[i + 2] === 0 && d[i + 3] === 255) === black) n++;
        }
        return { total: d.length / 4, n };
      };
      // The fields' 2px border is exactly #f0f (magenta: no grey gradient or anti-aliased text can hit it, unlike #888, which Next's dev badge produced on Linux): any such pixel is a field left visible.
      const all = ctx.getImageData(0, 0, c.width, c.height).data;
      let leaks = 0;
      let black = 0;
      for (let i = 0; i < all.length; i += 4) {
        if (all[i] === 255 && all[i + 1] === 0 && all[i + 2] === 255) leaks++;
        if (all[i] === 0 && all[i + 1] === 0 && all[i + 2] === 0 && all[i + 3] === 255) black++;
      }
      return {
        scale: k,
        leaks,
        black,
        area: boxes.reduce((a, b) => a + b.w * b.h, 0) * k * k,
        inside: boxes.map((b) => count(Math.ceil(b.x * k) + 1, Math.ceil(b.y * k) + 1, Math.floor(b.w * k) - 2, Math.floor(b.h * k) - 2, false)),
        outside: boxes.map((b) => count(Math.ceil((b.x + b.w + 4) * k), Math.ceil(b.y * k) + 1, Math.ceil(2 * k), Math.floor(b.h * k) - 2, true)),
      };
    },
    { b64, cssWidth, boxes },
  );
}

const ids = ["redact-card", "redact-input", "redact-block", "fluid-card", "fluid-right", "fluid-center", "panel-input"] as const;
async function rects(page: Page) {
  return page.evaluate((ids) => {
    const out: Record<string, Box> = {};
    for (const id of ids) {
      const r = document.querySelector(`[data-testid=${id}]`)!.getBoundingClientRect();
      out[id] = { x: r.left, y: r.top, w: r.width, h: r.height };
    }
    return out;
  }, ids);
}

/** Pick `testid` by its padding corner (so a parent, not a field), and file it. Returns the session's assets dir. */
async function pickAndFile(page: Page, testid: string) {
  await page.getByRole("button", { name: "Pick element", exact: true }).click();
  const b = (await page.getByTestId(testid).boundingBox())!;
  await page.mouse.move(b.x + 4, b.y + 4);
  await expect(page.locator(".pm-hlab")).toBeVisible();
  await page.mouse.click(b.x + 4, b.y + 4);
  const composer = composerOf(page);
  await expect(composer).toBeVisible();
  await composer.getByLabel("Title").fill("Card shows secrets");
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(composer).toBeHidden();
  const session = await sessionDir();
  await waitForFile(() => path.join(session, "entries"), "001-", ".md");
  return path.join(session, "assets");
}

const rel = (b: Box, o: Box, pad = 12): Box => ({ ...b, x: b.x - o.x + pad, y: b.y - o.y + pad });

/**
 * The mask lives in the clone, so it follows wherever html-to-image lays a field out. That can differ from the live
 * page (a grid with auto margins), so every box is checked only for what must hold everywhere: no field border
 * survives and the image holds at least as much black as the boxes' area. The first `placed` boxes sit where the
 * live page has them, and are also checked pixel for pixel.
 */
function expectMasked(r: Awaited<ReturnType<typeof check>>, n: number, placed = n) {
  expect(r.leaks).toBe(0); // no field border survives anywhere
  expect(r.black).toBeGreaterThanOrEqual(r.area * 0.95); // and every box's worth of pixels is black
  const inside = r.inside.slice(0, placed);
  expect(inside.map((b) => b.n)).toEqual(Array(placed).fill(0)); // every interior pixel is #000
  expect(inside.every((b) => b.total > 100)).toBe(true); // and the boxes were not empty
  expect(r.outside.slice(0, placed).map((b) => b.n)).toEqual(Array(placed).fill(0)); // 4px past the right edge: not black
  expect(r.inside).toHaveLength(n);
}

for (const dpr of [1, 2]) {
  test.describe(`deviceScaleFactor ${dpr}`, () => {
    test.use({ deviceScaleFactor: dpr });

    test("the card: typed input and marked block are masked exactly in both PNGs", async ({ page }) => {
      await page.goto("/redact");
      await openKit(page);
      const g = await rects(page);
      const assets = await pickAndFile(page, "redact-card");
      const names = assetNames(1, "responsive");
      const crop = await check(page, await waitForFile(() => assets, names.element, ""), Math.ceil(g["redact-card"]!.w) + 24, [
        rel(g["redact-input"]!, g["redact-card"]!),
        rel(g["redact-block"]!, g["redact-card"]!),
      ]);
      expect(crop.scale).toBe(dpr);
      expectMasked(crop, 2);
      const view = await check(page, await waitForFile(() => assets, names.viewport, ""), 1440, [
        g["redact-input"]!,
        g["redact-block"]!,
        g["panel-input"]!,
        g["fluid-right"]!,
        g["fluid-center"]!,
      ]);
      expectMasked(view, 5, 3);
    });

    test("a grid parent: right-aligned and centred inputs are masked wherever the clone lays them out", async ({ page }) => {
      await page.goto("/redact");
      await openKit(page);
      const g = await rects(page);
      const assets = await pickAndFile(page, "fluid-card");
      const names = assetNames(1, "responsive");
      const f = g["fluid-card"]!;
      // The crop is as wide as the live card (about 1360 css px) plus the padding; the clone must not be stretched.
      const crop = await check(page, await waitForFile(() => assets, names.element, ""), Math.ceil(f.w) + 24, [
        rel(g["fluid-right"]!, f),
        rel(g["fluid-center"]!, f),
      ]);
      expectMasked(crop, 2, 0);
    });

    test("scrolled page with a field in a fixed panel: both PNGs are taken and every field is masked", async ({ page }) => {
      await page.goto("/redact");
      await openKit(page);
      await page.evaluate(() => window.scrollTo(0, 100));
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(100);
      const g = await rects(page);
      const assets = await pickAndFile(page, "fluid-card");
      const names = assetNames(1, "responsive");
      const f = g["fluid-card"]!;
      const crop = await check(page, await waitForFile(() => assets, names.element, ""), Math.ceil(f.w) + 24, [
        rel(g["fluid-right"]!, f),
        rel(g["fluid-center"]!, f),
      ]);
      expectMasked(crop, 2, 0);
      const view = await check(page, await waitForFile(() => assets, names.viewport, ""), 1440, [
        g["panel-input"]!,
        g["fluid-right"]!,
        g["fluid-center"]!,
      ]);
      expectMasked(view, 3, 0); // the fixed panel is shifted by the scroll transform in the clone, and still masked
      await expect(page.getByText("Snapshot hidden")).toHaveCount(0);
    });
  });
}
