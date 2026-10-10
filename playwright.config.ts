import { defineConfig, devices } from "@playwright/test";

const DEV_PORT = 3100; // playground in dev with NEXT_PUBLIC_PROOMPTER=true
const PROD_PORT = 3101; // production build with the flag unset (DESIGN 11.1)

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
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
    { name: "chromium", use: { ...devices["Desktop Chrome"] }, testIgnore: "**/production.spec.ts" },
    {
      name: "production",
      use: { ...devices["Desktop Chrome"], baseURL: `http://localhost:${PROD_PORT}` },
      testMatch: "**/production.spec.ts",
    },
  ],
  // Playwright owns the servers (scripts/e2e-servers.mjs): the package build, a flag-unset production build
  // served on :3101, then `next dev` with the flag on at :3100.
  webServer: {
    command: "node scripts/e2e-servers.mjs",
    url: `http://localhost:${DEV_PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 420_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
