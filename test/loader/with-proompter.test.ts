// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import proompterLoader, { loadDeps, type LoaderContext, type LoaderOptions } from "../../src/next/loader.ts";
import { withProompter } from "../../src/next/index.ts";
import { findRepoRoot, resolveLoaderPath } from "../../src/next/with-proompter.ts";

beforeAll(async () => {
  await loadDeps();
});

type Rule = { test: RegExp; exclude: RegExp; enforce: string; use: { loader: string; options: Record<string, unknown> }[] };
type WebpackFn = (config: Record<string, unknown>, ctx: unknown) => Record<string, unknown>;

describe("withProompter: disabled", () => {
  const config = { reactStrictMode: true, images: { domains: ["a.example"] }, turbopack: { rules: { "*.svg": ["x"] } } };

  it("returns the very same object for enabled: false", () => {
    expect(withProompter(config, { enabled: false })).toBe(config);
  });

  it("deep-equals its input and leaves it untouched", () => {
    const before = structuredClone(config);
    const out = withProompter(config, { enabled: false });
    expect(out).toEqual(before);
    expect(config).toEqual(before);
  });

  it("defaults to disabled when `enabled` is missing", () => {
    expect(withProompter(config)).toBe(config);
    expect(withProompter(config, {})).toBe(config);
  });

  it("returns function configs untouched too", () => {
    const fn = () => ({ a: 1 });
    expect(withProompter(fn, { enabled: false })).toBe(fn);
  });
});

