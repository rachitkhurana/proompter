import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spring } from "./spring";

/** A manual rAF clock: `tick(ms)` runs one frame `ms` after the previous one. */
function installClock() {
  let now = 0;
  let next = 1;
  const queue = new Map<number, FrameRequestCallback>();
  const g = globalThis as unknown as Record<string, unknown>;
  const saved = { raf: g.requestAnimationFrame, caf: g.cancelAnimationFrame };
  g.requestAnimationFrame = (cb: FrameRequestCallback) => {
    const id = next++;
    queue.set(id, cb);
    return id;
  };
  g.cancelAnimationFrame = (id: number) => void queue.delete(id);
  return {
    tick(ms = 16) {
      now += ms;
      const frames = [...queue.entries()];
      queue.clear();
      for (const [, cb] of frames) cb(now);
    },
    pending: () => queue.size,
    restore() {
      g.requestAnimationFrame = saved.raf;
      g.cancelAnimationFrame = saved.caf;
    },
  };
}

let clock: ReturnType<typeof installClock>;
beforeEach(() => {
  clock = installClock();
});
afterEach(() => clock.restore());

function run(o: Partial<Parameters<typeof spring>[0]> & { from: number; to: number }, maxFrames = 400) {
  const values: number[] = [];
  let done = 0;
  spring({ reducedMotion: false, ...o, onUpdate: (v) => values.push(v), onDone: () => done++ });
  let frames = 0;
  while (clock.pending() && frames++ < maxFrames) clock.tick(16);
  return { values, done, frames };
}

describe("spring", () => {
  it("starts at `from` and settles exactly on `to`", () => {
    const { values, done } = run({ from: 0, to: 100 });
    expect(values[0]).toBe(0);
    expect(values.at(-1)).toBe(100);
    expect(done).toBe(1);
  });

  it("never overshoots without initial velocity (damping ratio 1.0)", () => {
    const { values } = run({ from: 0, to: 100 });
    for (const v of values) expect(v).toBeLessThanOrEqual(100.0001);
    for (let i = 1; i < values.length; i++) expect(values[i]!).toBeGreaterThanOrEqual(values[i - 1]!);
  });

  it("settles in about the response time scale (well under a second)", () => {
    const { frames } = run({ from: 0, to: 100 });
    expect(frames * 16).toBeLessThan(1500);
    expect(frames * 16).toBeGreaterThan(300);
  });

  it("hands the release velocity over: the first step moves with it", () => {
    const fast = run({ from: 0, to: 100, velocity: 2000 });
    const still = run({ from: 0, to: 100, velocity: 0 });
    expect(fast.values[1]!).toBeGreaterThan(still.values[1]!);
    // moving away from the target starts by going that way
    const away = run({ from: 0, to: 100, velocity: -2000 });
    expect(away.values[1]!).toBeLessThan(0);
  });

  it("is frame-rate independent (closed form)", () => {
    // sample both at 192ms (an exact multiple of 16 and of 8)
    const a = (() => {
      let last = NaN;
      spring({ from: 0, to: 100, reducedMotion: false, onUpdate: (v) => (last = v) });
      clock.tick(16); // t=0 frame
      for (let i = 0; i < 12; i++) clock.tick(16);
      return last;
    })();
    const b = (() => {
      let last = NaN;
      spring({ from: 0, to: 100, reducedMotion: false, onUpdate: (v) => (last = v) });
      clock.tick(8);
      for (let i = 0; i < 24; i++) clock.tick(8);
      return last;
    })();
    expect(a).toBeCloseTo(b, 6);
  });

  it("can be cancelled: no more updates, no onDone", () => {
    const values: number[] = [];
    let done = 0;
    const h = spring({
      from: 0,
      to: 100,
      reducedMotion: false,
      onUpdate: (v) => values.push(v),
      onDone: () => done++,
    });
    clock.tick();
    clock.tick();
    h.cancel();
    const n = values.length;
    for (let i = 0; i < 60; i++) clock.tick();
    expect(values.length).toBe(n);
    expect(done).toBe(0);
    expect(clock.pending()).toBe(0);
  });

  it("jumps straight to the target with reduced motion, without scheduling frames", () => {
    const values: number[] = [];
    let done = 0;
    spring({ from: 0, to: 100, velocity: 500, reducedMotion: true, onUpdate: (v) => values.push(v), onDone: () => done++ });
    expect(values).toEqual([100]);
    expect(done).toBe(1);
    expect(clock.pending()).toBe(0);
  });

  it("honours the prefers-reduced-motion media query by default", () => {
    const g = globalThis as unknown as { matchMedia?: unknown };
    const saved = g.matchMedia;
    g.matchMedia = (q: string) => ({ matches: q.includes("reduce") });
    try {
      const values: number[] = [];
      spring({ from: 0, to: 50, onUpdate: (v) => values.push(v) });
      expect(values).toEqual([50]);
      expect(clock.pending()).toBe(0);
    } finally {
      g.matchMedia = saved;
    }
  });
});
