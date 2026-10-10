import path from "node:path";
import { expect, test } from "@playwright/test";
import { cleanReviews, composerOf, frameOf, readEntry, sessionDir, waitForFile } from "./support";

/**
 * DESIGN D8: picking the post card's avatar with the keyboard alone, on Responsive (the live page) and on Mobile
 * (a device frame). No mouse is used after `goto`.
 *
 * Path, from the start target (`main`): ↓ (the header row) → → (compose card) → → (post card) → ↓ (post header)
 * → ↓ (the avatar) → Enter. The playground's markup is in examples/playground/components/feed.tsx.
 */
test.describe.configure({ mode: "serial" });
test.use({ viewport: { width: 1440, height: 900 } });
test.setTimeout(120_000);

test.beforeEach(cleanReviews);
test.afterEach(cleanReviews);

const SOURCE = /examples\/playground\/components\/avatar\.tsx:\d+:\d+$/;

for (const [name, id] of [
  ["Responsive", "responsive"],
  ["Mobile", "mobile"],
] as const) {
  test(`D8: P, arrows, Enter, ⌘↵ files the avatar from the keyboard alone on ${name}`, async ({ page }) => {
    await page.goto("/");
    await page.waitForFunction(() => !!window.__proompter);
    await page.keyboard.press("ControlOrMeta+Shift+."); // show the kit
    await expect(page.getByRole("toolbar", { name: "Proompter" })).toBeVisible();
    await expect(page.locator(".dock")).not.toHaveClass(/\bintro\b/);
    if (id === "mobile") {
      await page.keyboard.press("4");
      await expect(page.getByRole("radio", { name: "Mobile", exact: true })).toBeChecked();
      await expect(frameOf(page).getByTestId("post-avatar")).toBeVisible();
    }

    const press = (...keys: string[]) => keys.reduce((p, k) => p.then(() => page.keyboard.press(k)), Promise.resolve());
    const announced = page.locator(".pm-sr");

    await page.keyboard.press("p");
    await expect(page.locator(".pm-hlab")).toBeVisible(); // the start target (main) is already shown
    await press("ArrowDown", "ArrowRight", "ArrowRight", "ArrowDown", "ArrowDown");
    await expect(page.locator(".pm-hlab")).toContainText("avatar.tsx");
    await expect(announced).toContainText("avatar.tsx"); // the live region says what the box is on

    await page.keyboard.press("Enter");
    const composer = composerOf(page);
    await expect(composer).toBeVisible();
    await expect(composer.getByLabel("Title")).toBeFocused();
    await page.keyboard.type(`Avatar via keyboard on ${id}`);
    await page.keyboard.press("ControlOrMeta+Enter");
    await expect(composer).toBeHidden();

    const session = await sessionDir();
    const entry = readEntry(await waitForFile(() => path.join(session, "entries"), "001-", ".md"));
    expect(entry.kind).toBe("element");
    expect(entry.viewport).toBe(id);
    expect(entry.title).toBe(`Avatar via keyboard on ${id}`);
    expect(entry.target?.source).toMatch(SOURCE);
    expect(entry.target?.sourceInherited).toBe(false);
    const selector = entry.target?.selector ?? "";
    const scope = id === "mobile" ? frameOf(page) : page;
    await expect(scope.locator(selector)).toHaveCount(1);
    await expect(scope.locator(selector)).toHaveAttribute("data-testid", "post-avatar");
  });
}