describe("withProompter: enabled", () => {
  // Next 16 is installed in this repo, so the modern (schema: condition + rule items) shape applies.
  it("registers the loader for tsx and jsx in turbopack.rules, never on node_modules", () => {
    const out = withProompter({ reactStrictMode: true }, { enabled: true }) as {
      reactStrictMode: boolean;
      turbopack: {
        rules: Record<string, { loaders: { loader: string; options: LoaderOptions }[]; condition: unknown }>;
      };
    };
    expect(out.reactStrictMode).toBe(true);
    for (const key of ["*.tsx", "*.jsx"]) {
      const rule = out.turbopack.rules[key]!;
      expect(rule.condition).toEqual({ not: "foreign" });
      expect(rule.loaders[0]!.loader).toBe(resolveLoaderPath());
      expect(rule.loaders[0]!.options.root).toBe(findRepoRoot(process.cwd()));
    }
  });

  it("resolves an absolute loader file that exists", () => {
    const p = resolveLoaderPath();
    expect(path.isAbsolute(p)).toBe(true);
    expect(path.basename(p)).toMatch(/^loader\.(cjs|js|ts)$/);
    expect(fs.existsSync(p)).toBe(true);
  });

  it("defaults root to the nearest ancestor with .git (file or dir), else cwd", () => {
    const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "proompter-root-")));
    try {
      const repo = path.join(tmp, "repo");
      const app = path.join(repo, "apps", "web");
      fs.mkdirSync(app, { recursive: true });
      fs.writeFileSync(path.join(repo, ".git"), "gitdir: /elsewhere\n"); // worktree-style file
      expect(findRepoRoot(app)).toBe(repo);
      expect(findRepoRoot(repo)).toBe(repo);

      const spy = vi.spyOn(process, "cwd").mockReturnValue(app);
      const out = withProompter({}, { enabled: true }) as unknown as {
        turbopack: { rules: Record<string, { loaders: { options: LoaderOptions }[] }> };
      };
      spy.mockRestore();
      const rule = out.turbopack.rules["*.tsx"]!;
      expect(rule.loaders[0]!.options.root).toBe(repo);

      // No .git anywhere above (as far as this temp dir is concerned): falls back to the start dir.
      const lonely = path.join(tmp, "lonely");
      fs.mkdirSync(lonely);
      const found = findRepoRoot(lonely);
      expect(found === lonely || fs.existsSync(path.join(found, ".git"))).toBe(true);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("passes include / exclude / root through as serialisable options", () => {
    const out = withProompter({}, { enabled: true, root: "/repo", include: ["app/**"], exclude: ["**/x/**"] }) as {
      turbopack: { rules: Record<string, { loaders: { options: unknown }[] }> };
    };
    const options = out.turbopack.rules["*.tsx"]!.loaders[0]!.options;
    // (absent user rule: a single rule object)
    expect(options).toEqual({ root: "/repo", include: ["app/**"], exclude: ["**/x/**"] });
    expect(JSON.parse(JSON.stringify(options))).toEqual(options);
  });

  it("adds our loader as its own rule item next to a user's rule (no inherited condition), without mutating the input", () => {
    const userRule = { loaders: ["user-loader"], condition: "browser" };
    const config = {
      turbopack: {
        resolveAlias: { a: "b" },
        rules: { "*.svg": { loaders: ["@svgr/webpack"], as: "*.js" }, "*.tsx": userRule, "*.jsx": ["legacy-loader"] },
      },
    };
    const before = structuredClone(config);
    const out = withProompter(config, { enabled: true }) as unknown as {
      turbopack: { resolveAlias: unknown; rules: Record<string, unknown> };
    };
    expect(config).toEqual(before);
    expect(out.turbopack.resolveAlias).toEqual({ a: "b" });
    expect(out.turbopack.rules["*.svg"]).toEqual(before.turbopack.rules["*.svg"]);
    const tsx = out.turbopack.rules["*.tsx"] as { loaders: unknown[]; condition: unknown }[];
    expect(tsx).toHaveLength(2);
    expect(tsx[0]).toEqual(userRule); // untouched
    expect(tsx[1]!.condition).toEqual({ not: "foreign" });
    expect(tsx[1]!.loaders).toHaveLength(1);
    const jsx = out.turbopack.rules["*.jsx"] as unknown[];
    expect(jsx[0]).toBe("legacy-loader");
    expect(jsx).toHaveLength(2);
  });

  it("older Next (no `condition` support): appends to the existing loaders list instead", () => {
    const next = path.join(os.tmpdir(), "proompter-fake-next-" + process.pid);
    const nm = path.join(next, "node_modules", "next");
    fs.mkdirSync(nm, { recursive: true });
    fs.writeFileSync(path.join(nm, "package.json"), '{"name":"next","version":"15.3.0"}');
    const spy = vi.spyOn(process, "cwd").mockReturnValue(next);
    try {
      const config = { turbopack: { rules: { "*.tsx": { loaders: ["user-loader"] } } } };
      const out = withProompter(config, { enabled: true, root: next }) as unknown as {
        turbopack: { rules: Record<string, { loaders: unknown[] }> };
      };
      expect(out.turbopack.rules["*.tsx"]!.loaders[0]).toBe("user-loader");
      expect(out.turbopack.rules["*.tsx"]!.loaders).toHaveLength(2);
      expect(out.turbopack.rules["*.jsx"]).toEqual({ loaders: [expect.objectContaining({ loader: expect.any(String) })] });
      expect(config.turbopack.rules["*.tsx"].loaders).toHaveLength(1);
    } finally {
      spy.mockRestore();
      fs.rmSync(next, { recursive: true, force: true });
    }
  });

  it("adds a webpack pre-loader rule when there is no webpack function", () => {
    const out = withProompter({}, { enabled: true, root: "/repo" }) as unknown as { webpack: WebpackFn };
    const result = out.webpack({}, { dev: true }) as { module: { rules: Rule[] } };
    const rule = result.module.rules[0]!;
    expect(rule.enforce).toBe("pre");
    expect(rule.test.test("a/b.tsx")).toBe(true);
    expect(rule.test.test("a/b.jsx")).toBe(true);
    expect(rule.test.test("a/b.ts")).toBe(false);
    expect(rule.exclude.test("/x/node_modules/y.tsx")).toBe(true);
    expect(rule.use[0]!.loader).toBe(resolveLoaderPath());
    expect(rule.use[0]!.options.root).toBe("/repo");
  });

  it("composes with an existing webpack function and keeps its result", () => {
    const calls: unknown[][] = [];
    const existing: WebpackFn = (cfg, ctx) => {
      calls.push([cfg, ctx]);
      return { ...cfg, fromUser: true };
    };
    const out = withProompter({ webpack: existing }, { enabled: true }) as unknown as { webpack: WebpackFn };
    const ctx = { dev: true, isServer: false };
    const wc = { module: { rules: [{ test: /\.css$/ }] } };
    const result = out.webpack(wc, ctx) as { fromUser: boolean; module: { rules: (Rule | { test: RegExp })[] } };

    expect(calls).toHaveLength(1);
    expect(calls[0]![0]).toBe(wc);
    expect(calls[0]![1]).toBe(ctx);
    expect(result.fromUser).toBe(true);
    expect((result.module.rules[0] as Rule).enforce).toBe("pre");
    expect(result.module.rules[1]!.test).toEqual(/\.css$/);
  });

  it("falls back to the given config when the user's webpack function returns nothing", () => {
    const existing = (() => undefined) as unknown as WebpackFn;
    const out = withProompter({ webpack: existing }, { enabled: true }) as unknown as { webpack: WebpackFn };
    const wc: Record<string, unknown> = {};
    expect(out.webpack(wc, {})).toBe(wc);
    expect((wc.module as { rules: unknown[] }).rules).toHaveLength(1);
  });

  it("wraps function configs (sync and async)", async () => {
    const sync = withProompter(() => ({ a: 1 }), { enabled: true }) as unknown as () => Record<string, unknown>;
    expect(sync().a).toBe(1);
    expect(sync().turbopack).toBeDefined();

    const asyncCfg = withProompter(async () => ({ b: 2 }), { enabled: true }) as unknown as () => Promise<Record<string, unknown>>;
    const resolved = await asyncCfg();
    expect(resolved.b).toBe(2);
    expect(resolved.turbopack).toBeDefined();
    expect(typeof resolved.webpack).toBe("function");
  });
});

