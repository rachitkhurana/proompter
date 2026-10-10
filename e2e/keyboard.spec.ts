import { expect, test, type Page } from "@playwright/test";

// Fixture route: examples/playground/app/fixtures/kit (the full <Proompter>, open, with an in-memory store
// seeded with four entries and a bare composer). Everything below is done from the keyboard.
const URL = "/fixtures/kit";

test.use({ viewport: { width: 1200, height: 800 } });
test.setTimeout(90_000); // the first hit compiles the route (and the lazy UI chunk) in `next dev`

const sheet = (page: Page) => page.getByLabel("Review session", { exact: true });
const palette = (page: Page) => page.getByRole("dialog", { name: "Command menu" });
const search = (page: Page) => page.getByRole("combobox", { name: "Search" });
const composer = (page: Page) => page.getByRole("dialog", { name: "New entry" });
const tool = (page: Page, name: string) => page.getByRole("button", { name, exact: true });

async function open(page: Page) {
  await page.goto(URL);
  const dock = page.getByRole("toolbar", { name: "Proompter" });
  await expect(dock).toBeVisible();
  await expect(page.locator(".dock")).not.toHaveClass(/\bintro\b/); // the 450ms entrance is over
}

async function sheetIsOpen(page: Page, on = true) {
  if (on) await expect(sheet(page)).toHaveClass(/\bon\b/);
  else await expect(sheet(page)).not.toHaveClass(/\bon\b/);
}

