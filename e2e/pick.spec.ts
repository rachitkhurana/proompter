import { expect, test, type Page } from "@playwright/test";

/**
 * T04: pick an avatar inside a card, on Responsive (the live page) and on Mobile (a scaled iframe).
 *
 * The playground has no mock page yet (T10 ports it), so this runs against T04's own fixture route,
 * `examples/playground/app/fixtures/pick/page.tsx`: two identical hand-stamped cards plus a small harness that
 * mounts the pick engine, overlay and viewport stage from the package source. When T08's root component lands,
 * switch the spec to the real kit and the real dock.
 */

const FIXTURE = "/fixtures/pick";
const FRAME = 'iframe[title="App under review"]';

interface Picked {
  kind: string;
  viewport: string;
  source: string | null;
  inherited: boolean;
  selector: string;
  label: string;
  crumb: string;
}

async function picked(page: Page): Promise<Picked> {
  const out = page.getByTestId("pp-picked");
  await expect(out).not.toHaveText("");
  return JSON.parse((await out.textContent()) ?? "{}") as Picked;
}

const pickButton = (page: Page) => page.getByRole("button", { name: "Pick", exact: true });

test("picks an avatar inside a card on Responsive", async ({ page }) => {
  await page.goto(FIXTURE);
  await pickButton(page).click();

  const avatar = page.getByTestId("avatar-2");
  await avatar.hover();

  // The label names the element and its source; the box sits on the avatar.
  const label = page.locator(".pm-hlab");
  await expect(label).toContainText("img · avatar");
  await expect(label).toContainText("page.tsx:24:11");
  const box = (await avatar.boundingBox())!;
  const hov = page.locator(".pm-hov");
  await expect(hov).toHaveClass(/\bon\b/);
  await expect.poll(async () => Math.round((await hov.boundingBox())!.x)).toBe(Math.round(box.x));
  await expect.poll(async () => Math.round((await hov.boundingBox())!.width)).toBe(Math.round(box.width));

  await avatar.click();
  const p = await picked(page);
  expect(p).toMatchObject({ kind: "element", viewport: "responsive", inherited: false, label: "img · avatar" });
  expect(p.source).toMatch(/pick\/page\.tsx:24:11$/);
  expect(p.crumb).toBe("PickFixture › PostCard › Avatar › img · avatar");

  // Two cards share every data-src, so the selector has to count: it must hit the second card's avatar, only.
  expect(p.selector).toContain("article:nth-of-type(2)");
  await expect(page.locator(p.selector)).toHaveCount(1);
  await expect(page.locator(p.selector)).toHaveAttribute("data-testid", "avatar-2");
});

test("picks an avatar inside a card on Mobile", async ({ page }) => {
  await page.goto(FIXTURE);
  await page.getByRole("button", { name: "Mobile", exact: true }).click();

  // Device modes frame the same page with the frame flag; the kit renders nothing inside it.
  await expect(page.locator(FRAME)).toHaveAttribute("src", /__proompter_frame=1/);
  const frame = page.frameLocator(FRAME);
  await expect(frame.getByTestId("avatar-2")).toBeVisible();
  await expect(frame.locator("proompter-root")).toHaveCount(0);

  await pickButton(page).click();
  const avatar = frame.getByTestId("avatar-2");
  await avatar.hover();

  const label = page.locator(".pm-hlab");
  await expect(label).toContainText("img · avatar");

  // The hover box is projected through the frame's scale: it lands on the avatar as painted on screen.
  const box = (await avatar.boundingBox())!;
  const hov = page.locator(".pm-hov");
  await expect.poll(async () => Math.round((await hov.boundingBox())!.x)).toBe(Math.round(box.x));
  await expect.poll(async () => Math.round((await hov.boundingBox())!.y)).toBe(Math.round(box.y));
  await expect.poll(async () => Math.round((await hov.boundingBox())!.width)).toBe(Math.round(box.width));
  expect(box.width).toBeLessThan(40); // scaled down from the 40px avatar

  await avatar.click();
  const p = await picked(page);
  expect(p).toMatchObject({ kind: "element", viewport: "mobile", inherited: false, label: "img · avatar" });
  expect(p.source).toMatch(/pick\/page\.tsx:24:11$/);
  expect(p.selector).toContain("article:nth-of-type(2)");
  // The selector re-resolves inside the frame to the same element.
  await expect(frame.locator(p.selector)).toHaveCount(1);
  await expect(frame.locator(p.selector)).toHaveAttribute("data-testid", "avatar-2");
});