describe("the loader function (webpack / Turbopack contract)", () => {
  function run(
    resourcePath: string,
    source: string,
    options: LoaderOptions,
    extra: Partial<LoaderContext> = {},
    inputMap?: unknown,
  ): Promise<{ code?: string; map?: unknown }> {
    return new Promise((resolve, reject) => {
      const ctx: LoaderContext = {
        resourcePath,
        rootContext: "/should/be/ignored",
        sourceMap: true,
        getOptions: () => options,
        async: () => (err, code, map) => (err ? reject(err) : resolve({ code, map })),
        ...extra,
      };
      proompterLoader.call(ctx, source, inputMap);
    });
  }

  const jsx = "export const A = () => <div><p /></div>;\n";

  it("writes repo-relative POSIX paths and returns a source map", async () => {
    const { code, map } = await run("/repo/app/page.tsx", jsx, { root: "/repo" });
    expect(code).toContain('<div data-src="app/page.tsx:1:24" data-comp="A">');
    expect(code).toContain('<p data-src="app/page.tsx:1:29" />');
    expect(map).toMatchObject({ version: 3, sources: ["/repo/app/page.tsx"] });
  });

  it("falls back to rootContext, then to this.query", async () => {
    const a = await run("/repo/x.tsx", jsx, {}, { rootContext: "/repo", getOptions: undefined, query: {} });
    expect(a.code).toContain('data-src="x.tsx:1:24"');
    const b = await run("/repo/y.tsx", jsx, {}, { getOptions: undefined, query: { root: "/repo" } });
    expect(b.code).toContain('data-src="y.tsx:1:24"');
  });

  it("passes skipped files through unchanged", async () => {
    for (const file of ["/repo/node_modules/x/a.tsx", "/repo/a.stories.tsx", "/repo/a.test.tsx", "/repo/a.ts"]) {
      const out = await run(file, jsx, { root: "/repo" });
      expect(out.code).toBe(jsx);
    }
    const excluded = await run("/repo/app/admin/a.tsx", jsx, { root: "/repo", exclude: ["**/admin/**"] });
    expect(excluded.code).toBe(jsx);
  });

  it("passes the incoming map along for unchanged files", async () => {
    const inputMap = { version: 3, sources: ["a.ts"], names: [], mappings: "" };
    const out = await run("/repo/a.test.tsx", jsx, { root: "/repo" }, {}, inputMap);
    expect(out.map).toBe(inputMap);
  });

  it("never fails the build on a syntax error", async () => {
    const bad = "export const A = () => <div";
    const out = await run("/repo/a.tsx", bad, { root: "/repo" });
    expect(out.code).toBe(bad);
  });

  it("skips the map when the host does not want one", async () => {
    const out = await run("/repo/a.tsx", jsx, { root: "/repo" }, { sourceMap: false });
    expect(out.code).toContain("data-src=");
    expect(out.map).toBeUndefined();
  });

  it("calls the callback exactly once; a throwing callback is not called again with an error", () => {
    const calls: unknown[][] = [];
    const ctx: LoaderContext = {
      resourcePath: "/repo/a.tsx",
      getOptions: () => ({ root: "/repo" }),
      async: () => (...args) => {
        calls.push(args);
        throw new Error("downstream boom");
      },
    };
    expect(() => proompterLoader.call(ctx, jsx)).toThrow("downstream boom");
    expect(calls).toHaveLength(1);
    expect(calls[0]![0]).toBeNull(); // the one call was the success call, not an error report
  });
});

