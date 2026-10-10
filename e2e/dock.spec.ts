import { expect, test, type Locator, type Page } from "@playwright/test";

// Fixture route: examples/playground/app/fixtures/dock.
const URL = "/fixtures/dock";
const VIEWPORT = { width: 1200, height: 800 };

test.use({ viewport: VIEWPORT });
test.setTimeout(60_000); // the first hit compiles the route in `next dev`

const dockOf = (page: Page) => page.locator(".dock");
const gripOf = (page: Page) => page.getByRole("button", { name: /^Move toolbar/ });
const brandOf = (page: Page) => page.getByRole("button", { name: /^(Collapse|Expand) toolbar/ });
const buttonOf = (page: Page, name: string) => page.getByRole("button", { name, exact: true });

async function open(page: Page) {
  await page.goto(URL);
  const dock = dockOf(page);
  await expect(dock).toBeVisible();
  await expect(dock).not.toHaveClass(/\bintro\b/); // the 450ms entrance is over
  return dock;
}

async function box(l: Locator) {
  const b = await l.boundingBox();
  if (!b) throw new Error("no bounding box");
  return b;
}

/** Drag from the centre of `handle` to `to`, and come to rest before releasing so no speed is projected. */
async function dragTo(page: Page, handle: Locator, to: { x: number; y: number }) {
  const b = await box(handle);
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  for (let i = 0; i < 6; i++) {
    await page.mouse.move(to.x + (i % 2), to.y);
    await page.waitForTimeout(40);
  }
  await page.mouse.up();
  return { grab: { x: b.x + b.width / 2, y: b.y + b.height / 2 } };
}

const state = (page: Page) => page.getByTestId("state");

/** Park the pointer away from the dock and wait for every tooltip (even one fading out) to be gone. */
async function quiet(page: Page) {
  await page.mouse.move(600, 600);
  await expect(page.getByRole("tooltip")).toHaveCount(0, { timeout: 4000 });
}

