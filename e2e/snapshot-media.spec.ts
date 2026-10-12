import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { assetNames } from "../src/core/serialize";
import { cleanReviews, composerOf, openKit, sessionDir, waitForFile } from "./support";

/**
 * Snapshots of pages with media the browser won't let us read back: a cross-origin <video> and a canvas tainted by a
 * cross-origin image, both served by a second origin with no CORS headers (BASE+6, scripts/e2e-servers.mjs). They
 * used to make html-to-image throw a SecurityError and the entry was saved with no picture at all.
 */
test.describe.configure({ mode: "serial" });
test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
test.setTimeout(120_000);

test.beforeEach(cleanReviews);
test.afterEach(cleanReviews);

const MEDIA = `http://localhost:${Number(process.env.E2E_PORT_BASE ?? 3100) + 6}`;
const GREY = 0x2a; // the placeholder, #2a2a2a

/** Records half a second of a canvas as WebM in the browser (no encoder dependency) and stores it on the media origin. */
async function uploadClip(page: Page) {
  await page.goto("/");
  const b64 = await page.evaluate(async () => {
    const c = document.createElement("canvas");
    c.width = 64;
    c.height = 36;
    const ctx = c.getContext("2d")!;
    const rec = new MediaRecorder(c.captureStream(15), { mimeType: "video/webm" });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => chunks.push(e.data);
    const done = new Promise<void>((r) => (rec.onstop = () => r()));
    rec.start();
    for (let i = 0; i < 10; i++) {
      ctx.fillStyle = `hsl(${i * 30} 80% 50%)`;
      ctx.fillRect(0, 0, 64, 36);
      await new Promise((r) => setTimeout(r, 60));
    }
    rec.stop();
    await done;
    const buf = new Uint8Array(await new Blob(chunks).arrayBuffer());
    let s = "";
    for (const b of buf) s += String.fromCharCode(b);
    return btoa(s);
  });
  expect(b64.length, "the recorded clip").toBeGreaterThan(0);
  const res = await page.request.put(`${MEDIA}/clip.webm`, { data: Buffer.from(b64, "base64") });
  expect(res.status()).toBe(204);
}

/** Opens /media with both pieces of media loaded, and checks they really are unreadable (the premise of the spec). */
async function openMediaPage(page: Page) {
  await uploadClip(page);
  await page.goto(`/media?origin=${encodeURIComponent(MEDIA)}`);
  await page.waitForFunction(() => {
    const v = document.querySelector("video")!;
    return v.readyState >= 2 && !!v.currentSrc;
  });
  const taint = () =>
    page.evaluate(async () => {
      const v = document.querySelector("video")!;
      const probe = (draw: () => void, read: () => string) => {
        try {
          draw();
          read();
          return "readable";
        } catch (e) {
          return (e as Error).name;
        }
      };
      const p = document.createElement("canvas");
      p.width = p.height = 1;
      const c = document.querySelector("canvas")!;
      return {
        video: probe(() => p.getContext("2d")!.drawImage(v, 0, 0, 1, 1), () => p.toDataURL()),
        canvas: probe(() => {}, () => c.toDataURL()),
      };
    });
  await expect.poll(taint).toEqual({ video: "SecurityError", canvas: "SecurityError" });
}

/** Mean RGB of the 2x2 device pixels at `(x, y)` (CSS px, relative to the PNG's top-left). */
async function pixel(page: Page, file: string, x: number, y: number, cssWidth: number) {
  const b64 = readFileSync(file).toString("base64");
  return page.evaluate(
    async ({ b64, x, y, cssWidth }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = document.createElement("canvas");
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const ctx = c.getContext("2d")!;
      ctx.drawImage(img, 0, 0);
      const k = img.naturalWidth / cssWidth;
      return Array.from(ctx.getImageData(Math.round(x * k), Math.round(y * k), 1, 1).data);
    },
    { b64, x, y, cssWidth },
  );
}

const isGrey = (p: number[]) => p.slice(0, 3).every((v) => Math.abs(v - GREY) <= 3) && p[3] === 255;

test("negative control: html-to-image alone throws a SecurityError on this page", async ({ page }) => {
  await openMediaPage(page);
  const lib = path.join(process.cwd(), "node_modules/html-to-image/dist/html-to-image.js");
  test.skip(!existsSync(lib), "html-to-image's UMD build is not at node_modules/html-to-image/dist/html-to-image.js");
  await page.addScriptTag({ path: lib });
  const err = await page.evaluate(async () => {
    const lib = (window as unknown as { htmlToImage: { toSvg(n: Element, o?: object): Promise<string> } }).htmlToImage;
    const card = document.querySelector("[data-testid=media-card]")!;
    const attempt = async (o?: object) => {
      try {
        await lib.toSvg(card, o);
        return "ok";
      } catch (e) {
        return `${(e as Error).name}: ${(e as Error).message}`;
      }
    };
    // Same text-free options the kit uses, and the retry without fonts: neither can save it.
    return [await attempt(), await attempt({ skipFonts: true })];
  });
  console.log("negative control:", err);
  for (const e of err) expect(e).toMatch(/SecurityError/);
});

