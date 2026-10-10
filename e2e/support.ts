import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page } from "@playwright/test";
import { parse } from "../src/core/serialize";

/** Where the dev route writes (`<playground cwd>/reviews`). Gitignored. */
export const REVIEWS = fileURLToPath(new URL("../examples/playground/reviews", import.meta.url));

/** Where the Vite example's dev route writes (D14). Gitignored. */
export const VITE_REVIEWS = fileURLToPath(new URL("../examples/vite/reviews", import.meta.url));

export const cleanReviews = () => rmSync(REVIEWS, { recursive: true, force: true });

export const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export const frameOf = (page: Page) => page.frameLocator("iframe[title='App under review']");
export const composerOf = (page: Page) => page.getByRole("dialog", { name: "New entry" });

/** Show the kit on a page and wait for the dock (its 450ms entrance included). */
export async function openKit(page: Page) {
  await page.waitForFunction(() => !!window.__proompter);
  await page.evaluate(() => window.__proompter?.open());
  await expect(page.getByRole("toolbar", { name: "Proompter" })).toBeVisible();
  await expect(page.locator(".dock")).not.toHaveClass(/\bintro\b/);
}

/** Wait until a file matching `dir/<prefix>*<ext>` exists; returns its absolute path. */
export async function waitForFile(dir: () => string, prefix: string, ext: string): Promise<string> {
  let found = "";
  await expect
    .poll(
      () => {
        const d = dir();
        if (!existsSync(d)) return "";
        const hit = readdirSync(d).find((f) => f.startsWith(prefix) && f.endsWith(ext));
        found = hit ? path.join(d, hit) : "";
        return found;
      },
      { timeout: 30_000, message: `${prefix}*${ext} in ${dir()}` },
    )
    .not.toBe("");
  return found;
}

/** The one session folder under reviews/ (waits for it). */
export async function sessionDir(root = REVIEWS): Promise<string> {
  let dir = "";
  await expect
    .poll(
      () => {
        const names = existsSync(root) ? readdirSync(root).filter((n) => /^\d{4}-\d{2}-\d{2}_/.test(n)) : [];
        dir = names[0] ? path.join(root, names[0]) : "";
        return dir;
      },
      { timeout: 30_000, message: "a session folder under reviews/" },
    )
    .not.toBe("");
  return dir;
}

export const readEntry = (file: string) => parse(readFileSync(file, "utf8"));
