// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// DESIGN section 11.7: the published package exposes exactly these entry points. The private
// `internal/fixtures` export used by the playground must be gone from `exports` before release
// (T10 makes this pass).
const pkg = JSON.parse(readFileSync(resolve(__dirname, "../../package.json"), "utf8")) as {
  exports: Record<string, unknown>;
};

describe("package.json exports", () => {
  // Run with `node scripts/release-exports.mjs strip` first (CI does; `prepack` does it for a real release).
  it.runIf(process.env.PROOMPTER_RELEASE === "1")("expose only the public entry points", () => {
    expect(Object.keys(pkg.exports).sort()).toEqual(
      [".", "./next", "./next/route", "./vite", "./github", "./plugins", "./package.json"].sort(),
    );
  });

  it.runIf(process.env.PROOMPTER_RELEASE === "1")("leave no internal path in any export", () => {
    expect(JSON.stringify(pkg.exports)).not.toContain("internal");
  });
});
