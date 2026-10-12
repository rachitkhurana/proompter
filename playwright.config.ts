import { defineConfig, devices } from "@playwright/test";

// E2E_PORT_BASE (default 3100) lets two checkouts run e2e at once without sharing servers. The servers script
// reads the same variable: base = Next dev, +1 Next prod, +2 Vite dev, +3 Vite preview, +4 Next preview build, +5 fake GitHub, +6 no-CORS media origin.
const BASE = Number(process.env.E2E_PORT_BASE ?? 3100);
const DEV_PORT = BASE; // playground in dev with NEXT_PUBLIC_PROOMPTER=true
const PROD_PORT = BASE + 1; // production build with the flag unset (DESIGN 11.1)

const PREVIEW_PORT = BASE + 4; // production build with the flag ON: dormant until enabled (D15)

export default defineConfig({
  testDir: "e2e",
  // One worker: the flow specs share one dev server and one reviews/ folder on disk, so they must not overlap.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  // Baselines live in e2e/__screenshots__/<spec>/<platform>/. Rendering differs per OS, so each platform has its
  // own set: macOS baselines are committed; CI (Linux) creates its own with `--update-snapshots=missing`.
  snapshotPathTemplate: "{testDir}/__screenshots__/{testFilePath}/{platform}/{arg}{ext}",
  use: {
    baseURL: `http://localhost:${DEV_PORT}`,
    trace: "on-first-retry",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] }, testIgnore: ["**/production.spec.ts", "**/preview.spec.ts"] },
    {
      name: "production",
      use: { ...devices["Desktop Chrome"], baseURL: `http://localhost:${PROD_PORT}` },
      testMatch: "**/production.spec.ts",
    },
    {
      name: "preview",
      use: { ...devices["Desktop Chrome"], baseURL: `http://localhost:${PREVIEW_PORT}` },
      testMatch: "**/preview.spec.ts",
    },
  ],
  // Playwright owns the servers (scripts/e2e-servers.mjs): the package build, then (ports are BASE +)
  // +1 flag-unset Next production build, +4 flag-on Next preview build, +3 Vite preview (flag unset), +2 Vite
  // dev, and last +0 `next dev` with the flag on, the URL Playwright waits for.
  webServer: {
    command: "node scripts/e2e-servers.mjs",
    url: `http://localhost:${DEV_PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 600_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
