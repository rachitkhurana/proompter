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
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  // Back up the full package.json every time strip actually has something to remove (so a stale backup from an
  // interrupted run is replaced). A second strip on an already-stripped file keeps the backup it has.
  if (PRIVATE.some((key) => key in pkg.exports)) {
    mkdirSync(path.dirname(backup), { recursive: true });
    copyFileSync(pkgPath, backup);
  }
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
  rmSync(path.join(root, "dist"), { recursive: true, force: true }); // a normal build leaves dist/internal behind
  const r = spawnSync(pnpm, ["exec", "tsup"], {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, PROOMPTER_RELEASE: "1" },
  });
  const fail = (message, code = 1) => {
    if (message) console.error(message);
    restore(); // never leave a stripped package.json behind
    process.exit(code);
  };
  if (r.status !== 0) fail("release-exports: the release build failed", r.status ?? 1);
  if (existsSync(path.join(root, "dist", "internal"))) fail("release-exports: dist/internal exists in a release build");
  try {
    strip();
  } catch (e) {
    fail(`release-exports: strip failed: ${e}`);
  }
}

// `node scripts/release-exports.mjs check-pack pack.json`, where pack.json is `npm pack --dry-run --json`
// output taken while package.json is stripped: the tarball must hold no dist/internal file, must carry the
// font licence, and its exports must be exactly the public entry points.
function checkPack() {
  const file = process.argv[3];
  if (!file) throw new Error("usage: check-pack <npm-pack-dry-run.json>");
  const [info] = JSON.parse(readFileSync(path.resolve(file), "utf8"));
  const files = info.files.map((f) => f.path);
  const internal = files.filter((f) => f.startsWith("dist/internal"));
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  const keys = Object.keys(pkg.exports).sort();
  const want = [".", "./next", "./next/route", "./github", "./package.json"].sort();
  const problems = [];
  if (internal.length) problems.push(`tarball contains ${internal.join(", ")}`);
  if (!files.includes("licenses/Geist-OFL.txt")) problems.push("tarball lacks licenses/Geist-OFL.txt");
  if (JSON.stringify(keys) !== JSON.stringify(want)) problems.push(`exports are ${keys.join(", ")}`);
  if (problems.length) {
    console.error(`release-exports: ${problems.join("; ")}`);
    process.exit(1);
  }
  console.log(`release-exports: tarball ok (${files.length} files, exports ${keys.join(", ")})`);
}

const modes = { strip, restore, prepack, postpack: restore, "check-pack": checkPack };
const mode = process.argv[2];
if (!modes[mode]) {
  console.error(`usage: release-exports.mjs ${Object.keys(modes).join(" | ")}`);
  process.exit(2);
}
modes[mode]();
