import { describe, expect, it } from "vitest";
import { placeComposer, unionBox } from "./place";

const vp = { width: 1280, height: 800 };
const panel = { width: 500, height: 300 };

describe("placeComposer", () => {
  it("opens just below the target, aligned to its left edge, scaling from its centre", () => {
    const p = placeComposer({ anchor: { left: 200, top: 100, width: 60, height: 40 }, panel, viewport: vp, dock: null });
    // top: 140 + 10. origin x: 200 + min(60, 40) / 2 - 200 = 20.
    expect(p).toEqual({ left: 200, top: 150, ox: "20px", oy: "0" });
  });

  it("origin x follows the target, clamped 16px inside the panel", () => {
    const wide = placeComposer({ anchor: { left: 100, top: 100, width: 400, height: 40 }, panel, viewport: vp, dock: null });
    expect(wide.ox).toBe("20px"); // 100 + 40/2 - 100
    const tiny = placeComposer({ anchor: { left: 100, top: 100, width: 6, height: 6 }, panel, viewport: vp, dock: null });
    expect(tiny.ox).toBe("16px"); // 100 + 3 - 100 = 3 -> 16
    const farRight = placeComposer({ anchor: { left: 1270, top: 100, width: 6, height: 6 }, panel, viewport: vp, dock: null });
    expect(farRight.left).toBe(1280 - 500 - 12);
    expect(farRight.ox).toBe("484px"); // 1270 + 3 - 768 = 505 -> pw - 16
  });

  it("flips above the target when there is no room below, and grows from the bottom edge", () => {
    const p = placeComposer({ anchor: { left: 100, top: 600, width: 100, height: 100 }, panel, viewport: vp, dock: null });
    expect(p.top).toBe(600 - 300 - 10);
    expect(p.oy).toBe("100%");
  });

  it("when it fits neither side, sits over the target (24px down), inside the margins", () => {
    const tall = placeComposer({ anchor: { left: 100, top: 20, width: 100, height: 760 }, panel, viewport: vp, dock: null });
    expect(tall.top).toBe(44); // min(800 - 300 - 12, 20 + 24)
    expect(tall.oy).toBe("0");
    const huge = placeComposer({ anchor: { left: 100, top: 0, width: 100, height: 800 }, panel: { width: 500, height: 900 }, viewport: vp, dock: null });
    expect(huge.top).toBe(12);
  });

  it("clamps the left edge to the margin", () => {
    expect(placeComposer({ anchor: { left: -50, top: 100, width: 60, height: 40 }, panel, viewport: vp, dock: null }).left).toBe(12);
  });

  it("a page note is centred, 16% down", () => {
    const p = placeComposer({ anchor: null, panel, viewport: vp, dock: null });
    expect(p).toEqual({ left: 390, top: 128, ox: "50%", oy: "0" });
    expect(placeComposer({ anchor: null, panel, viewport: { width: 1280, height: 40 }, dock: null }).top).toBe(12);
  });

  it("keeps clear of the dock: moves above it when they overlap", () => {
    const dock = { left: 440, top: 740, width: 400, height: 50 };
    const p = placeComposer({ anchor: { left: 500, top: 420, width: 60, height: 40 }, panel, viewport: vp, dock });
    // Below the anchor: 470..770, which overlaps the dock (740..790) -> above the dock.
    expect(p.top).toBe(740 - 300 - 12);
  });

  it("leaves the position alone when the dock is elsewhere", () => {
    const dock = { left: 20, top: 100, width: 50, height: 300 }; // vertical, left edge
    const without = placeComposer({ anchor: { left: 500, top: 100, width: 60, height: 40 }, panel, viewport: vp, dock: null });
    const withDock = placeComposer({ anchor: { left: 500, top: 100, width: 60, height: 40 }, panel, viewport: vp, dock });
    expect(withDock).toEqual(without);
  });

  it("clears a vertical dock on the right edge too", () => {
    const dock = { left: 1210, top: 100, width: 50, height: 300 };
    const p = placeComposer({ anchor: { left: 1200, top: 120, width: 30, height: 30 }, panel, viewport: vp, dock });
    // left clamps to 768 (..1268) and overlaps the dock horizontally; vertically 160..460 overlaps 100..400 -> above it
    expect(p.top).toBe(Math.max(12, 100 - 300 - 12));
  });
});

describe("unionBox", () => {
  it("is the smallest box around all of them", () => {
    expect(
      unionBox([
        { left: 10, top: 20, width: 30, height: 40 },
        { left: 100, top: 5, width: 10, height: 10 },
      ]),
    ).toEqual({ left: 10, top: 5, width: 100, height: 55 });
    expect(unionBox([])).toBeNull();
  });
});
