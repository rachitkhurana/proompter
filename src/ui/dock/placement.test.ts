import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_PLACEMENT,
  derivePlacement,
  getDockPlacement,
  publishDockPlacement,
  resetDockPlacement,
  subscribeDockPlacement,
} from "./placement";

afterEach(() => resetDockPlacement());

const lowerRect = { left: 350, top: 740, width: 300, height: 40 };
const upperRect = { left: 350, top: 20, width: 300, height: 40 };

describe("derivePlacement", () => {
  it("horizontal in the lower half: tooltips up, toasts top, sheet right", () => {
    const p = derivePlacement("horizontal", lowerRect, 800);
    expect(p).toMatchObject({ lower: true, tooltipSide: "top", toastPosition: "top", sheetSide: "right" });
  });
  it("horizontal in the upper half: tooltips down, toasts bottom", () => {
    const p = derivePlacement("horizontal", upperRect, 800);
    expect(p).toMatchObject({ lower: false, tooltipSide: "bottom", toastPosition: "bottom", sheetSide: "right" });
  });
  it("vertical-left: tooltips open right, sheet on the right", () => {
    const p = derivePlacement("vertical-left", { left: 12, top: 100, width: 40, height: 300 }, 800);
    expect(p).toMatchObject({ tooltipSide: "right", sheetSide: "right", toastPosition: "bottom" });
  });
  it("vertical-right: tooltips open left, the sheet moves to the left", () => {
    const p = derivePlacement("vertical-right", { left: 948, top: 400, width: 40, height: 300 }, 800);
    expect(p).toMatchObject({ tooltipSide: "left", sheetSide: "left", toastPosition: "top" });
  });
  it("defaults to the bottom-centre assumptions before the dock mounts", () => {
    expect(DEFAULT_PLACEMENT).toMatchObject({ mode: "horizontal", rect: null, tooltipSide: "top", toastPosition: "top" });
  });
});

describe("store", () => {
  it("notifies only on real changes", () => {
    const fn = vi.fn();
    const off = subscribeDockPlacement(fn);
    expect(publishDockPlacement(derivePlacement("horizontal", lowerRect, 800))).toBe(true);
    expect(publishDockPlacement(derivePlacement("horizontal", { ...lowerRect }, 800))).toBe(false);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(publishDockPlacement(derivePlacement("horizontal", { ...lowerRect, left: 351 }, 800))).toBe(true);
    expect(getDockPlacement().rect?.left).toBe(351);
    off();
    publishDockPlacement(derivePlacement("vertical-left", lowerRect, 800));
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