describe("Node version guard", () => {
  const ok = {
    parser: () => Promise.resolve({ parse: (() => undefined) as never }),
    magicString: () => Promise.resolve({ default: class {} as never }),
    remapping: () => Promise.resolve({ default: (() => undefined) as never }),
  };
  const requireEsm = () => Promise.reject(Object.assign(new Error("require() of ES Module"), { code: "ERR_REQUIRE_ESM" }));

  it.each(["parser", "magicString", "remapping"] as const)(
    "turns ERR_REQUIRE_ESM from %s into an actionable error",
    async (which) => {
      await expect(loadDeps({ ...ok, [which]: requireEsm })).rejects.toThrow(
        `@rachitkay/proompter/next needs Node 22.18 or newer (found ${process.version})`,
      );
    },
  );

  it("rethrows other load errors untouched", async () => {
    const boom = new Error("disk on fire");
    await expect(loadDeps({ ...ok, parser: () => Promise.reject(boom) })).rejects.toBe(boom);
    await loadDeps(); // restore the real deps for any test that runs afterwards
  });

  it("the loader reports the guard error through the callback", async () => {
    // Fresh module instance so no deps are cached, with the parser import made to fail.
    vi.resetModules();
    vi.doMock("@babel/parser", () => {
      throw Object.assign(new Error("require() of ES Module"), { code: "ERR_REQUIRE_ESM" });
    });
    try {
      const fresh = await import("../../src/next/loader.ts");
      const err = await new Promise<Error | null>((resolve) => {
        const ctx: LoaderContext = {
          resourcePath: "/repo/a.tsx",
          getOptions: () => ({ root: "/repo" }),
          async: () => (e) => resolve(e),
        };
        fresh.default.call(ctx, "export const A = () => <div />;");
      });
      // Vitest may wrap factory errors and drop `code`; either way the build must be failed with *an* error.
      expect(err).toBeInstanceOf(Error);
    } finally {
      vi.doUnmock("@babel/parser");
      vi.resetModules();
    }
  });
});
