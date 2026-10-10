/**
 * `withProompter(nextConfig, { enabled })` (DESIGN §3).
 *
 * Deliberately imports nothing heavy (no babel): `next.config` loads this on every run, including
 * the ones where the kit is disabled.
 */
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface WithProompterOptions {
  /** Default `false`: without an explicit `true` the config is returned untouched. */
  enabled?: boolean;
  /**
   * Glob patterns on repo-relative paths (`*`, `**`, `?`, `{a,b}`); empty/undefined = every
   * .tsx/.jsx. A pattern ending in a plain name also matches everything below it.
   */
  include?: string[];
  /**
   * Same glob syntax as `include`, e.g. `["app/admin", "**\/*.{canvas,three}.tsx"]`. node_modules,
   * `.stories.*`, `.test.*` and `.spec.*` are always skipped, as is any file importing
   * `@react-three/fiber` or `@react-three/drei` (they read `data-*` props as nested paths); use
   * `exclude` to opt other non-DOM renderers out.
   */
  exclude?: string[];
  /**
   * Root that `data-src` paths are relative to. Default: the nearest ancestor of `process.cwd()`
   * containing `.git` (directory or file), else `process.cwd()`.
   */
  root?: string;
}

type Obj = Record<string, unknown>;
type LoaderEntry = { loader: string; options: Obj };

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Absolute path of the built loader. tsup emits `dist/next/loader.cjs` next to `dist/next/index.*`
 * (CJS so it works in every loader runner); under Vitest/ts sources it is `src/next/loader.ts`.
 * Needs tsup `shims: true` so `import.meta.url` also works in the CJS output.
 */
export function resolveLoaderPath(): string {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(dir, "loader.cjs"),
    path.join(dir, "next", "loader.cjs"), // if the bundler hoisted this module into a dist/ chunk
    path.join(dir, "loader.js"),
    path.join(dir, "loader.ts"),
  ];
  const found = candidates.find((c) => fs.existsSync(c));
  if (!found) {
    throw new Error(`@rachitkay/proompter: cannot find the source-stamping loader. Looked in:\n  ${candidates.join("\n  ")}`);
  }
  return found;
}

/** Nearest ancestor of `start` (inclusive) containing `.git` (dir, or file for worktrees); else `start`. */
export function findRepoRoot(start: string): string {
  let dir = path.resolve(start);
  for (;;) {
    if (fs.existsSync(path.join(dir, ".git"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return path.resolve(start);
    dir = parent;
  }
}

/** Major version of the `next` installed for `root`, or undefined if it can't be determined. */
function nextMajor(root: string): number | undefined {
  try {
    const pkg = createRequire(path.join(root, "noop.js"))("next/package.json") as { version?: string };
    const major = Number.parseInt(pkg.version ?? "", 10);
    return Number.isNaN(major) ? undefined : major;
  } catch {
    return undefined;
  }
}

/**
 * Add our loader to a Turbopack rule value.
 *
 * Next 16 (`condition` supported): our loader is its OWN rule item, never merged into a user's
 * item (we'd inherit its `condition`), and gets `condition: { not: "foreign" }` so it never runs
 * on node_modules. Older Next: the only schema-safe shape is to append to the loaders list.
 */
function withTurbopackRule(existing: unknown, entry: LoaderEntry, modern: boolean): unknown {
  if (modern) {
    const ours = { loaders: [entry], condition: { not: "foreign" } };
    if (Array.isArray(existing)) return [...existing, ours];
    if (isObj(existing)) return [existing, ours];
    return ours;
  }
  // Loaders run last-to-first, so ours goes last: it sees the raw source, before any user loader.
  if (Array.isArray(existing)) return [...existing, entry];
  if (isObj(existing)) {
    const loaders = Array.isArray(existing.loaders) ? existing.loaders : [];
    return { ...existing, loaders: [...loaders, entry] };
  }
  return { loaders: [entry] };
}

function applyProompter<C extends Obj>(config: C, options: WithProompterOptions, root: string): C {
  const entry: LoaderEntry = {
    loader: resolveLoaderPath(),
    options: {
      root,
      ...(options.include ? { include: options.include } : {}),
      ...(options.exclude ? { exclude: options.exclude } : {}),
    },
  };
  const modern = (nextMajor(process.cwd()) ?? 0) >= 16;

  const turbopack = isObj(config.turbopack) ? config.turbopack : {};
  const rules = isObj(turbopack.rules) ? turbopack.rules : {};
  // Two plain extension globs: they are the safest form across Turbopack versions.
  const nextRules: Obj = { ...rules };
  for (const key of ["*.tsx", "*.jsx"]) nextRules[key] = withTurbopackRule(rules[key], entry, modern);

  const existingWebpack = config.webpack;
  const webpack = (webpackConfig: Obj, context: unknown): Obj => {
    const base: Obj =
      typeof existingWebpack === "function"
        ? ((existingWebpack(webpackConfig, context) as Obj | undefined) ?? webpackConfig)
        : webpackConfig;
    const mod: Obj = isObj(base.module) ? base.module : (base.module = {});
    const list: unknown[] = Array.isArray(mod.rules) ? mod.rules : (mod.rules = []);
    list.unshift({
      test: /\.(tsx|jsx)$/,
      exclude: /node_modules/,
      enforce: "pre", // before next-swc-loader, so we see the untouched source
      use: [entry],
    });
    return base;
  };

  return { ...config, turbopack: { ...turbopack, rules: nextRules }, webpack };
}

/**
 * Disabled: returns `config` itself (same reference). Enabled: returns a new config with the
 * stamping loader registered for Turbopack (`turbopack.rules`) and webpack (composed with any
 * existing `webpack` function). Function-style and async configs are supported.
 */
export function withProompter<T extends object>(config: T, options: WithProompterOptions = {}): T {
  if (options.enabled !== true) return config;
  const root = options.root ?? findRepoRoot(process.cwd()); // once per call

  if (typeof config === "function") {
    const fn = config as unknown as (...args: unknown[]) => unknown;
    const wrapped = (...args: unknown[]): unknown => {
      const result = fn(...args);
      return result instanceof Promise
        ? result.then((c: Obj) => applyProompter(c, options, root))
        : applyProompter(result as Obj, options, root);
    };
    return wrapped as unknown as T;
  }
  return applyProompter(config as Obj, options, root) as T;
}
