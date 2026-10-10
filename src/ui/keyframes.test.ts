// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// An exit keyframe whose last stop leaves out `opacity` animates back to the element's own opacity (1) after the
// fade, and `both` fill holds it there until unmount: the command menu flashed back on close (D12).
const css = readFileSync(resolve(__dirname, "styles.css"), "utf8");

/** `@keyframes <name>-out` blocks: name -> body. */
function outKeyframes(): Map<string, string> {
  const found = new Map<string, string>();
  for (const m of css.matchAll(/@keyframes\s+([\w-]+-out)\s*\{/g)) {
    let depth = 1;
    let i = m.index + m[0].length;
    for (; depth && i < css.length; i++) depth += css[i] === "{" ? 1 : css[i] === "}" ? -1 : 0;
    found.set(m[1]!, css.slice(m.index + m[0].length, i - 1));
  }
  return found;
}

describe("exit keyframes", () => {
  const frames = outKeyframes();

  it("finds the kit's exit animations", () => {
    expect([...frames.keys()]).toEqual(expect.arrayContaining(["pm-cmd-out", "menu-out", "tip-out"]));
  });

  it.each([...frames])("%s ends at opacity 0", (_name, body) => {
    const last = /(?:to|100%)\s*\{([^}]*)\}\s*$/.exec(body.trim())?.[1] ?? "";
    expect(last).toMatch(/opacity\s*:\s*0(?![.\d])/);
  });
});
