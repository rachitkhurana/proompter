import { expect, test, type Page } from "@playwright/test";
import { openKit } from "./support";

/**
 * DESIGN 11.4, both directions, on the real playground page (dev, flag on). No entries are filed here, so
 * nothing touches reviews/.
 *   A. host CSS can't change the kit: hostile rules aimed at everything in the host document leave the kit's
 *      pixels unchanged (dock and an open sheet, compared byte for byte before and after).
 *   B. the kit's CSS can't change the host: with the kit closed and then open, a host region that sits clear
 *      of the kit looks the same (pixels), and every host element keeps its computed style. The only
 *      additions to the host document are the kit's own root and the one `<style data-proompter-fonts>` tag.
 */
test.use({ viewport: { width: 1440, height: 900 } });
test.setTimeout(120_000);

// Aimed at the host's own content. The kit's root element is left out on purpose: it sits in the light DOM,
// so a rule that transforms or hides that one element is a host choice no shadow root can undo.
const HOSTILE = `
  :not(proompter-root), :not(proompter-root)::before, :not(proompter-root)::after {
    font: italic 700 31px/2.4 "Courier New", monospace !important;
    letter-spacing: 6px !important;
    text-transform: uppercase !important;
    color: hotpink !important;
    background: lime !important;
    border: 3px dashed red !important;
    border-radius: 0 !important;
    margin: 17px !important;
    padding: 19px !important;
    box-sizing: content-box !important;
    cursor: wait !important;
    animation: none !important;
    transition: none !important;
  }
  button, div, span, section, nav, ul, li, dialog { display: block !important; width: 7px !important; }
  [role="toolbar"], [role="dialog"] { position: static !important; opacity: .1 !important; }
`;

async function settle(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(500);
}

test("A: hostile host CSS leaves the kit's pixels alone", async ({ page }) => {
  await page.goto("/");
  await openKit(page);
  await page.keyboard.press("e");
  const sheet = page.getByLabel("Review session", { exact: true });
  await expect(sheet).toHaveClass(/\bon\b/);
  await settle(page);

  // The dock and sheet are translucent glass, so what is painted behind them is part of their pixels. Put an
  // opaque host-side cover under the kit (above the page) so the hostile rules can't change the backdrop;
  // the id rules beat the hostile `!important` ones on specificity. Anything that still differs is a leak.
  await page.evaluate(() => {
    const cover = document.createElement("div");
    cover.id = "pp-cover";
    document.body.append(cover);
  });
  await page.addStyleTag({
    content: `#pp-cover{position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;display:block!important;margin:0!important;padding:0!important;border:0!important;background:#223!important;z-index:1!important}`,
  });
  await settle(page);

  const dock = page.locator(".dock");
  const shots = { dock: await dock.screenshot({ animations: "disabled" }), sheet: await sheet.screenshot({ animations: "disabled" }) };
  const boxes = { dock: await dock.boundingBox(), sheet: await sheet.boundingBox() };

  await page.addStyleTag({ content: HOSTILE });
  // The hostile sheet really did restyle the host: its mock page is now unrecognisable.
  await expect(page.locator(".h-main")).toHaveCSS("letter-spacing", "6px");
  await settle(page);

  expect(await dock.boundingBox()).toEqual(boxes.dock);
  expect(await sheet.boundingBox()).toEqual(boxes.sheet);
  expect((await dock.screenshot({ animations: "disabled" })).equals(shots.dock)).toBe(true);
  expect((await sheet.screenshot({ animations: "disabled" })).equals(shots.sheet)).toBe(true);
});

test("B: opening the kit leaves the host's pixels, styles and document alone", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("proompter-root")).toHaveCount(0); // closed: nothing is drawn
  await settle(page);

  // `.h-head` (the feed title row) is top-centre, clear of the bottom dock and the right-hand sheet.
  const region = page.locator(".h-head");
  const snapshotDom = () =>
    page.evaluate(() => {
      const props = ["font-family", "font-size", "color", "background-color", "margin-top", "padding-left", "display", "width", "height", "letter-spacing"];
      const styles = [...document.querySelectorAll(".h-root, .h-root *")].map((el) => {
        const cs = getComputedStyle(el);
        return props.map((p) => cs.getPropertyValue(p)).join("|");
      });
      return {
        styles,
        headTags: [...document.head.children].map((n) => n.outerHTML.slice(0, 400)),
        bodyChildren: [...document.body.children].map((n) => n.tagName.toLowerCase()),
        bodyAttrs: document.body.getAttributeNames().sort(),
        bodyStyle: document.body.getAttribute("style"),
        htmlAttrs: document.documentElement.getAttributeNames().sort(),
        htmlStyle: document.documentElement.getAttribute("style"),
        sheets: document.styleSheets.length,
      };
    });

  const closedShot = await region.screenshot({ animations: "disabled", caret: "hide" });
  const closed = await snapshotDom();

  await openKit(page);
  await settle(page);

  const openShot = await region.screenshot({ animations: "disabled", caret: "hide" });
  const open = await snapshotDom();

  expect(openShot.equals(closedShot)).toBe(true);
  expect(open.styles).toEqual(closed.styles);
  expect(open.bodyAttrs).toEqual(closed.bodyAttrs);
  expect(open.bodyStyle).toEqual(closed.bodyStyle);
  expect(open.htmlAttrs).toEqual(closed.htmlAttrs);
  expect(open.htmlStyle).toEqual(closed.htmlStyle);
  // Allowed additions: the kit's root element and the one font style tag. Nothing else.
  const added = (a: string[], b: string[]) => b.filter((x) => !a.includes(x));
  expect(added(closed.bodyChildren, open.bodyChildren).every((t) => t === "proompter-root")).toBe(true);
  // Next's own chunk loader appends a <script>/<link> for /_next/ assets to <head> when the kit's lazy UI chunk
  // loads (and dev/HMR may add data-next / data-turbopack nodes). That is the framework, not the kit; filter
  // exactly those and nothing else.
  const framework = (h: string) => /\/_next\/|data-next|data-turbopack/.test(h);
  const headAdded = added(closed.headTags, open.headTags).filter((h) => !framework(h));
  expect(headAdded.filter((h) => !h.includes("data-proompter-fonts"))).toEqual([]); // anything else is a leak
  expect(headAdded.length).toBeLessThanOrEqual(1);

  // Closing removes the kit and the font tag again.
  await page.evaluate(() => window.__proompter?.close());
  await expect(page.locator("proompter-root")).toHaveCount(0);
  await expect(page.locator("style[data-proompter-fonts]")).toHaveCount(0);
});