test.describe("keyboard only", () => {
  test("⌘K finds an entry, opens its ticket, edits it from menus, and Esc unwinds one layer at a time", async ({ page }) => {
    await open(page);

    await page.keyboard.press("ControlOrMeta+k");
    await expect(palette(page)).toBeVisible();
    await expect(search(page)).toBeFocused();
    await page.keyboard.type("squad");
    await expect(page.getByRole("option")).toHaveCount(1);
    await expect(page.getByRole("option", { name: /Standings show the squad ID/ })).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Enter");

    // The ticket for PRO-1 is open in the sheet and the palette is gone.
    await expect(palette(page)).toBeHidden();
    await sheetIsOpen(page);
    await expect(page.getByRole("heading", { name: /Standings show the squad ID/ })).toBeVisible();

    // Focus moved into the sheet: Tab reaches its first control.
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Back to entries" })).toBeFocused();

    // Status: open the menu with the keyboard, move, choose.
    const status = page.getByRole("button", { name: /^Status:/ });
    await status.focus();
    await page.keyboard.press("Enter");
    const menu = page.getByRole("menu", { name: "Status" });
    await expect(menu).toBeVisible();
    await expect(page.getByRole("menuitemradio", { name: "Open" })).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("menuitemradio", { name: "In progress" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(menu).toBeHidden();
    await expect(page.getByRole("button", { name: "Status: In progress" })).toBeVisible();
    await expect(page.getByText("status: open → progress")).toBeVisible();

    // Tags: a multi-select menu stays open while choosing; Esc closes the menu, not the ticket.
    await page.getByRole("button", { name: /^Tags:/ }).focus();
    await page.keyboard.press("ArrowDown");
    const tags = page.getByRole("menu", { name: "Tags" });
    await expect(tags).toBeVisible();
    await page.keyboard.press("Enter"); // "ui"
    await expect(tags).toBeVisible();
    await expect(page.getByRole("menuitemcheckbox", { name: "ui" })).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("Escape");
    await expect(tags).toBeHidden();
    await expect(page.getByRole("heading", { name: /Standings show the squad ID/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Tags: .*ui/ })).toBeVisible();

    // Resolve from the footer.
    await page.getByRole("button", { name: "Resolve", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: "Reopen", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Status: Resolved/ })).toBeVisible();

    // Esc: ticket -> list -> closed.
    await page.keyboard.press("Escape");
    await expect(page.getByRole("heading", { name: /Standings show the squad ID/ })).toBeHidden();
    await expect(sheet(page).getByRole("button", { name: /^PRO-1: / })).toBeFocused(); // back on the row we came from
    await sheetIsOpen(page);
    await page.keyboard.press("Escape");
    await sheetIsOpen(page, false);
  });

  test("E toggles the entries list, grouped, and Up/Down walk the rows", async ({ page }) => {
    await open(page);
    await page.keyboard.press("e");
    await sheetIsOpen(page);
    await expect(page.getByRole("region", { name: "Open" })).toBeVisible();
    await expect(page.getByRole("region", { name: "In progress" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Resolved" })).toBeVisible();

    await sheet(page).getByRole("button", { name: /^PRO-3: / }).focus();
    await page.keyboard.press("ArrowDown");
    await expect(sheet(page).getByRole("button", { name: /^PRO-1: / })).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(sheet(page).getByRole("button", { name: /^PRO-3: / })).toBeFocused();

    // Tab to the Publish view, which lists files and marks GitHub issues as v2.
    await page.getByRole("radio", { name: "Publish" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("list", { name: "Pending files" })).toContainText("~ session.md");
    await expect(page.getByRole("button", { name: /^Write 9 files$/ })).toBeVisible();
    await expect(page.locator("#pm-pub-issues")).toContainText("v2");

    await page.keyboard.press("e");
    await sheetIsOpen(page, false);
    // Closed means out of reach: the sheet's controls are inert.
    await expect(page.getByRole("radio", { name: "Publish" })).toBeHidden();
  });

  test("N opens the composer, Esc discards it, ⌘↵ creates an entry", async ({ page }) => {
    await open(page);
    await page.keyboard.press("n");
    await expect(composer(page)).toBeVisible();
    await expect(composer(page).getByLabel("Title")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(composer(page)).toBeHidden();

    await page.keyboard.press("n");
    await expect(composer(page).getByLabel("Title")).toBeFocused();
    // Letter shortcuts stay out of the way while typing ("e", "p", "1" are all shortcuts).
    await page.keyboard.type("Footer e-p-1 overlaps the CTA");
    await expect(composer(page).getByLabel("Title")).toHaveValue("Footer e-p-1 overlaps the CTA");
    await expect(sheet(page)).not.toHaveClass(/\bon\b/);
    await page.keyboard.press("ControlOrMeta+Enter");
    await expect(composer(page)).toBeHidden();
    await expect(page.getByText(/PRO-5 saved on responsive/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Entries, 4 open" })).toBeVisible();

    await page.keyboard.press("e");
    await expect(sheet(page).getByRole("button", { name: /^PRO-5: Footer e-p-1 overlaps the CTA/ })).toBeVisible();
  });

  test("tools, viewports and rotate from the keyboard; Esc leaves the mode before anything under it", async ({ page }) => {
    await open(page);
    await page.keyboard.press("p");
    await expect(tool(page, "Pick element")).toHaveAttribute("aria-pressed", "true");

    await page.keyboard.press("ControlOrMeta+k");
    await expect(palette(page)).toBeVisible();
    await page.keyboard.press("Escape"); // the command menu first
    await expect(palette(page)).toBeHidden();
    await expect(tool(page, "Pick element")).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Escape"); // then the mode
    await expect(tool(page, "Pick element")).toHaveAttribute("aria-pressed", "false");

    await page.keyboard.press("m");
    await expect(tool(page, "Select several elements")).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("m");
    await expect(tool(page, "Select several elements")).toHaveAttribute("aria-pressed", "false");

    await page.keyboard.press("4");
    await expect(page.getByRole("radio", { name: "Mobile" })).toBeChecked();
    await expect(page.locator("iframe[title='App under review']")).toBeVisible();
    await expect(page.locator(".pm-devcap")).toContainText("390×844");
    await page.keyboard.press("r");
    await expect(page.locator(".pm-devcap")).toContainText("844×390");
    await expect(tool(page, "Rotate device")).toHaveAttribute("aria-pressed", "true");

    // The framed page runs without a kit of its own, but exposes its capture to the parent.
    await expect
      .poll(async () => {
        const frame = page.frames().find((f) => f.url().includes("__proompter_frame=1"));
        return frame ? await frame.evaluate(() => !!window.__proompter_capture && !window.__proompter) : false;
      })
      .toBe(true);

    await page.keyboard.press("1");
    await expect(page.locator("iframe[title='App under review']")).toHaveCount(0);
    await expect(page.getByRole("radio", { name: "Responsive" })).toBeChecked();
  });

  test("keys pressed inside the device frame reach the kit", async ({ page }) => {
    await open(page);
    await page.keyboard.press("2");
    const frame = page.frameLocator("iframe[title='App under review']");
    await expect(frame.getByRole("heading", { name: "Kit fixture" })).toBeVisible();
    await frame.locator("body").click({ position: { x: 4, y: 4 } }); // focus lands in the frame
    await page.keyboard.press("p");
    await expect(tool(page, "Pick element")).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Escape"); // leaves the mode, though the focus is in the frame
    await expect(tool(page, "Pick element")).toHaveAttribute("aria-pressed", "false");
    await page.keyboard.press("e");
    await sheetIsOpen(page);
    await page.keyboard.press("Escape");
    await sheetIsOpen(page, false);
  });

  test("Show on page switches to the viewport the entry was filed on, then pulses its pin", async ({ page }) => {
    await open(page);
    await page.keyboard.press("e");
    await sheet(page).getByRole("button", { name: /^PRO-4: / }).focus();
    await page.keyboard.press("Enter");
    // PRO-4 has no snapshot: the ticket offers "Show on mobile".
    const show = page.getByRole("button", { name: "Show on mobile" });
    await expect(show).toBeVisible();
    await show.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("radio", { name: "Mobile" })).toBeChecked();
    await expect(page.getByText("Switched to mobile, where PRO-4 was filed")).toBeVisible();
    await expect(page.locator(".pm-pin[data-id='4']")).toBeAttached({ timeout: 30_000 });
    await expect(page.locator(".pm-pin[data-id='4'] .pm-pin-ring")).toBeAttached({ timeout: 10_000 });
  });

  test("the dock is a toolbar you can Tab through, and its tools respond to Enter", async ({ page }) => {
    await open(page);
    await page.getByRole("button", { name: /^Move toolbar/ }).focus();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: /^Collapse toolbar/ })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(tool(page, "Pick element")).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(tool(page, "Pick element")).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Enter");
    await expect(tool(page, "Pick element")).toHaveAttribute("aria-pressed", "false");
    await page.getByRole("button", { name: "Command menu", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(palette(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(palette(page)).toBeHidden();
    await expect(page.getByRole("button", { name: "Command menu", exact: true })).toBeFocused(); // focus came back
  });

  test("⌘⇧. hides and shows the kit, and window.__proompter does the same", async ({ page }) => {
    await open(page);
    await page.keyboard.press("ControlOrMeta+Shift+.");
    await expect(page.getByRole("toolbar", { name: "Proompter" })).toHaveCount(0);
    await expect(page.locator("proompter-root")).toHaveCount(0);
    await page.keyboard.press("ControlOrMeta+Shift+.");
    await expect(page.getByRole("toolbar", { name: "Proompter" })).toBeVisible();
    await page.evaluate(() => window.__proompter?.close());
    await expect(page.locator("proompter-root")).toHaveCount(0);
    await page.evaluate(() => window.__proompter?.toggle());
    await expect(page.getByRole("toolbar", { name: "Proompter" })).toBeVisible();
    expect(await page.evaluate(() => window.__proompter?.entries().length)).toBe(4);
  });
});
