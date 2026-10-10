import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipWarmth } from "./tooltip";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("TooltipWarmth (the prototype's .dock.warm)", () => {
  it("starts cold", () => {
    expect(new TooltipWarmth().warm).toBe(false);
  });

  it("goes warm exactly 420ms after the pointer goes over a trigger", () => {
    const w = new TooltipWarmth();
    w.pointerOver();
    vi.advanceTimersByTime(419);
    expect(w.warm).toBe(false);
    vi.advanceTimersByTime(1);
    expect(w.warm).toBe(true);
  });

  it("goes cold 250ms after the pointer leaves the whole group", () => {
    const w = new TooltipWarmth();
    w.pointerOver();
    vi.advanceTimersByTime(420);
    w.leaveGroup();
    vi.advanceTimersByTime(249);
    expect(w.warm).toBe(true);
    vi.advanceTimersByTime(1);
    expect(w.warm).toBe(false);
  });

  it("re-entering the group within the cool-down keeps it warm", () => {
    const w = new TooltipWarmth();
    w.pointerOver();
    vi.advanceTimersByTime(420);
    w.leaveGroup();
    vi.advanceTimersByTime(200);
    w.enterGroup();
    vi.advanceTimersByTime(10_000);
    expect(w.warm).toBe(true);
  });

  it("stays warm indefinitely while the group is not left, and hovering another trigger keeps it warm", () => {
    const w = new TooltipWarmth();
    w.pointerOver();
    vi.advanceTimersByTime(420);
    vi.advanceTimersByTime(60_000);
    expect(w.warm).toBe(true);
    w.pointerOver(); // moved to a neighbouring trigger
    vi.advanceTimersByTime(60_000);
    expect(w.warm).toBe(true);
  });

  it("leaving before the warm-up finishes means it never warms", () => {
    const w = new TooltipWarmth();
    w.pointerOver();
    vi.advanceTimersByTime(300);
    w.leaveGroup();
    vi.advanceTimersByTime(10_000);
    expect(w.warm).toBe(false);
  });

  it("honours custom timings", () => {
    const w = new TooltipWarmth(100, 50);
    w.pointerOver();
    vi.advanceTimersByTime(50);
    expect(w.warm).toBe(true);
    w.leaveGroup();
    vi.advanceTimersByTime(100);
    expect(w.warm).toBe(false);
  });
});