test.describe("dock", () => {
  test("starts at the bottom centre", async ({ page }) => {
    const dock = await open(page);
    const b = await box(dock);
    expect(b.x + b.width / 2).toBeCloseTo(VIEWPORT.width / 2, 0);
    expect(b.y + b.height).toBeCloseTo(VIEWPORT.height - 20, 0);
    await expect(page.getByRole("toolbar", { name: "Proompter" })).toBeVisible();
  });

  test("the grip, brand and buttons show a focus ring from the keyboard", async ({ page }) => {
    await open(page);
    // Other things may come first in the tab order (the Next dev overlay's own button, for one).
    const grip = gripOf(page);
    for (let i = 0; i < 30; i++) {
      await page.keyboard.press("Tab");
      if (await grip.evaluate((el) => el.getRootNode() instanceof ShadowRoot && (el.getRootNode() as ShadowRoot).activeElement === el)) break;
    }
    await expect(grip).toBeFocused();
    await expect(gripOf(page)).toHaveCSS("outline-width", "2px");
    await expect(gripOf(page)).toHaveCSS("outline-style", "solid");
    await page.keyboard.press("Tab");
    await expect(brandOf(page)).toBeFocused();
    await expect(brandOf(page)).toHaveCSS("outline-width", "2px");
    await page.keyboard.press("Tab");
    await expect(buttonOf(page, "Pick element")).toBeFocused();
    await expect(buttonOf(page, "Pick element")).toHaveCSS("outline-width", "2px");
  });

  test("drags 1:1 under the pointer, keeping the grab offset", async ({ page }) => {
    const dock = await open(page);
    const before = await box(dock);
    const grip = gripOf(page);
    const g = await box(grip);
    const offset = { x: g.x + g.width / 2 - before.x, y: g.y + g.height / 2 - before.y };
    await dragTo(page, grip, { x: 500, y: 300 });
    const after = await box(dock);
    // the last rest step nudges the pointer by 1px
    expect(Math.abs(after.x - (501 - offset.x))).toBeLessThan(3);
    expect(Math.abs(after.y - (300 - offset.y))).toBeLessThan(3);
    await expect(dock).toHaveClass(/\bfree\b/);
    await expect(dock).not.toHaveClass(/\bv\b/);
    await expect(state(page)).toContainText("position=free:");
  });

  test("keeps the position after a reload (localStorage)", async ({ page }) => {
    const dock = await open(page);
    await dragTo(page, gripOf(page), { x: 500, y: 300 });
    const placed = await box(dock);
    await page.reload();
    await expect(dock).toBeVisible();
    await expect(dock).toHaveClass(/\bfree\b/);
    const again = await box(dock);
    expect(Math.abs(again.x - placed.x)).toBeLessThan(2);
    expect(Math.abs(again.y - placed.y)).toBeLessThan(2);
  });

  test("snaps to the left and right edges as a vertical bar", async ({ page }) => {
    const dock = await open(page);
    await dragTo(page, gripOf(page), { x: 30, y: 300 });
    await expect(dock).toHaveClass(/\bedge-l\b/);
    await expect(dock).toHaveClass(/\bv\b/);
    await expect.poll(async () => (await box(dock)).x, { timeout: 4000 }).toBeCloseTo(12, 0);
    const left = await box(dock);
    expect(left.height).toBeGreaterThan(left.width);

    await dragTo(page, gripOf(page), { x: VIEWPORT.width - 30, y: 300 });
    await expect(dock).toHaveClass(/\bedge-r\b/);
    await expect
      .poll(async () => {
        const b = await box(dock);
        return b.x + b.width;
      }, { timeout: 4000 })
      .toBeCloseTo(VIEWPORT.width - 12, 0);

    // reload: still a vertical bar on the right
    await page.reload();
    await expect(dock).toHaveClass(/\bedge-r\b/);
  });

  test("tooltips open away from the edge and toasts go to the opposite end", async ({ page }) => {
    const dock = await open(page);
    // bottom centre: tooltip above, toast at the top
    const pick = buttonOf(page, "Pick element");
    const tip = page.getByRole("tooltip");
    await pick.hover();
    await expect(tip).toBeVisible();
    expect((await box(tip)).y + (await box(tip)).height).toBeLessThanOrEqual((await box(pick)).y);
    await buttonOf(page, "Freeze animations").click();
    const toast = page.getByText("Motion frozen on the page");
    await expect(toast).toBeVisible();
    expect((await box(toast)).y).toBeLessThan(VIEWPORT.height / 2);

    // left edge: tooltip to the right of the button
    await dragTo(page, gripOf(page), { x: 30, y: 300 });
    await expect(dock).toHaveClass(/\bedge-l\b/);
    await expect.poll(async () => (await box(dock)).x, { timeout: 4000 }).toBeCloseTo(12, 0);
    await quiet(page);
    await pick.hover();
    await expect(tip).toBeVisible();
    expect((await box(tip)).x).toBeGreaterThanOrEqual((await box(pick)).x + (await box(pick)).width);

    // right edge: tooltip to the left
    await dragTo(page, gripOf(page), { x: VIEWPORT.width - 30, y: 300 });
    await expect(dock).toHaveClass(/\bedge-r\b/);
    await expect
      .poll(async () => {
        const b = await box(dock);
        return b.x + b.width;
      }, { timeout: 4000 })
      .toBeCloseTo(VIEWPORT.width - 12, 0);
    await quiet(page);
    await pick.hover();
    await expect(tip).toBeVisible();
    expect((await box(tip)).x + (await box(tip)).width).toBeLessThanOrEqual((await box(pick)).x);

    // top of the screen: tooltip below, toast at the bottom
    await dragTo(page, gripOf(page), { x: 600, y: 40 });
    await expect(dock).not.toHaveClass(/\bv\b/);
    await buttonOf(page, "Freeze animations").click(); // resumes
    const resumed = page.getByText("Motion resumed");
    await expect(resumed).toBeVisible();
    expect((await box(resumed)).y).toBeGreaterThan(VIEWPORT.height / 2);
  });

  test("arrow keys on the grip move it 24px; double-click resets", async ({ page }) => {
    const dock = await open(page);
    const grip = gripOf(page);
    await grip.focus();
    const start = await box(dock);
    await page.keyboard.press("ArrowUp");
    const up = await box(dock);
    expect(up.y).toBeCloseTo(start.y - 24, 0);
    expect(up.x).toBeCloseTo(start.x, 0);
    await page.keyboard.press("ArrowLeft");
    const left = await box(dock);
    expect(left.x).toBeCloseTo(start.x - 24, 0);
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowDown");
    const back = await box(dock);
    expect(back.x).toBeCloseTo(start.x, 0);
    expect(back.y).toBeCloseTo(start.y, 0);

    await dragTo(page, grip, { x: 300, y: 200 });
    await expect(dock).toHaveClass(/\bfree\b/);
    await grip.dblclick();
    await expect(dock).not.toHaveClass(/\bfree\b/);
    await expect.poll(async () => (await box(dock)).y + (await box(dock)).height, { timeout: 4000 }).toBeCloseTo(VIEWPORT.height - 20, 0);
    const b = await box(dock);
    expect(b.x + b.width / 2).toBeCloseTo(VIEWPORT.width / 2, 0);
    await expect(page.getByText("Toolbar is back at the bottom centre")).toBeVisible();
    await expect(state(page)).toContainText("position=default");
  });

  test("clicking the brand collapses and expands; a drag does not", async ({ page }) => {
    const dock = await open(page);
    const brand = brandOf(page);
    const full = await box(dock);
    await brand.click();
    await expect(dock).toHaveClass(/\bcol\b/);
    await expect(brand).toHaveAttribute("aria-expanded", "false");
    await expect(buttonOf(page, "Pick element")).toBeHidden();
    await expect.poll(async () => (await box(dock)).width, { timeout: 3000 }).toBeLessThan(full.width / 2);
    await expect(state(page)).toContainText("collapsed=true");

    // a click is under 4px of movement
    const b = await box(brand);
    await page.mouse.move(b.x + 10, b.y + 10);
    await page.mouse.down();
    await page.mouse.move(b.x + 12, b.y + 11);
    await page.mouse.up();
    await expect(dock).not.toHaveClass(/\bcol\b/);
    await expect(brand).toHaveAttribute("aria-expanded", "true");
    await expect.poll(async () => (await box(dock)).width, { timeout: 3000 }).toBeGreaterThan(full.width - 4);

    // 4px or more is a drag: the dock moves and stays expanded
    const b2 = await box(brand);
    await page.mouse.move(b2.x + 10, b2.y + 10);
    await page.mouse.down();
    await page.mouse.move(b2.x + 60, b2.y + 10, { steps: 6 });
    for (let i = 0; i < 6; i++) {
      await page.mouse.move(b2.x + 60 + (i % 2), b2.y + 10);
      await page.waitForTimeout(40);
    }
    await page.mouse.up();
    await expect(dock).not.toHaveClass(/\bcol\b/);
    await expect(dock).toHaveClass(/\bfree\b/);
  });

  test("Enter and Space on the brand toggle, and the state survives a reload", async ({ page }) => {
    const dock = await open(page);
    const brand = brandOf(page);
    await brand.focus();
    await page.keyboard.press("Enter");
    await expect(dock).toHaveClass(/\bcol\b/);
    await page.keyboard.press("Space");
    await expect(dock).not.toHaveClass(/\bcol\b/);
    await page.keyboard.press("Space");
    await expect(dock).toHaveClass(/\bcol\b/);
    await page.reload();
    await expect(dock).toBeVisible();
    await expect(dock).toHaveClass(/\bcol\b/);
  });

  test("collapsed on an edge shows the open count as a corner badge", async ({ page }) => {
    const dock = await open(page);
    const badge = dock.locator(".lbadge");
    await expect(badge).toBeHidden(); // expanded: the count lives on Entries
    await dragTo(page, gripOf(page), { x: 30, y: 300 });
    await expect(dock).toHaveClass(/\bedge-l\b/);
    await expect.poll(async () => (await box(dock)).x, { timeout: 4000 }).toBeCloseTo(12, 0);
    await brandOf(page).click();
    await expect(dock).toHaveClass(/\bcol\b/);
    await expect(badge).toBeVisible();
    await expect(badge).toHaveText("3");
    await expect.poll(async () => (await box(dock)).height, { timeout: 3000 }).toBeLessThan(120);
    const brand = await box(brandOf(page));
    const bd = await box(badge);
    expect(bd.x + bd.width / 2).toBeGreaterThan(brand.x + brand.width - 12); // on the right corner
    expect(bd.y + bd.height / 2).toBeLessThan(brand.y + 12); // on the top corner
  });

  test("reports clicks to its owner", async ({ page }) => {
    await open(page);
    await buttonOf(page, "Box select").click();
    await expect(state(page)).toContainText("tool=area");
    await buttonOf(page, "Box select").click();
    await expect(state(page)).toContainText("tool=none");
    await expect(buttonOf(page, "Rotate device")).toHaveAttribute("aria-disabled", "true");
    await page.getByRole("radio", { name: "Tablet" }).click();
    await expect(state(page)).toContainText("viewport=tablet");
    await buttonOf(page, "Rotate device").click();
    await expect(state(page)).toContainText("rotated=true");
    await buttonOf(page, "Entries, 3 open").click();
    await expect(state(page)).toContainText("entries=true");
    await expect(buttonOf(page, "Entries, 3 open").locator(".badge")).toHaveText("3");
  });
});

