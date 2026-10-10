import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

/**
 * DESIGN 11.1, zero cost when off. Runs against the "production" project: `next build` with
 * NEXT_PUBLIC_PROOMPTER unset, served by `next start` on :3101 (scripts/e2e-servers.mjs).
 *
 * Interpretation. The spec says "output is identical in route table and size" to a build without Proompter.
 * Building the playground a second time with the wiring ripped out of the source is too heavy and drifts, so
 * this asserts what "identical" is meant to guarantee, against the flag-unset build itself:
 *   1. the served HTML has no `data-src` / `data-comp` stamps and no Proompter marker;
 *   2. no script the page references, followed one hop, contains Proompter code or its markers
 *      (`__proompter`, `proompter-root`, `data-proompter-fonts`);
 *   3. the route table (`app-path-routes-manifest.json`) has no Proompter page route, only the playground's own;
 *      the dev route /api/proompter exists as a file but answers 404 and writes nothing;
 *   4. at runtime there is no `window.__proompter`, no `proompter-root` element and no font style tag.
 * The /fixtures/* routes do import the kit; they are separate pages and never referenced from "/".
 */
const MARKERS = ["__proompter", "proompter-root", "data-proompter-fonts", "proompter.dock"];

test("the HTML carries no data-src, data-comp or Proompter marker", async ({ request }) => {
  const html = await (await request.get("/")).text();
  expect(html).toContain("Valorant Night Cup"); // the real page, not an error shell
  expect(html).not.toContain("data-src");
  expect(html).not.toContain("data-comp");
  for (const m of MARKERS) expect(html, m).not.toContain(m);
});

test("no script the page references contains Proompter", async ({ request, baseURL }) => {
  const html = await (await request.get("/")).text();
  const srcs = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1] ?? "");
  expect(srcs.length).toBeGreaterThan(0);
  for (const src of srcs) {
    const body = await (await request.get(new URL(src, baseURL).toString())).text();
    for (const m of MARKERS) expect(body, `${m} in ${src}`).not.toContain(m);
  }
});

test("the route table has no Proompter page, and the dev route answers 404", async ({ request }) => {
  const manifestPath = fileURLToPath(
    new URL("../examples/playground/.next-prod/app-path-routes-manifest.json", import.meta.url),
  );
  const routes = Object.values(JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, string>);
  expect(routes).toContain("/");
  expect(routes.filter((r) => r.toLowerCase().includes("__proompter"))).toEqual([]);

  const get = await request.get("/api/proompter");
  expect(get.status()).toBe(404);
  const post = await request.post("/api/proompter", { data: { path: "entries/001-x.md", content: "x" } });
  expect(post.status()).toBe(404);
});

test("at runtime nothing is installed", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Feed");
  await page.waitForTimeout(1500); // past the idle-callback window a kit would use to load
  expect(await page.evaluate(() => "__proompter" in window || "__proompter_capture" in window)).toBe(false);
  await expect(page.locator("proompter-root")).toHaveCount(0);
  await expect(page.locator("style[data-proompter-fonts]")).toHaveCount(0);
  await expect(page.locator("[data-src]")).toHaveCount(0);
});
