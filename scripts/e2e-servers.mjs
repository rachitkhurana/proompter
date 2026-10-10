// Playwright's webServer command. One process owns both playground servers so they never race on `dist/`:
//   1. build the package once
//   2. production build with the flag UNSET into .next-prod, served on :3101 (DESIGN 11.1)
//   3. the Vite example (D14): `vite build` with VITE_PROOMPTER unset, served by `vite preview` on :3103, and
//      `vite dev` with the flag on at :3102
//   4. production build with the flag ON into .next-preview, served on BASE+4 (D15 preview mode)
//   5. the fake GitHub API (test/github/fake.ts, node:http) on BASE+5, for the GitHub sync route (D16)
//   6. `next dev` with NEXT_PUBLIC_PROOMPTER=true on :3100 (everything else)
// :3100 is the URL Playwright waits for, and it starts last, so once it answers both servers are up.
import { spawn, spawnSync } from "node:child_process";
import http from "node:http";

// E2E_PORT_BASE (default 3100), the same as playwright.config.ts: two checkouts can run e2e at once.
const BASE = Number(process.env.E2E_PORT_BASE ?? 3100);
const DEV_PORT = BASE;
const PROD_PORT = BASE + 1;
const DIST = ".next-prod";
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const playground = (...args) => [pnpm, ["--filter", "proompter-playground", "exec", ...args]];
const viteExample = (...args) => [pnpm, ["--filter", "proompter-vite-example", "exec", ...args]];
const VITE_DEV_PORT = BASE + 2;
const VITE_PREVIEW_PORT = BASE + 3;
const PREVIEW_PORT = BASE + 4;
const GITHUB_PORT = BASE + 5;

const children = [];
const stop = () => {
  for (const c of children) c.kill("SIGTERM");
};
process.on("SIGTERM", () => {
  stop();
  process.exit(0);
});
process.on("SIGINT", () => {
  stop();
  process.exit(0);
});

/** `process.env` plus `env`; an `undefined` value removes the variable. */
function withEnv(env) {
  const merged = { ...process.env, ...env };
  for (const k of Object.keys(merged)) if (merged[k] === undefined) delete merged[k];
  return merged;
}

function runSync(cmd, args, env) {
  const r = spawnSync(cmd, args, { stdio: "inherit", env: withEnv(env) });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

function start(cmd, args, env) {
  const c = spawn(cmd, args, { stdio: "inherit", env: withEnv(env) });
  children.push(c);
  c.on("exit", (code) => {
    if (code) {
      stop();
      process.exit(code);
    }
  });
}

async function waitFor(url, ms = 120_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${url} did not come up`);
}

/** The GitHub sync route's settings for the playground (`app/api/proompter/github/route.ts`): the fake API, a fake token and key. */
const githubEnv = {
  PROOMPTER_GITHUB_TOKEN: "ghp_e2e_fake_token",
  PROOMPTER_REVIEW_KEY: "e2e-review-key-0123456789",
  PROOMPTER_GITHUB_REPO: "acme/reviews",
  PROOMPTER_GITHUB_API: `http://127.0.0.1:${GITHUB_PORT}`,
};

// The fake GitHub: the same code the unit tests use, served over HTTP. Specs reach it on BASE+5 (PATCH an issue
// to close it, GET /__state to inspect, POST /__reset to start clean).
const { createFakeGithub } = await import("../test/github/fake.ts");
const fakeGithub = createFakeGithub({ repo: githubEnv.PROOMPTER_GITHUB_REPO, token: githubEnv.PROOMPTER_GITHUB_TOKEN });
const fakeServer = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks);
  const out = await fakeGithub.handle(
    new Request(`http://127.0.0.1:${GITHUB_PORT}${req.url}`, {
      method: req.method,
      headers: Object.fromEntries(Object.entries(req.headers).filter(([, v]) => typeof v === "string")),
      ...(req.method === "GET" || req.method === "HEAD" ? {} : { body }),
    }),
  );
  res.writeHead(out.status, { "content-type": out.headers.get("content-type") ?? "application/json" });
  res.end(Buffer.from(await out.arrayBuffer()));
});
await new Promise((resolve, reject) => fakeServer.once("error", reject).listen(GITHUB_PORT, "127.0.0.1", resolve));
process.on("exit", () => fakeServer.close());

// Truly unset, not "": Next only inlines NEXT_PUBLIC_* variables that exist, so "" would hide a leak (D13).
const prodEnv = { NEXT_PUBLIC_PROOMPTER: undefined, PLAYGROUND_DIST_DIR: DIST };

runSync(pnpm, ["build"], {});
runSync(...playground("next", "build"), prodEnv);
start(...playground("next", "start", "-p", String(PROD_PORT)), prodEnv);
await waitFor(`http://localhost:${PROD_PORT}/`);
const previewEnv = { NEXT_PUBLIC_PROOMPTER: "true", PLAYGROUND_DIST_DIR: ".next-preview" };
runSync(...playground("next", "build"), previewEnv);
start(...playground("next", "start", "-p", String(PREVIEW_PORT)), { ...previewEnv, ...githubEnv });
await waitFor(`http://localhost:${PREVIEW_PORT}/`);
runSync(...viteExample("vite", "build"), { VITE_PROOMPTER: undefined });
start(...viteExample("vite", "preview", "--port", String(VITE_PREVIEW_PORT), "--strictPort"), { VITE_PROOMPTER: undefined });
await waitFor(`http://localhost:${VITE_PREVIEW_PORT}/`);
start(...viteExample("vite", "--port", String(VITE_DEV_PORT), "--strictPort"), { VITE_PROOMPTER: "true" });
await waitFor(`http://localhost:${VITE_DEV_PORT}/`);
start(...playground("next", "dev", "-p", String(DEV_PORT)), {
  NEXT_PUBLIC_PROOMPTER: "true",
  PLAYGROUND_DIST_DIR: ".next",
  ...githubEnv,
});
