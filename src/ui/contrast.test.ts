// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// axe can't resolve colour contrast through stacked translucent panels (e2e/a11y.spec.ts ignores "bgOverlap"),
// so the token pairs are checked here. Values come from src/ui/styles.css (the first, default definition).
const css = readFileSync(resolve(__dirname, "styles.css"), "utf8");
type RGBA = [number, number, number, number];

function token(name: string): RGBA {
  const raw = new RegExp(`--${name}:\\s*([^;]+);`).exec(css)?.[1]?.trim() ?? "";
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(raw)?.[1];
  if (hex) {
    const h = hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex;
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).concat(1) as RGBA;
  }
  const m = /^rgba?\(([^)]+)\)$/.exec(raw);
  if (!m) throw new Error(`cannot parse --${name}: ${raw}`);
  const [r = 0, g = 0, b = 0, a = 1] = m[1]!.split(",").map(Number);
  return [r, g, b, a];
}

const over = (top: RGBA, base: RGBA): RGBA => [0, 1, 2].map((i) => top[i]! * top[3] + base[i]! * (1 - top[3])).concat(1) as RGBA;
const lum = (c: RGBA) => {
  const [r, g, b] = [0, 1, 2].map((i) => {
    const v = c[i]! / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a: RGBA, b: RGBA) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};

describe("colour tokens meet WCAG AA (4.5:1)", () => {
  // The kit is a dark theme drawn over the host page. Reference surfaces: the canvas, and the glass panels
  // (--mat-1 small chrome, --mat-2 big surfaces) composited over the canvas, with --fill-2 (the resting row/chip
  // fill) on top of the lightest panel. A white host page showing through the blur is deliberately not a
  // reference: the kit sets its own dark material, and no token can pass on an arbitrary backdrop.
  const canvas = token("canvas");
  const mat1 = over(token("mat-1"), canvas);
  const mat2 = over(token("mat-2"), canvas);
  const surfaces: Record<string, RGBA> = {
    canvas,
    "mat-1 over canvas": mat1,
    "mat-2 over canvas": mat2,
    "fill-2 over mat-1": over(token("fill-2"), mat1),
    "fill-3 (hover) over mat-2": over(token("fill-3"), mat2),
  };

  for (const text of ["fg", "fg-2", "fg-3"]) {
    for (const [name, surface] of Object.entries(surfaces)) {
      it(`--${text} on ${name}`, () => {
        expect(ratio(token(text), surface)).toBeGreaterThanOrEqual(4.5);
      });
    }
  }

  it("--acc-fg on --acc-solid", () => {
    expect(ratio(token("acc-fg"), token("acc-solid"))).toBeGreaterThanOrEqual(4.5);
  });
});
