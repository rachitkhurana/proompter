import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { parse } from "../src/core/serialize";
import { cleanReviews, composerOf, openKit } from "./support";

/**
 * DESIGN D16, GitHub sync. The playground mounts the real route at /api/proompter/github (fixture page:
 * /fixtures/github) with `api` pointed at the fake GitHub that scripts/e2e-servers.mjs serves on BASE+5.
 * The real GitHub is never called.
 */
test.describe.configure({ mode: "serial" });
test.use({ viewport: { width: 1440, height: 900 } });
test.setTimeout(120_000); // the first hit compiles the page and the lazy UI chunk in `next dev`

const FAKE = `http://127.0.0.1:${Number(process.env.E2E_PORT_BASE ?? 3100) + 5}`;
const TOKEN = "ghp_e2e_fake_token"; // the fake accepts only this one; the route holds it, the browser never does
const KEY = "e2e-review-key-0123456789";
const TITLE = "Card needs more padding";

interface FakeState {
  files: Record<string, Record<string, string>>;
  issues: { number: number; title: string; body: string; state: string; labels: { name: string }[] }[];
  labels: string[];
}
const state = async (request: APIRequestContext) => (await (await request.get(`${FAKE}/__state`)).json()) as FakeState;

test.beforeEach(async ({ request }) => {
  cleanReviews();
  await request.post(`${FAKE}/__reset`);
});
test.afterEach(cleanReviews);

async function fileEntry(page: Page) {
  await page.goto("/fixtures/github");
  await openKit(page);
  await page.getByRole("button", { name: "Pick element", exact: true }).click();
  const card = page.getByTestId("card");
  await card.hover();
  await expect(page.locator(".pm-hlab")).toBeVisible();
  await card.click();
  const composer = composerOf(page);
  await expect(composer).toBeVisible();
  await composer.getByLabel("Title").fill(TITLE);
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(composer).toBeHidden();
  await expect(page.locator(".pm-comp")).toHaveCount(0);
}

const openPublish = async (page: Page) => {
  await page.getByRole("radio", { name: "Publish" }).click();
  await expect(page.getByRole("button", { name: "Sync to GitHub" })).toBeVisible();
};
const status = (page: Page) => page.locator(".pub [role=status]");

test("files an entry, asks for the key once, and syncs it: files on the reviews branch and an issue", async ({ page, request }) => {
  await fileEntry(page);
  await page.keyboard.press("e");
  await openPublish(page);

  // No key yet: the route answers 401 and the panel asks for it.
  await page.getByRole("button", { name: "Sync to GitHub" }).click();
  await expect(status(page)).toHaveText("Enter the review key to sync with GitHub");
  await page.getByLabel("Review key").fill("wrong-key");
  await page.getByRole("button", { name: "Save and sync" }).click();
  await expect(page.getByLabel("Review key")).toBeVisible(); // still refused
  await page.getByLabel("Review key").fill(KEY);
  await page.getByRole("button", { name: "Save and sync" }).click();
  await expect(status(page)).toHaveText("Synced 1 entry");
  await expect(page.getByLabel("Review key")).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("proompter:review-key"))).toBe(KEY);

  const s = await state(request);
  expect(s.issues).toHaveLength(1);
  expect(s.issues[0]).toMatchObject({ number: 1, title: `PRO-1: ${TITLE}`, state: "open" });
  expect(s.issues[0]?.labels.map((l) => l.name)).toEqual(["proompter", "kind:element", "priority:important"]);
  expect(s.issues[0]?.body).toMatch(/!\[element\]\(https:\/\/github\.com\/acme\/reviews\/blob\/reviews\/[^)]+\/assets\/001-responsive\.png\?raw=true\)/);
  const branch = Object.keys(s.files.reviews ?? {}).filter((f) => f.startsWith("reviews/"));
  expect(branch.some((f) => /^reviews\/[^/]+\/session\.md$/.test(f))).toBe(true);
  expect(branch.some((f) => /\/entries\/001-card-needs-more-padding\.md$/.test(f))).toBe(true);
  expect(branch.some((f) => /\/assets\/001-responsive(-full)?\.png$/.test(f))).toBe(true);
  const md = Buffer.from(s.files.reviews?.[branch.find((f) => f.endsWith("padding.md")) ?? ""] ?? "", "base64").toString("utf8");
  expect(parse(md)).toMatchObject({ id: "PRO-1", issue: "1", kind: "element", title: TITLE });

  // The row links to the issue.
  const link = page.locator(".ilist a");
  await expect(link).toHaveText("#1");
  await expect(link).toHaveAttribute("href", "https://github.com/acme/reviews/issues/1");
  await expect(status(page)).toHaveText("Synced 1 entry");

  // Visual baseline: the Publish tab's GitHub section, synced.
  await page.waitForTimeout(500);
  await expect(page.locator("section[aria-labelledby='pm-pub-issues']")).toHaveScreenshot("publish-github-synced.png", {
    animations: "disabled",
    caret: "hide",
    maxDiffPixelRatio: 0.01,
  });

  // A second sync sends nothing new: no extra file writes and no second issue.
  const writes = (await state(request)).issues.length;
  await page.getByRole("button", { name: "Sync to GitHub" }).click();
  await expect(status(page)).toHaveText("Everything is synced.");
  expect((await state(request)).issues).toHaveLength(writes);
});

