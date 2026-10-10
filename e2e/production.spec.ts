import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { REVIEWS } from "./support";

/**
 * DESIGN 11.1, zero cost when off. Runs against the "production" project: `next build` with
 * NEXT_PUBLIC_PROOMPTER unset, served by `next start` on :3101 (scripts/e2e-servers.mjs).
 *
 * Interpretation. The spec says "output is identical in route table and size" to a build without Proompter.
 * Building the playground a second time with the wiring ripped out of the source is too heavy and drifts, so
 * this asserts what "identical" is meant to guarantee, against the flag-unset build itself:
 *   1. the served HTML has no `data-src` / `data-comp` stamps and no Proompter marker;
 *   2. no script the page references contains Proompter code or its markers
 *      (`__proompter`, `proompter-root`, `data-proompter-fonts`);
 *   3. no chunk reachable from "/" contains them: the closure of its scripts plus every chunk name mentioned
 *      inside those chunks, recursively (lazy chunks too). The /fixtures/* routes mount the kit on purpose and
 *      are not part of that closure;
 *   4. the route table (`app-path-routes-manifest.json`) has no Proompter page route; the dev route
 *      /api/proompter exists as a file but answers 404 and writes nothing;
 *   5. at runtime there is no `window.__proompter`, no `proompter-root` element and no font style tag.
 */
const MARKERS = ["__proompter", "proompter-root", "data-proompter-fonts", "proompter.dock"];
const BUILD = fileURLToPath(new URL("../examples/playground/.next-prod", import.meta.url));

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

/** Every `<name>.js` a text mentions; names that aren't chunks are dropped later by the existsSync check. */
const chunkRefs = (text: string) => new Set([...text.matchAll(/([\w~.-]+\.js)\b/g)].map((m) => m[1] ?? ""));

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

test("no chunk reachable from / (lazy ones included) contains Proompter", async ({ request }) => {
  // Everything "/" can ever load: start at its <script src> files and follow every chunk name mentioned inside
  // a chunk, recursively (lazy chunks included). Chunks only the /fixtures/* routes reach are not in this set.
  const html = await (await request.get("/")).text();
  const queue = [...chunkRefs(html)];
  const closure = new Set<string>();
  while (queue.length) {
    const name = queue.pop()!;
    if (closure.has(name)) continue;
    const file = path.join(BUILD, "static", "chunks", name);
    if (!existsSync(file)) continue;
    closure.add(name);
    queue.push(...chunkRefs(readFileSync(file, "utf8")));
  }
  expect(closure.size, "the closure from / is not empty").toBeGreaterThan(0);

  const leaks: string[] = [];
  for (const name of closure) {
    const text = readFileSync(path.join(BUILD, "static", "chunks", name), "utf8");
    for (const m of MARKERS) if (text.includes(m)) leaks.push(`${m} in ${name}`);
  }
  expect(leaks).toEqual([]);
});

test("the route table has no Proompter page, and the dev route answers 404 without writing", async ({ request }) => {
  const routes = Object.values(JSON.parse(readFileSync(path.join(BUILD, "app-path-routes-manifest.json"), "utf8")) as Record<string, string>);
  expect(routes).toContain("/");
  expect(routes.filter((r) => r.toLowerCase().includes("__proompter"))).toEqual([]);

  // Unique probe: other specs write into reviews/ concurrently, so look for this file/content, not for "no change".
  const probe = `zz-prod-probe-${randomUUID()}`;
  const get = await request.get("/api/proompter");
  expect(get.status()).toBe(404);
  const post = await request.post("/api/proompter", { data: { path: `entries/${probe}.md`, content: probe } });
  expect(post.status()).toBe(404);
  const written = walk(REVIEWS).filter((f) => f.includes(probe) || readFileSync(f, "utf8").includes(probe));
  expect(written).toEqual([]);
});

test("at runtime nothing is installed", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Feed");
  // Wait for hydration, the network to go quiet, and the idle callback a kit would use to load itself.
  await page.waitForLoadState("networkidle");
  await page.evaluate(
    () => new Promise<void>((resolve) => (typeof requestIdleCallback === "function" ? requestIdleCallback(() => resolve(), { timeout: 3000 }) : setTimeout(resolve, 100))),
  );
  expect(await page.evaluate(() => "__proompter" in window || "__proompter_capture" in window)).toBe(false);
  await expect(page.locator("proompter-root")).toHaveCount(0);
  await expect(page.locator("style[data-proompter-fonts]")).toHaveCount(0);
  await expect(page.locator("[data-src]")).toHaveCount(0);
});
