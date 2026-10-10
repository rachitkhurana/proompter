import { afterEach, describe, expect, it, vi } from "vitest";
import {
  COLLAPSED_KEY,
  DOCK_KEY,
  loadCollapsed,
  loadPosition,
  saveCollapsed,
  savePosition,
} from "./dock-storage";

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

const throwing = () => {
  throw new Error("blocked");
};

describe("dock storage", () => {
  it("uses the prototype's keys", () => {
    expect(DOCK_KEY).toBe("proompter.dock");
    expect(COLLAPSED_KEY).toBe("proompter.collapsed");
  });

  it("round-trips position and collapsed state", () => {
    expect(loadPosition()).toBeNull();
    savePosition({ x: 10, y: 20, edge: "r" });
    expect(localStorage.getItem(DOCK_KEY)).toBe('{"x":10,"y":20,"edge":"r"}');
    expect(loadPosition()).toEqual({ x: 10, y: 20, edge: "r" });
    savePosition(null);
    expect(localStorage.getItem(DOCK_KEY)).toBeNull();

    expect(loadCollapsed()).toBe(false);
    saveCollapsed(true);
    expect(localStorage.getItem(COLLAPSED_KEY)).toBe("1");
    expect(loadCollapsed()).toBe(true);
    saveCollapsed(false);
    expect(localStorage.getItem(COLLAPSED_KEY)).toBe("0");
    expect(loadCollapsed()).toBe(false);
  });

  it("ignores corrupt data", () => {
    localStorage.setItem(DOCK_KEY, "{not json");
    expect(loadPosition()).toBeNull();
    localStorage.setItem(DOCK_KEY, '{"x":"a"}');
    expect(loadPosition()).toBeNull();
  });

  it("never throws when storage does", () => {
    vi.stubGlobal("localStorage", { getItem: throwing, setItem: throwing, removeItem: throwing });
    expect(loadPosition()).toBeNull();
    expect(loadCollapsed()).toBe(false);
    expect(() => savePosition({ x: 1, y: 2, edge: null })).not.toThrow();
    expect(() => savePosition(null)).not.toThrow();
    expect(() => saveCollapsed(true)).not.toThrow();
  });

  it("never throws when the localStorage accessor itself throws", () => {
    vi.stubGlobal("localStorage", undefined);
    expect(loadPosition()).toBeNull();
    expect(loadCollapsed()).toBe(false);
    expect(() => saveCollapsed(true)).not.toThrow();
  });
});