test("an issue closed on GitHub marks the entry resolved on the next sync", async ({ page, request }) => {
  await page.addInitScript((k) => localStorage.setItem("proompter:review-key", k), KEY);
  await fileEntry(page);
  await page.keyboard.press("e");
  await openPublish(page);
  await page.getByRole("button", { name: "Sync to GitHub" }).click();
  await expect(status(page)).toHaveText("Synced 1 entry");
  expect(await page.evaluate(() => window.__proompter?.entries()[0]?.status)).toBe("open");

  // Close it on GitHub, through the fake's HTTP API.
  const closed = await request.patch(`${FAKE}/repos/acme/reviews/issues/1`, {
    headers: { authorization: `Bearer ${TOKEN}` },
    data: { state: "closed" },
  });
  expect(closed.ok()).toBe(true);

  await page.getByRole("button", { name: "Sync to GitHub" }).click();
  await expect(status(page)).toHaveText("Synced 1 entry, 1 resolved from GitHub");
  const entry = await page.evaluate(() => window.__proompter?.entries()[0]);
  expect(entry?.status).toBe("resolved");
  expect(entry?.activity.some((a) => a.who === "github")).toBe(true);
  expect((await state(request)).issues[0]?.state).toBe("closed");
});

test("two reviewers on the same day: each browser's PRO-1 is its own issue and folder, nothing overwritten", async ({ browser, request }) => {
  const sessions: string[] = [];
  for (let i = 0; i < 2; i++) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    await page.addInitScript((k) => localStorage.setItem("proompter:review-key", k), KEY);
    await fileEntry(page);
    await page.keyboard.press("e");
    await openPublish(page);
    await page.getByRole("button", { name: "Sync to GitHub" }).click();
    await expect(status(page)).toHaveText("Synced 1 entry"); // not "resolved from GitHub", not a 409
    sessions.push(await page.evaluate(() => window.__proompter!.entries()[0]!.session));
    await context.close();
  }
  expect(sessions[0]).not.toBe(sessions[1]);
  for (const sid of sessions) expect(sid).toMatch(/^\d{4}-\d{2}-\d{2}_github-sync-[a-z0-9]{6}$/);
  const s = await state(request);
  expect(s.issues.map((i) => i.number)).toEqual([1, 2]);
  const sessionFiles = Object.keys(s.files.reviews ?? {}).filter((f) => f.endsWith("/session.md"));
  expect(sessionFiles.sort()).toEqual(sessions.map((sid) => `reviews/${sid}/session.md`).sort());
});

test("the GitHub token and route code never reach the client bundle", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const secrets = ["PROOMPTER_GITHUB_TOKEN", "PROOMPTER_REVIEW_KEY", TOKEN, "createGithubRoute", "api.github.com"];
  const walk = (dir: string): string[] =>
    existsSync(dir) ? readdirSync(dir).flatMap((n) => (statSync(path.join(dir, n)).isDirectory() ? walk(path.join(dir, n)) : [path.join(dir, n)])) : [];

  // The route is server code: it does contain the variable names (so this check cannot pass vacuously).
  const server = readFileSync(path.join(root, "dist/github/index.js"), "utf8");
  expect(server).toContain("PROOMPTER_GITHUB_TOKEN");

  // The browser entry and its chunks (everything in dist/ except the server entries).
  const client = walk(path.join(root, "dist")).filter(
    (f) => /\.c?js$/.test(f) && !/dist\/(github|next|vite)\//.test(f.split(path.sep).join("/")),
  );
  expect(client.some((f) => f.endsWith("dist/index.js"))).toBe(true);
  // What the Next builds ship to the browser.
  const apps = ["examples/playground/.next-preview/static", "examples/playground/.next-prod/static", "examples/playground/.next/static"];
  const browser = [...client, ...apps.flatMap((a) => walk(path.join(root, a)).filter((f) => /\.js$/.test(f)))];
  expect(browser.length).toBeGreaterThan(5);
  const leaks: string[] = [];
  for (const file of browser) {
    const text = readFileSync(file, "utf8");
    for (const s of secrets) if (text.includes(s)) leaks.push(`${path.relative(root, file)}: ${s}`);
  }
  expect(leaks).toEqual([]);
});
