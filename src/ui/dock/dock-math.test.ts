import { describe, expect, it } from "vitest";
import {
  capSpeed,
  defaultPosition,
  dragPosition,
  exceedsClickSlop,
  keyStep,
  parsePosition,
  projectX,
  pushSample,
  releaseVelocity,
  restingPosition,
  rubber,
  rubberClamp,
  snapEdge,
  type Sample,
} from "./dock-math";

const VP = { w: 1000, h: 800 };
const SIZE = { w: 300, h: 40 };

describe("rubber band", () => {
  it("is 0 at 0, softer than 1:1, monotonic, and never exceeds the dock's own extent", () => {
    expect(rubber(0, 300)).toBe(0);
    expect(rubber(10, 300)).toBeCloseTo(5.401, 2);
    let prev = 0;
    for (const o of [5, 20, 80, 300, 2000, 1e6]) {
      const r = rubber(o, 300);
      expect(r).toBeGreaterThan(prev);
      expect(r).toBeLessThan(o);
      expect(r).toBeLessThan(300);
      prev = r;
    }
  });

  it("rubberClamp is 1:1 inside and resists outside, on both sides", () => {
    expect(rubberClamp(100, 8, 692, 300)).toBe(100);
    expect(rubberClamp(8, 8, 692, 300)).toBe(8);
    expect(rubberClamp(692, 8, 692, 300)).toBe(692);
    expect(rubberClamp(-50, 8, 692, 300)).toBeCloseTo(8 - rubber(58, 300), 6);
    expect(rubberClamp(-50, 8, 692, 300)).toBeLessThan(8);
    expect(rubberClamp(800, 8, 692, 300)).toBeCloseTo(692 + rubber(108, 300), 6);
    expect(rubberClamp(800, 8, 692, 300)).toBeLessThan(800);
  });
});

describe("dragPosition", () => {
  it("keeps the grab offset: 1:1 under the pointer", () => {
    expect(dragPosition({ x: 400, y: 300 }, { x: 50, y: 20 }, SIZE, VP)).toEqual({ x: 350, y: 280 });
  });
  it("rubber-bands past the window margin on every side", () => {
    const left = dragPosition({ x: 0, y: 300 }, { x: 50, y: 20 }, SIZE, VP);
    expect(left.x).toBeCloseTo(8 - rubber(58, 300), 6);
    const bottom = dragPosition({ x: 400, y: 900 }, { x: 50, y: 20 }, SIZE, VP);
    expect(bottom.y).toBeCloseTo(752 + rubber(880 - 752, 40), 6);
    const top = dragPosition({ x: 400, y: -100 }, { x: 50, y: 20 }, SIZE, VP);
    expect(top.y).toBeLessThan(8);
  });
});

describe("click vs drag", () => {
  it("under 4px is a click, 4px and over is a drag", () => {
    expect(exceedsClickSlop(0, 0)).toBe(false);
    expect(exceedsClickSlop(3, 2)).toBe(false); // 3.6
    expect(exceedsClickSlop(2, 3)).toBe(false);
    expect(exceedsClickSlop(4, 0)).toBe(true);
    expect(exceedsClickSlop(0, -4)).toBe(true);
    expect(exceedsClickSlop(3, 3)).toBe(true); // 4.24
  });
});

describe("velocity and projection", () => {
  it("keeps the last 6 samples", () => {
    const h: Sample[] = [];
    for (let i = 0; i < 10; i++) pushSample(h, { x: i, y: 0, t: i });
    expect(h.map((s) => s.x)).toEqual([4, 5, 6, 7, 8, 9]);
  });

  it("is px/s between the first and last sample, with dt floored at 16ms", () => {
    expect(releaseVelocity([])).toEqual({ x: 0, y: 0 });
    expect(releaseVelocity([{ x: 0, y: 0, t: 0 }, { x: 50, y: -10, t: 100 }])).toEqual({ x: 500, y: -100 });
    expect(releaseVelocity([{ x: 0, y: 0, t: 0 }, { x: 16, y: 0, t: 4 }]).x).toBe(1000);
  });

  it("ignores samples older than 100ms: pausing before release means no speed", () => {
    const h: Sample[] = [
      { x: 0, y: 0, t: 0 },
      { x: 300, y: 0, t: 20 },
      { x: 301, y: 0, t: 400 },
      { x: 302, y: 0, t: 450 },
    ];
    expect(releaseVelocity(h).x).toBe(20); // (302 - 301) / 50ms
    expect(releaseVelocity([{ x: 0, y: 0, t: 0 }, { x: 50, y: 0, t: 500 }])).toEqual({ x: 0, y: 0 });
  });

  it("projects x + v/1000 * 0.99 / 0.01", () => {
    expect(projectX(500, 0)).toBe(500);
    expect(projectX(500, 1000)).toBeCloseTo(599, 6);
    expect(projectX(100, -1000)).toBeCloseTo(1, 6);
  });

  it("caps the velocity handed to the spring", () => {
    expect(capSpeed(10_000)).toBe(3000);
    expect(capSpeed(-10_000)).toBe(-3000);
    expect(capSpeed(120)).toBe(120);
  });
});