test("an element entry and a page note both get PNGs, with a grey placeholder where the media sits", async ({ page }) => {
  await openMediaPage(page);
  await openKit(page);
  const rect = (id: string) =>
    page.evaluate((id) => {
      const r = document.querySelector(`[data-testid=${id}]`)!.getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height };
    }, id);
  const card = await rect("media-card");
  const video = await rect("media-video");
  const canvas = await rect("media-canvas");

  // 1. Element entry on the wrapper (picked by its padding corner).
  await page.getByRole("button", { name: "Pick element", exact: true }).click();
  await page.mouse.move(card.x + 4, card.y + 4);
  await expect(page.locator(".pm-hlab")).toBeVisible();
  await page.mouse.click(card.x + 4, card.y + 4);
  const composer = composerOf(page);
  await expect(composer).toBeVisible();
  await composer.getByLabel("Title").fill("Clip card looks off");
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(composer).toBeHidden();

  // 2. A page note.
  await page.keyboard.press("n");
  await expect(composer.getByLabel("Title")).toBeFocused();
  await page.keyboard.type("Feed needs a poster frame");
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(composer).toBeHidden();

  const assets = path.join(await sessionDir(), "assets");
  const one = assetNames(1, "responsive");
  const two = assetNames(2, "responsive");
  const crop = await waitForFile(() => assets, one.element, "");
  const view1 = await waitForFile(() => assets, one.viewport, "");
  const view2 = await waitForFile(() => assets, two.viewport, "");
  await expect(page.getByText("Saved without a screenshot")).toHaveCount(0);

  // The viewport PNGs: grey just inside the top-left corner of each piece of media (clear of the centred label).
  for (const file of [view1, view2]) {
    expect(isGrey(await pixel(page, file, video.x + 6, video.y + 6, 1440))).toBe(true);
    expect(isGrey(await pixel(page, file, canvas.x + 6, canvas.y + 6, 1440))).toBe(true);
    // and normal content is still there: the card's white background between the media
    expect(await pixel(page, file, card.x + 300, card.y + 300, 1440)).toEqual([255, 255, 255, 255]);
  }
  // The element crop: the card plus 12px padding, so the media sits at its offset in the card.
  const w = Math.ceil(card.w) + 24;
  expect(isGrey(await pixel(page, crop, video.x - card.x + 12 + 6, video.y - card.y + 12 + 6, w))).toBe(true);
  expect(isGrey(await pixel(page, crop, canvas.x - card.x + 12 + 6, canvas.y - card.y + 12 + 6, w))).toBe(true);
});

test("picking the unreadable video itself still gives an element PNG: the placeholder alone", async ({ page }) => {
  await openMediaPage(page);
  await openKit(page);
  const v = await page.getByTestId("media-video").boundingBox();
  await page.getByRole("button", { name: "Pick element", exact: true }).click();
  await page.mouse.move(v!.x + 20, v!.y + 20);
  await expect(page.locator(".pm-hlab")).toBeVisible();
  await page.mouse.click(v!.x + 20, v!.y + 20);
  const composer = composerOf(page);
  await expect(composer).toBeVisible();
  await composer.getByLabel("Title").fill("Clip is cropped");
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(composer).toBeHidden();
  const assets = path.join(await sessionDir(), "assets");
  const crop = await waitForFile(() => assets, assetNames(1, "responsive").element, "");
  await waitForFile(() => assets, assetNames(1, "responsive").viewport, "");
  await expect(page.getByText("Saved without")).toHaveCount(0);
  const w = Math.ceil(v!.width) + 24;
  expect(isGrey(await pixel(page, crop, 12 + 6, 12 + 6, w))).toBe(true);
  expect(isGrey(await pixel(page, crop, 12 + v!.width - 6, 12 + v!.height - 6, w))).toBe(true);
  expect(await pixel(page, crop, 3, 3, w)).toEqual([0, 0, 0, 0]); // the padding around it is empty
});

test("scrolled page: the placeholders follow the media to its place in the viewport", async ({ page }) => {
  await openMediaPage(page);
  await openKit(page);
  await page.evaluate(() => window.scrollTo(0, 200));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(200);
  const rect = (id: string) =>
    page.evaluate((id) => {
      const r = document.querySelector(`[data-testid=${id}]`)!.getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height };
    }, id);
  const video = await rect("media-video");
  const canvas = await rect("media-canvas");
  expect(video.y).toBeLessThan(0 + 135); // partly scrolled out of view
  await page.keyboard.press("n");
  const composer = composerOf(page);
  await expect(composer.getByLabel("Title")).toBeFocused();
  await page.keyboard.type("Scrolled note");
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(composer).toBeHidden();
  const assets = path.join(await sessionDir(), "assets");
  const view = await waitForFile(() => assets, assetNames(1, "responsive").viewport, "");
  await expect(page.getByText("Saved without")).toHaveCount(0);
  expect(isGrey(await pixel(page, view, canvas.x + 6, canvas.y + 6, 1440))).toBe(true);
  expect(isGrey(await pixel(page, view, video.x + 6, Math.max(video.y + 6, 6), 1440))).toBe(true); // the part still in view
  expect(isGrey(await pixel(page, view, video.x + 6, video.y + video.h + 6, 1440))).toBe(false); // and not below it
});