// T02's TooltipProvider groups tooltips with a `display: contents` wrapper and pointerenter/pointerleave.
// Happy-dom proved the logic; this proves it in a real browser, across real hit-testing.
test.describe("tooltip group (real browser)", () => {
  const tooltip = (page: Page, text: RegExp | string) => page.getByRole("tooltip").filter({ hasText: text });

  test("first tooltip waits 350ms; once warm, neighbours show instantly", async ({ page }) => {
    await open(page);
    const pick = buttonOf(page, "Pick element");
    const multi = buttonOf(page, "Select several elements");

    // cold: nothing at 150ms, shown by 350ms + slack
    await pick.hover();
    await page.waitForTimeout(150);
    await expect(page.getByRole("tooltip")).toHaveCount(0);
    await expect(tooltip(page, /Pick element/)).toBeVisible({ timeout: 1500 });

    // the group goes warm 420ms after the pointer went over the first trigger
    await page.waitForTimeout(500);

    // move across the dock: the next one is there at once (well inside the 350ms cold delay)
    await multi.hover();
    await expect(tooltip(page, /Select several/)).toBeVisible({ timeout: 200 });
    await buttonOf(page, "Box select").hover();
    await expect(tooltip(page, /Box select/)).toBeVisible({ timeout: 200 });
    await buttonOf(page, "Freeze animations").hover();
    await expect(tooltip(page, /Freeze motion/)).toBeVisible({ timeout: 200 });
    // a segmented-control item belongs to the same group
    await page.getByRole("radio", { name: "Tablet" }).hover();
    await expect(tooltip(page, /Tablet 834/)).toBeVisible({ timeout: 200 });
  });

  test("moving through the gaps between buttons keeps the group warm", async ({ page }) => {
    await open(page);
    const pick = await box(buttonOf(page, "Pick element"));
    const freeze = await box(buttonOf(page, "Freeze animations"));
    const y = pick.y + pick.height / 2;
    await page.mouse.move(pick.x + pick.width / 2, y);
    await expect(tooltip(page, /Pick element/)).toBeVisible({ timeout: 1500 });
    await page.waitForTimeout(500);
    // sweep slowly (about 0.7s, longer than the 250ms cool-down) over the buttons and the 2px gaps between
    // them: if the group ever saw a stray pointerleave, it would have gone cold by the end
    const x0 = pick.x + pick.width / 2;
    const x1 = freeze.x + freeze.width / 2;
    for (let i = 1; i <= 35; i++) {
      await page.mouse.move(x0 + ((x1 - x0) * i) / 35, y);
      await page.waitForTimeout(20);
    }
    await expect(tooltip(page, /Freeze motion/)).toBeVisible({ timeout: 200 });
  });

  test("leaving the dock for more than 250ms cools it", async ({ page }) => {
    await open(page);
    const pick = buttonOf(page, "Pick element");
    const multi = buttonOf(page, "Select several elements");
    await pick.hover();
    await expect(tooltip(page, /Pick element/)).toBeVisible({ timeout: 1500 });
    await page.waitForTimeout(500); // warm

    // away for well over 250ms -> cold again
    await page.mouse.move(600, 200);
    await page.waitForTimeout(450);
    await expect(page.getByRole("tooltip")).toHaveCount(0, { timeout: 2000 });
    await multi.hover();
    await page.waitForTimeout(150);
    await expect(page.getByRole("tooltip")).toHaveCount(0); // cold: it waits the full delay
    await expect(tooltip(page, /Select several/)).toBeVisible({ timeout: 1500 });
  });

  test("a quick trip off the dock and back (under 250ms) stays warm", async ({ page }) => {
    await open(page);
    const pick = buttonOf(page, "Pick element");
    const m = await box(buttonOf(page, "Select several elements"));
    await pick.hover();
    await expect(tooltip(page, /Pick element/)).toBeVisible({ timeout: 1500 });
    await page.waitForTimeout(500); // warm

    await page.mouse.move(600, 200);
    await page.waitForTimeout(40);
    await page.mouse.move(m.x + m.width / 2, m.y + m.height / 2); // back inside about 50ms later
    await expect(tooltip(page, /Select several/)).toBeVisible({ timeout: 200 });
  });
});
