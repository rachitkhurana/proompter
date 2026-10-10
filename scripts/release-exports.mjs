// Release gate for DESIGN 11.7: the published package exposes exactly `.`, `./next`, `./next/route`,
// `./github` and `./package.json`. The private `./internal/fixtures` export stays in the working tree (the
// playground's /fixtures/* e2e routes need it) and is removed only for the tarball.
//
//   node scripts/release-exports.mjs strip     remove it from package.json (a backup is kept)
//   node scripts/release-exports.mjs restore   put package.json back
//   node scripts/release-exports.mjs prepack   release build (no fixtures entry, PROOMPTER_RELEASE=1) + strip
//   node scripts/release-exports.mjs postpack  restore
//
// `prepack` / `postpack` are wired into package.json, so `pnpm pack` and `pnpm publish` strip and restore on
// their own. CI runs `strip`, then `PROOMPTER_RELEASE=1 vitest run src/internal/exports.test.ts`, then `restore`.
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkgPath = path.join(root, "package.json");
const backup = path.join(root, "node_modules", ".cache", "proompter-release", "package.json");
const PRIVATE = ["./internal/fixtures"];

function strip() {
  if (!existsSync(backup)) {
    mkdirSync(path.dirname(backup), { recursive: true });
    copyFileSync(pkgPath, backup);
  }
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  for (const key of PRIVATE) delete pkg.exports[key];
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  console.log(`release-exports: exports are now ${Object.keys(pkg.exports).join(", ")}`);
}

function restore() {
  if (!existsSync(backup)) return console.log("release-exports: nothing to restore");
  copyFileSync(backup, pkgPath);
  rmSync(backup);
  console.log("release-exports: package.json restored");
}

function prepack() {
  const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const r = spawnSync(pnpm, ["exec", "tsup"], {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, PROOMPTER_RELEASE: "1" },
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
  if (existsSync(path.join(root, "dist", "internal"))) {
    console.error("release-exports: dist/internal exists in a release build");
    process.exit(1);
  }
  strip();
}

const modes = { strip, restore, prepack, postpack: restore };
const mode = process.argv[2];
if (!modes[mode]) {
  console.error(`usage: release-exports.mjs ${Object.keys(modes).join(" | ")}`);
  process.exit(2);
}
modes[mode]();
