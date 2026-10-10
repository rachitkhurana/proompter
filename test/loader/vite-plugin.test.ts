// @vitest-environment node
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createServer, type ConfigEnv, type Plugin, type UserConfig, type ViteDevServer } from "vite";
import { proompter } from "../../src/vite/index.ts";

type ConfigHook = (config: UserConfig, env: ConfigEnv) => UserConfig;
type TransformHook = (code: string, id: string) => Promise<{ code: string } | null>;

const ENV: ConfigEnv = { command: "serve", mode: "development" };
const configOf = (p: Plugin, config: UserConfig = {}) => (p.config as ConfigHook)(config, ENV);
const transformOf = (p: Plugin) => p.transform as TransformHook;
const SRC = `export function Avatar() {\n  return <div className="av" />;\n}\n`;

describe("proompter() Vite plugin", () => {
  const saved = process.env.VITE_PROOMPTER;
  afterEach(() => {
    if (saved === undefined) delete process.env.VITE_PROOMPTER;
    else process.env.VITE_PROOMPTER = saved;
  });

  it("is off without the flag: defines VITE_PROOMPTER as \"\" and stamps nothing", async () => {
    delete process.env.VITE_PROOMPTER;
    const p = proompter({ root: "/repo" });
    expect(configOf(p, { envDir: false })).toEqual({ define: { "import.meta.env.VITE_PROOMPTER": '""' } });
    expect(await transformOf(p)(SRC, "/repo/src/avatar.tsx")).toBeNull();
  });

  it("follows VITE_PROOMPTER=true, and `enabled` overrides it", () => {
    process.env.VITE_PROOMPTER = "true";
    expect(configOf(proompter(), { envDir: false }).define).toEqual({ "import.meta.env.VITE_PROOMPTER": '"true"' });
    expect(configOf(proompter({ enabled: false }), { envDir: false }).define).toEqual({
      "import.meta.env.VITE_PROOMPTER": '""',
    });
  });

  it("on: stamps the app's .tsx with its repo-relative source, never node_modules or other files", async () => {
    const p = proompter({ enabled: true, root: "/repo" });
    configOf(p, { envDir: false });
    const out = await transformOf(p)(SRC, "/repo/src/avatar.tsx?v=1");
    expect(out?.code).toContain('data-src="src/avatar.tsx:2:10"');
    expect(await transformOf(p)(SRC, "/repo/node_modules/x/avatar.tsx")).toBeNull();
    expect(await transformOf(p)("export const a = 1;", "/repo/src/a.ts")).toBeNull();
  });

  describe("dev route", () => {
    let server: ViteDevServer | undefined;
    let cwd = "";
    afterEach(async () => {
      await server?.close();
      server = undefined;
      process.chdir(path.resolve(__dirname, "../.."));
      if (cwd) rmSync(cwd, { recursive: true, force: true });
    });

    it("answers at /api/proompter on the dev server and writes under <cwd>/reviews", async () => {
      cwd = mkdtempSync(path.join(os.tmpdir(), "proompter-vite-"));
      process.chdir(cwd);
      server = await createServer({
        root: cwd,
        configFile: false,
        logLevel: "silent",
        server: { port: 0, host: "127.0.0.1" },
        plugins: [proompter({ enabled: true, root: cwd })],
      });
      await server.listen();
      const port = (server.httpServer?.address() as { port: number }).port;
      const url = `http://127.0.0.1:${port}/api/proompter`;

      const get = await fetch(url, { headers: { "x-proompter": "1" } });
      expect(get.status).toBe(200);
      expect(await get.json()).toEqual({ ok: true, sessions: [] });

      const session = { id: "2026-10-10_vite", title: "Vite", reviewer: "t", started: "2026-10-10T00:00:00Z", env: {} };
      const post = await fetch(url, {
        method: "POST",
        headers: { "x-proompter": "1", "content-type": "application/json" },
        body: JSON.stringify({ session }),
      });
      expect(post.status).toBe(200);
      expect(readdirSync(path.join(cwd, "reviews", "2026-10-10_vite"))).toContain("session.md");

      // Without the header the route refuses, as in Next.
      expect((await fetch(url)).status).toBe(403);
    });
  });
});
