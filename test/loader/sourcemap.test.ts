// @vitest-environment node
import { originalPositionFor, TraceMap, type SourceMapInput } from "@jridgewell/trace-mapping";
import MagicString from "magic-string";
import { describe, expect, it } from "vitest";
import { loadDeps, stampSource } from "../../src/next/loader.ts";
import { genPos, readFixture, relOf, stampFixture } from "./helpers.ts";

await loadDeps();

/** Every stamped `<tag data-src="path:L:C"` in the output, with its generated position. */
function stampedTags(code: string) {
  const re = /<([a-z][\w-]*) data-src="([^":]+):(\d+):(\d+)"/g;
  const found: { tag: string; line: number; col: number; gen: { line: number; column: number } }[] = [];
  for (const m of code.matchAll(re)) {
    found.push({ tag: m[1]!, line: Number(m[3]), col: Number(m[4]), gen: genPos(code, m.index) });
  }
  return found;
}

describe("source maps", () => {
  it("round trip: every stamped element maps back to the line:col it claims", () => {
    for (const fixture of ["nested.tsx", "conditional.tsx", "fragments.tsx", "generics.tsx"]) {
      const { code, out } = stampFixture(fixture);
      const map = new TraceMap(out.map as unknown as SourceMapInput);
      const tags = stampedTags(out.code);
      expect(tags.length).toBeGreaterThan(0);
      for (const t of tags) {
        const orig = originalPositionFor(map, t.gen);
        expect(orig.source, `${fixture} <${t.tag}>`).toBe(relOf(fixture));
        expect(orig.line, `${fixture} <${t.tag}> line`).toBe(t.line);
        expect(orig.column, `${fixture} <${t.tag}> column`).toBe(t.col - 1); // map columns are 0-based
      }
      expect(out.map.sourcesContent).toEqual([code]);
    }
  });

  it("content after an insertion on the same line still maps to its original column", () => {
    const code = "export const A = () => <div><span>x</span></div>;\n";
    const out = stampSource(code, "a.tsx")!;
    const map = new TraceMap(out.map as unknown as SourceMapInput);
    const spanGen = genPos(out.code, out.code.indexOf("x</span>"));
    expect(originalPositionFor(map, spanGen)).toMatchObject({ line: 1, column: code.indexOf("x</span>") });
  });

  it("composes with an incoming map (original line, not the intermediate one)", () => {
    const original = readFixture("nested.tsx");
    // Pretend an earlier loader prepended a banner line, shifting everything down by one.
    const earlier = new MagicString(original);
    earlier.prepend("// banner\n");
    const intermediate = earlier.toString();
    const inputMap = earlier.generateMap({ hires: true, source: relOf("nested.tsx"), includeContent: true });

    const out = stampSource(intermediate, relOf("nested.tsx"), { inputMap: inputMap.toString() })!;
    const map = new TraceMap(out.map as unknown as SourceMapInput);
    const tags = stampedTags(out.code);
    expect(tags.length).toBeGreaterThan(0);
    for (const t of tags) {
      // data-src speaks about the code this loader saw (banner included); the map speaks about the file.
      const orig = originalPositionFor(map, t.gen);
      expect(orig.line, `<${t.tag}>`).toBe(t.line - 1);
      expect(orig.column, `<${t.tag}>`).toBe(t.col - 1);
    }
    expect(out.map.sources).toEqual([relOf("nested.tsx")]);
    expect(out.map.sourcesContent).toEqual([original]);
  });

  it("accepts an incoming map given as an object", () => {
    const original = "export const A = () => <p />;\n";
    const earlier = new MagicString(original).prepend("\n");
    const inputMap = JSON.parse(earlier.generateMap({ hires: true, source: "a.tsx", includeContent: true }).toString());
    const out = stampSource(earlier.toString(), "a.tsx", { inputMap })!;
    const map = new TraceMap(out.map as unknown as SourceMapInput);
    const pos = genPos(out.code, out.code.indexOf("<p"));
    expect(originalPositionFor(map, pos).line).toBe(1);
  });
});