describe("edge snap (72px)", () => {
  it("snaps left under 72 and right over width - 72, exclusive", () => {
    expect(snapEdge(71.9, 1000)).toBe("l");
    expect(snapEdge(72, 1000)).toBe(null);
    expect(snapEdge(500, 1000)).toBe(null);
    expect(snapEdge(928, 1000)).toBe(null);
    expect(snapEdge(928.1, 1000)).toBe("r");
    expect(snapEdge(-300, 1000)).toBe("l");
    expect(snapEdge(1400, 1000)).toBe("r");
  });
  it("a fast flick snaps although the pointer is far from the edge", () => {
    const flick: Sample[] = [400, 350, 300, 250, 200].map((x, i) => ({ x, y: 0, t: i * 16 }));
    const slow: Sample[] = [400, 350, 300, 250, 200].map((x, i) => ({ x, y: 0, t: i * 160 }));
    expect(snapEdge(projectX(200, releaseVelocity(flick).x), 1000)).toBe("l");
    expect(snapEdge(projectX(200, releaseVelocity(slow).x), 1000)).toBe(null);
  });
});

describe("resting position", () => {
  it("vertical bars hug their edge by 12px", () => {
    expect(restingPosition({ x: 333, y: 100, edge: "l" }, SIZE, VP)).toEqual({ x: 12, y: 100 });
    expect(restingPosition({ x: 333, y: 100, edge: "r" }, SIZE, VP)).toEqual({ x: 688, y: 100 });
  });
  it("keeps a floating dock 8px inside the window", () => {
    expect(restingPosition({ x: -40, y: -5, edge: null }, SIZE, VP)).toEqual({ x: 8, y: 8 });
    expect(restingPosition({ x: 2000, y: 2000, edge: null }, SIZE, VP)).toEqual({ x: 692, y: 752 });
    expect(restingPosition({ x: 200, y: 300, edge: null }, SIZE, VP)).toEqual({ x: 200, y: 300 });
  });
  it("the default spot is bottom centre, 20px up", () => {
    expect(defaultPosition(SIZE, VP)).toEqual({ x: 350, y: 740 });
  });
});

describe("keyboard", () => {
  it("steps 24px per arrow, nothing for other keys", () => {
    expect(keyStep("ArrowLeft")).toEqual([-24, 0]);
    expect(keyStep("ArrowRight")).toEqual([24, 0]);
    expect(keyStep("ArrowUp")).toEqual([0, -24]);
    expect(keyStep("ArrowDown")).toEqual([0, 24]);
    expect(keyStep("Enter")).toBeNull();
    expect(keyStep("a")).toBeNull();
  });
});

describe("parsePosition", () => {
  it("accepts good data and rejects the rest", () => {
    expect(parsePosition({ x: 1, y: 2, edge: "l" })).toEqual({ x: 1, y: 2, edge: "l" });
    expect(parsePosition({ x: 1, y: 2, edge: null })).toEqual({ x: 1, y: 2, edge: null });
    expect(parsePosition({ x: 1, y: 2, edge: "up" })).toEqual({ x: 1, y: 2, edge: null });
    expect(parsePosition({ x: "1", y: 2 })).toBeNull();
    expect(parsePosition({ x: NaN, y: 2 })).toBeNull();
    expect(parsePosition(null)).toBeNull();
    expect(parsePosition("nope")).toBeNull();
  });
});
