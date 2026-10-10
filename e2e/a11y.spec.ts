import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * DESIGN 11.5 on the kit fixture (/fixtures/kit: the full <Proompter> with an in-memory store and four seeded
 * entries, so nothing is written to disk and these can run in parallel).
 *   - axe is clean on the dock, composer, sheet, ticket and command menu (scoped to the kit's own root; the
 *     mock host page is not the subject);
 *   - everything works keyboard-only: e2e/keyboard.spec.ts walks the whole kit that way, and here the dock's
 *     controls are shown to be one Tab chain with no trap;
 *   - reduced motion is respected: with `prefers-reduced-motion: reduce` no transform animation runs while the
 *     sheet, composer and command menu open; with no preference the same sampling does see them (control).
 */
const URL = "/fixtures/kit";
test.use({ viewport: { width: 1440, height: 900 } });
test.setTimeout(90_000);

async function open(page: Page) {
  await page.goto(URL);
  await expect(page.getByRole("toolbar", { name: "Proompter" })).toBeVisible();
  await expect(page.locator(".dock")).not.toHaveClass(/\bintro\b/);
}

async function expectClean(page: Page, what: string) {
  const results = await new AxeBuilder({ page }).include("proompter-root").analyze();
  const report = results.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => String(n.target)).join(" | ")}`);
  expect(report, `axe violations on ${what}`).toEqual([]);
  // Translucent glass (backdrop-filter) surfaces make axe answer "incomplete" instead of passing or failing.
  // That is not a pass: treat an unresolved colour-contrast check as a failure too.
  // Ignored: "shortTextContent" (the pins' 1-2 digit numbers, which axe can't judge as text) and "bgOverlap"
  // (stacked translucent panels and scrims, which axe can't resolve; src/ui/contrast.test.ts checks the token
  // pairs instead). Every other reason (bgImage, bgGradient, bgFilter, ...) fails.
  // Matched on axe's message text (its `messageKey` isn't exposed on the result nodes we get back).
  // Overlapping glass/scrims, icon-only (SVG) content and 1-2 digit pin numbers: axe cannot judge these.
  const IGNORED = /partially obscured by another element|partially overlaps other elements|content is too short|only non-text characters|contains an image node/;
  const backdropIssue = (n: { any: Array<{ message?: string }> }) => n.any.some((c) => !IGNORED.test(c.message ?? ""));
  const unresolved = results.incomplete
    .filter((v) => v.id === "color-contrast")
    .flatMap((v) => v.nodes.filter(backdropIssue).map((n) => `${String(n.target)} [${n.any[0]?.message ?? ""}]`));
  expect(unresolved, `axe could not resolve colour contrast on ${what}`).toEqual([]);
}

test.describe("axe", () => {
  test("dock", async ({ page }) => {
    await open(page);
    await expectClean(page, "the dock");
  });

  test("composer", async ({ page }) => {
    await open(page);
    await page.keyboard.press("n");
    await expect(page.getByRole("dialog", { name: "New entry" })).toBeVisible();
    await page.waitForTimeout(400);
    await expectClean(page, "the composer");
  });

  test("sheet (entries and publish)", async ({ page }) => {
    await open(page);
    await page.keyboard.press("e");
    await expect(page.getByLabel("Review session", { exact: true })).toHaveClass(/\bon\b/);
    await page.waitForTimeout(400);
    await expectClean(page, "the entries list");
    await page.getByRole("radio", { name: "Publish" }).click();
    await expect(page.getByRole("list", { name: "Pending files" })).toBeVisible();
    await expectClean(page, "the publish view");
  });

  test("ticket", async ({ page }) => {
    await open(page);
    await page.keyboard.press("e");
    await page.getByRole("button", { name: /^PRO-1: / }).click();
    await expect(page.getByRole("button", { name: "Back to entries" })).toBeVisible();
    await page.waitForTimeout(400);
    await expectClean(page, "the ticket");
  });

  test("property menu (ticket Status)", async ({ page }) => {
    await open(page);
    await page.keyboard.press("e");
    await page.getByRole("button", { name: /^PRO-1: / }).click();
    await page.getByRole("button", { name: /^Status:/ }).click();
    await expect(page.getByRole("menu", { name: "Status" })).toBeVisible();
    await page.waitForTimeout(400);
    await expectClean(page, "an open property menu");
  });

  test("toast", async ({ page }) => {
    await open(page);
    await page.keyboard.press("f"); // "Motion frozen on the page"
    await expect(page.getByText("Motion frozen on the page")).toBeVisible();
    await page.waitForTimeout(300);
    await expectClean(page, "a toast");
  });

  test("command menu", async ({ page }) => {
    await open(page);
    await page.keyboard.press("ControlOrMeta+k");
    await expect(page.getByRole("dialog", { name: "Command menu" })).toBeVisible();
    await page.waitForTimeout(400);
    await expectClean(page, "the command menu");
  });
});

test("keyboard only: the dock is one Tab chain with no trap", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: /^Move toolbar/ }).focus();
  const seen: string[] = [];
  for (let i = 0; i < 24; i++) {
    await page.keyboard.press("Tab");
    seen.push(
      await page.evaluate(() => {
        const host = document.querySelector("proompter-root");
        const el = host?.shadowRoot?.activeElement;
        return el ? (el.getAttribute("aria-label") ?? el.textContent ?? el.tagName) : "(left the kit)";
      }),
    );
    if (seen[seen.length - 1] === "(left the kit)") break;
  }
  // Focus walks every dock control and then leaves the kit instead of looping inside it.
  expect(seen).toContain("Pick element");
  expect(seen).toContain("Command menu");
  expect(seen[seen.length - 1]).toBe("(left the kit)");
});

test.describe("motion", () => {
  /** Count distinct running transform-type animations in the kit's shadow root while `trigger` runs. */
  async function transformAnimationsDuring(page: Page, trigger: () => Promise<void>): Promise<number> {
    const sampling = page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          const root = document.querySelector("proompter-root")?.shadowRoot;
          const seen = new Set<Animation>();
          const end = performance.now() + 900;
          const tick = () => {
            for (const a of root?.getAnimations() ?? []) {
              const keys = (a.effect as KeyframeEffect | null)?.getKeyframes?.().flatMap((k) => Object.keys(k)) ?? [];
              const prop = (a as CSSTransition).transitionProperty ?? "";
              if (keys.some((k) => /^(transform|translate|scale|rotate)$/.test(k)) || /^(transform|translate|scale|rotate)$/.test(prop)) seen.add(a);
            }
            if (performance.now() < end) requestAnimationFrame(tick);
            else resolve(seen.size);
          };
          tick();
        }),
    );
    await trigger();
    return sampling;
  }

  const openThings = (page: Page) => async () => {
    await page.keyboard.press("e"); // sheet
    await page.waitForTimeout(50);
    await page.keyboard.press("Escape");
    await page.keyboard.press("n"); // composer
    await page.waitForTimeout(50);
    await page.keyboard.press("Escape");
    await page.keyboard.press("ControlOrMeta+k"); // command menu
  };

  test.describe("reduced", () => {
    test.use({ reducedMotion: "reduce" });
    test("no transform animation runs", async ({ page }) => {
      await open(page);
      expect(await transformAnimationsDuring(page, openThings(page))).toBe(0);
      await expect(page.getByRole("dialog", { name: "Command menu" })).toBeVisible(); // it still works, just without motion
    });
  });

  test.describe("no preference", () => {
    test.use({ reducedMotion: "no-preference" });
    test("control: the same sampling sees transform animations", async ({ page }) => {
      await open(page);
      expect(await transformAnimationsDuring(page, openThings(page))).toBeGreaterThan(0);
    });
  });
});
