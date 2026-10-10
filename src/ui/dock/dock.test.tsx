import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast, Toaster } from "../primitives/toast";
import { mountInShadow, type Mounted } from "../test-utils";
import { Dock, type DockProps } from "./dock";
import { rubber, type DockPosition } from "./dock-math";
import { COLLAPSED_KEY, DOCK_KEY } from "./dock-storage";
import { getDockPlacement } from "./placement";

// happy-dom has no layout. The dock is 300x40 in a 1000x800 window; its rect follows its inline left/top.
const W = 300;
const H = 40;
const DEFAULT_LEFT = 350;
const DEFAULT_TOP = 740;

let m: Mounted | undefined;
let restores: Array<() => void> = [];
let now = 0;

function isDock(el: unknown): el is HTMLElement {
  return el instanceof HTMLElement && el.classList.contains("dock");
}

function stubLayout() {
  const rectSpy = vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    let l = 0;
    let t = 0;
    let w = 0;
    let h = 0;
    if (isDock(this)) {
      const left = parseFloat(this.style.left);
      const top = parseFloat(this.style.top);
      l = Number.isFinite(left) ? left : DEFAULT_LEFT;
      t = Number.isFinite(top) ? top : DEFAULT_TOP;
      w = W;
      h = H;
    }
    return { left: l, top: t, right: l + w, bottom: t + h, width: w, height: h, x: l, y: t, toJSON() {} } as DOMRect;
  });
  restores.push(() => rectSpy.mockRestore());
  for (const [prop, value] of [
    ["offsetWidth", W],
    ["offsetHeight", H],
  ] as const) {
    const saved = Object.getOwnPropertyDescriptor(HTMLElement.prototype, prop);
    Object.defineProperty(HTMLElement.prototype, prop, {
      configurable: true,
      get(this: HTMLElement) {
        return isDock(this) ? value : 0;
      },
    });
    restores.push(() => {
      if (saved) Object.defineProperty(HTMLElement.prototype, prop, saved);
      else delete (HTMLElement.prototype as unknown as Record<string, unknown>)[prop];
    });
  }
  for (const [prop, value] of [
    ["innerWidth", 1000],
    ["innerHeight", 800],
  ] as const) {
    const saved = Object.getOwnPropertyDescriptor(window, prop);
    Object.defineProperty(window, prop, { configurable: true, writable: true, value });
    restores.push(() => {
      if (saved) Object.defineProperty(window, prop, saved);
    });
  }
  const nowSpy = vi.spyOn(performance, "now").mockImplementation(() => now);
  restores.push(() => nowSpy.mockRestore());
}

function reduceMotion(reduced: boolean) {
  const g = globalThis as unknown as { matchMedia?: unknown };
  const saved = g.matchMedia;
  g.matchMedia = (q: string) => ({ matches: reduced && q.includes("reduce"), addEventListener() {}, removeEventListener() {} });
  restores.push(() => (g.matchMedia = saved));
}

/** A manual rAF clock for the spring. */
function rafClock() {
  let t = 0;
  let next = 1;
  const queue = new Map<number, FrameRequestCallback>();
  const g = globalThis as unknown as Record<string, unknown>;
  const saved = { raf: g.requestAnimationFrame, caf: g.cancelAnimationFrame };
  g.requestAnimationFrame = (cb: FrameRequestCallback) => {
    queue.set(next, cb);
    return next++;
  };
  g.cancelAnimationFrame = (id: number) => void queue.delete(id);
  restores.push(() => {
    g.requestAnimationFrame = saved.raf;
    g.cancelAnimationFrame = saved.caf;
  });
  return {
    run(maxFrames = 200) {
      for (let i = 0; i < maxFrames && queue.size; i++) {
        t += 16;
        const frames = [...queue.values()];
        queue.clear();
        act(() => {
          for (const cb of frames) cb(t);
        });
      }
    },
  };
}

beforeEach(() => {
  now = 0;
  localStorage.clear();
  stubLayout();
  reduceMotion(true);
});
afterEach(async () => {
  await m?.unmount();
  m = undefined;
  for (const r of restores.reverse()) r();
  restores = [];
  toast.clear();
  vi.unstubAllGlobals();
  localStorage.clear();
});

/** `at` and `collapsed` seed `localStorage` (the dock restores them on mount) before mounting. */
async function setup({ at, collapsed, ...props }: DockProps & { at?: DockPosition; collapsed?: boolean } = {}) {
  if (at) localStorage.setItem(DOCK_KEY, JSON.stringify(at));
  if (collapsed) localStorage.setItem(COLLAPSED_KEY, "1");
  m = await mountInShadow(
    <>
      <Dock {...props} />
      <Toaster />
    </>,
    { css: "" },
  );
  const q = <T extends Element = HTMLElement>(sel: string) => m!.shadow().querySelector<T>(sel)!;
  return {
    dock: q(".dock"),
    grip: q(".grip"),
    brand: q(".brand"),
    q,
    byLabel: (label: string) => q(`[aria-label="${label}"]`),
  };
}

function pointer(el: Element, type: string, x: number, y: number, t?: number, id = 1) {
  if (t !== undefined) now = t;
  act(() => {
    el.dispatchEvent(
      new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, pointerId: id, clientX: x, clientY: y }),
    );
  });
}
function key(el: Element, k: string) {
  const ev = new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true });
  act(() => void el.dispatchEvent(ev));
  return ev;
}
const left = (el: HTMLElement) => parseFloat(el.style.left);
const top = (el: HTMLElement) => parseFloat(el.style.top);

describe("Dock parts", () => {
  it("renders the toolbar parts in order", async () => {
    const { q } = await setup();
    const labels = Array.from(q(".dock").querySelectorAll("[aria-label]")).map((e) => e.getAttribute("aria-label"));
    expect(q(".dock").getAttribute("role")).toBe("toolbar");
    const names = labels.filter((l) => !l!.startsWith("Move toolbar"));
    expect(names).toEqual([
      "Collapse toolbar",
      "Pick element",
      "Select several elements",
      "Box select",
      "Quote text",
      "Page note",
      "Freeze animations",
      "Viewport",
      "Responsive",
      "Desktop",
      "Tablet",
      "Mobile",
      "Rotate device",
      "Command menu",
      "Entries",
    ]);
    expect(labels[0]).toMatch(/^Move toolbar/);
  });

  it("reports clicks and reflects state", async () => {
    const onTool = vi.fn();
    const onFreeze = vi.fn();
    const onViewport = vi.fn();
    const onRotate = vi.fn();
    const onCommand = vi.fn();
    const onEntries = vi.fn();
    const { byLabel, q } = await setup({
      activeTool: "multi",
      frozen: true,
      viewport: "desktop",
      openCount: 3,
      commandOpen: true,
      entriesOpen: false,
      onTool,
      onFreeze,
      onViewport,
      onRotate,
      onCommand,
      onEntries,
    });
    expect(byLabel("Select several elements").getAttribute("aria-pressed")).toBe("true");
    expect(byLabel("Pick element").getAttribute("aria-pressed")).toBe("false");
    expect(byLabel("Freeze animations").getAttribute("aria-pressed")).toBe("true");
    expect(byLabel("Desktop").getAttribute("aria-checked")).toBe("true");
    expect(byLabel("Entries, 3 open").querySelector(".badge")?.textContent).toBe("3");
    act(() => byLabel("Pick element").click());
    act(() => byLabel("Freeze animations").click());
    act(() => byLabel("Tablet").click());
    act(() => byLabel("Rotate device").click());
    act(() => byLabel("Command menu").click());
    act(() => byLabel("Entries, 3 open").click());
    expect(onTool).toHaveBeenCalledWith("pick");
    expect(onFreeze).toHaveBeenCalledTimes(1);
    expect(onViewport).toHaveBeenCalledWith("tablet");
    expect(onRotate).toHaveBeenCalledTimes(1);
    expect(onCommand).toHaveBeenCalledTimes(1);
    expect(onEntries).toHaveBeenCalledTimes(1);
    expect(q(".badge").textContent).toBe("3");
  });

  it("disables Rotate on the responsive viewport", async () => {
    const onRotate = vi.fn();
    const { byLabel } = await setup({ viewport: "responsive", onRotate });
    expect(byLabel("Rotate device").getAttribute("aria-disabled")).toBe("true");
    act(() => byLabel("Rotate device").click());
    expect(onRotate).not.toHaveBeenCalled();
  });

  it("announces the open count in the accessible names and hides the visual badges", async () => {
    const { byLabel, q, brand } = await setup({ openCount: 4 });
    expect(byLabel("Entries, 4 open")).toBeTruthy();
    expect(q(".lbadge").getAttribute("aria-hidden")).toBe("true");
    expect(brand.getAttribute("aria-label")).toBe("Collapse toolbar");
    key(brand, "Enter");
    expect(brand.getAttribute("aria-label")).toBe("Expand toolbar, 4 open entries");
  });

  it("shows no entries badge when nothing is open", async () => {
    const { byLabel } = await setup({ openCount: 0 });
    expect(byLabel("Entries").querySelector(".badge")).toBeNull();
  });
});

describe("keyboard steps on the grip", () => {
  it("moves 24px per arrow and prevents the default", async () => {
    const onPositionChange = vi.fn();
    const { grip, dock } = await setup({ at:{ x: 100, y: 200, edge: null }, onPositionChange });
    expect([left(dock), top(dock)]).toEqual([100, 200]);
    expect(key(grip, "ArrowRight").defaultPrevented).toBe(true);
    expect([left(dock), top(dock)]).toEqual([124, 200]);
    key(grip, "ArrowDown");
    expect([left(dock), top(dock)]).toEqual([124, 224]);
    key(grip, "ArrowLeft");
    key(grip, "ArrowLeft");
    expect(left(dock)).toBe(76);
    key(grip, "ArrowUp");
    expect(top(dock)).toBe(200);
    expect(onPositionChange).toHaveBeenLastCalledWith({ x: 76, y: 200, edge: null });
  });

  it("ignores other keys and stays 8px inside the window", async () => {
    const { grip, dock } = await setup({ at:{ x: 10, y: 10, edge: null } });
    expect(key(grip, "a").defaultPrevented).toBe(false);
    key(grip, "ArrowLeft");
    key(grip, "ArrowUp");
    expect([left(dock), top(dock)]).toEqual([8, 8]);
  });

  it("leaves a vertical bar for a floating dock, and saves the result", async () => {
    const { grip, dock } = await setup({ at:{ x: 12, y: 100, edge: "l" } });
    expect(dock.classList.contains("v")).toBe(true);
    key(grip, "ArrowDown");
    expect(dock.classList.contains("v")).toBe(false);
    expect(JSON.parse(localStorage.getItem(DOCK_KEY)!)).toEqual({ x: left(dock), y: top(dock), edge: null });
  });
});

describe("collapse (click under 4px)", () => {
  it("toggles on a click with tiny movement", async () => {
    const onCollapsedChange = vi.fn();
    const { brand, dock } = await setup({ onCollapsedChange });
    pointer(brand, "pointerdown", 100, 100);
    pointer(brand, "pointermove", 102, 101); // 2.2px
    pointer(brand, "pointerup", 102, 101);
    expect(dock.classList.contains("col")).toBe(true);
    expect(brand.getAttribute("aria-expanded")).toBe("false");
    expect(brand.getAttribute("aria-label")).toBe("Expand toolbar");
    expect(onCollapsedChange).toHaveBeenLastCalledWith(true);
    pointer(brand, "pointerdown", 100, 100);
    pointer(brand, "pointerup", 100, 100);
    expect(dock.classList.contains("col")).toBe(false);
    expect(onCollapsedChange).toHaveBeenLastCalledWith(false);
  });

  it("does not toggle once the pointer moved 4px", async () => {
    const onCollapsedChange = vi.fn();
    const { brand, dock } = await setup({ onCollapsedChange });
    pointer(brand, "pointerdown", 100, 100);
    pointer(brand, "pointermove", 104, 100);
    pointer(brand, "pointerup", 104, 100);
    expect(onCollapsedChange).not.toHaveBeenCalled();
    expect(dock.classList.contains("col")).toBe(false);
    expect(dock.classList.contains("free")).toBe(true); // it was a drag
  });

  it("toggles with Enter and Space", async () => {
    const { brand, dock } = await setup();
    const enter = key(brand, "Enter");
    expect(enter.defaultPrevented).toBe(true);
    expect(dock.classList.contains("col")).toBe(true);
    key(brand, " ");
    expect(dock.classList.contains("col")).toBe(false);
    key(brand, "Tab");
    expect(dock.classList.contains("col")).toBe(false);
  });

  it("shows the open count on the logo only when collapsed", async () => {
    const { q, brand } = await setup({ openCount: 4 });
    expect(q(".lbadge").hasAttribute("hidden")).toBe(true);
    key(brand, "Enter");
    expect(q(".lbadge").hasAttribute("hidden")).toBe(false);
    expect(q(".lbadge").textContent).toBe("4");
  });

  it("starts collapsed from the saved state", async () => {
    const { dock } = await setup({ collapsed: true });
    expect(dock.classList.contains("col")).toBe(true);
  });

  it("persists and restores the collapsed state", async () => {
    const first = await setup();
    key(first.brand, "Enter");
    expect(localStorage.getItem(COLLAPSED_KEY)).toBe("1");
    await m!.unmount();
    m = undefined;
    const second = await setup();
    expect(second.dock.classList.contains("col")).toBe(true);
  });
});

describe("drag", () => {
  it("follows the pointer 1:1 from the grab offset, then stays put when released inside the window", async () => {
    const onPositionChange = vi.fn();
    const { grip, dock } = await setup({ at:{ x: 100, y: 200, edge: null }, onPositionChange });
    pointer(grip, "pointerdown", 150, 215); // grab offset (50, 15)
    pointer(grip, "pointermove", 152, 216, 0); // under the slop: nothing yet
    expect(dock.classList.contains("dragging")).toBe(false);
    pointer(grip, "pointermove", 350, 315, 100);
    expect(dock.classList.contains("dragging")).toBe(true);
    expect([left(dock), top(dock)]).toEqual([300, 300]);
    pointer(grip, "pointerup", 350, 315, 1100); // no recent speed
    expect(dock.classList.contains("dragging")).toBe(false);
    expect([left(dock), top(dock)]).toEqual([300, 300]);
    expect(onPositionChange).toHaveBeenLastCalledWith({ x: 300, y: 300, edge: null });
  });

  it("starts from the default spot", async () => {
    const { grip, dock } = await setup();
    expect(dock.classList.contains("free")).toBe(false);
    pointer(grip, "pointerdown", 360, 750);
    pointer(grip, "pointermove", 460, 650, 100);
    expect(dock.classList.contains("free")).toBe(true);
    expect([left(dock), top(dock)]).toEqual([450, 640]);
  });

  it("rubber-bands past the window edge instead of following 1:1", async () => {
    const { grip, dock } = await setup({ at:{ x: 100, y: 200, edge: null } });
    pointer(grip, "pointerdown", 150, 215);
    pointer(grip, "pointermove", -200, 215, 100); // 1:1 would be x = -250
    expect(left(dock)).toBeCloseTo(8 - rubber(258, W), 6);
    expect(left(dock)).toBeLessThan(8);
    expect(left(dock)).toBeGreaterThan(-250);
  });

  it("releasing past the left edge snaps to the bar and settles inside the window", async () => {
    const { grip, dock } = await setup({ at:{ x: 100, y: 200, edge: null } });
    pointer(grip, "pointerdown", 150, 215);
    pointer(grip, "pointermove", -200, 215, 100);
    pointer(grip, "pointerup", -200, 215, 1100);
    expect(dock.classList.contains("edge-l")).toBe(true);
    expect(left(dock)).toBe(12);
  });

  it("releasing past the top edge eases back to the margin", async () => {
    const { grip, dock } = await setup({ at:{ x: 400, y: 300, edge: null } });
    pointer(grip, "pointerdown", 450, 315);
    pointer(grip, "pointermove", 450, -100, 100);
    expect(top(dock)).toBeLessThan(8);
    pointer(grip, "pointerup", 450, -100, 1100);
    expect(dock.classList.contains("v")).toBe(false);
    expect([left(dock), top(dock)]).toEqual([400, 8]);
  });

  it("snaps to the nearest side edge as a vertical bar when released within 72px", async () => {
    const onPositionChange = vi.fn();
    const { grip, dock } = await setup({ at:{ x: 400, y: 300, edge: null }, onPositionChange });
    pointer(grip, "pointerdown", 450, 315);
    pointer(grip, "pointermove", 200, 315, 0);
    pointer(grip, "pointermove", 60, 315, 1000); // slow
    pointer(grip, "pointerup", 60, 315, 2000);
    expect(dock.classList.contains("v")).toBe(true);
    expect(dock.classList.contains("edge-l")).toBe(true);
    expect(dock.getAttribute("data-placement")).toBe("vertical-left");
    expect(left(dock)).toBe(12);
    expect(onPositionChange).toHaveBeenLastCalledWith({ x: 12, y: 300, edge: "l" });
    expect(JSON.parse(localStorage.getItem(DOCK_KEY)!)).toEqual({ x: 12, y: 300, edge: "l" });
    expect(getDockPlacement()).toMatchObject({ mode: "vertical-left", tooltipSide: "right", sheetSide: "right" });
  });

  it("snaps to the right edge, and tooltips, toasts and the sheet follow", async () => {
    const { grip, dock } = await setup({ at:{ x: 400, y: 100, edge: null } });
    pointer(grip, "pointerdown", 450, 115);
    pointer(grip, "pointermove", 900, 115, 0);
    pointer(grip, "pointermove", 950, 115, 1000);
    pointer(grip, "pointerup", 950, 115, 2000);
    expect(dock.classList.contains("edge-r")).toBe(true);
    expect(left(dock)).toBe(1000 - W - 12);
    expect(getDockPlacement()).toMatchObject({ mode: "vertical-right", tooltipSide: "left", sheetSide: "left" });
  });

  it("projects a fast flick: a release far from the edge still snaps", async () => {
    const { grip, dock } = await setup({ at:{ x: 500, y: 300, edge: null } });
    pointer(grip, "pointerdown", 550, 315);
    for (const [i, x] of [500, 400, 350, 300, 250, 200].entries()) pointer(grip, "pointermove", x, 315, i * 16);
    pointer(grip, "pointerup", 200, 315, 80);
    expect(dock.classList.contains("edge-l")).toBe(true);
  });

  it("the same drag at slow speed does not snap", async () => {
    const { grip, dock } = await setup({ at:{ x: 500, y: 300, edge: null } });
    pointer(grip, "pointerdown", 550, 315);
    for (const [i, x] of [500, 400, 350, 300, 250, 200].entries()) pointer(grip, "pointermove", x, 315, i * 160);
    pointer(grip, "pointerup", 200, 315, 1000);
    expect(dock.classList.contains("v")).toBe(false);
    expect(left(dock)).toBe(150);
  });

  it("animates the snap with the spring when motion is allowed, and lands on the edge", async () => {
    reduceMotion(false);
    const clock = rafClock();
    const { grip, dock } = await setup({ at:{ x: 400, y: 300, edge: null } });
    pointer(grip, "pointerdown", 450, 315);
    pointer(grip, "pointermove", 200, 315, 0);
    pointer(grip, "pointermove", 60, 315, 1000);
    pointer(grip, "pointerup", 60, 315, 2000);
    expect(dock.classList.contains("edge-l")).toBe(true);
    expect(left(dock)).toBeCloseTo(10, 0); // still where the drag left it
    clock.run(2);
    expect(left(dock)).not.toBe(10);
    clock.run();
    expect(left(dock)).toBe(12);
  });

  it("leaving a vertical bar by dragging turns it into a floating dock under the pointer", async () => {
    const { grip, dock } = await setup({ at:{ x: 12, y: 100, edge: "l" } });
    expect(dock.classList.contains("v")).toBe(true);
    pointer(grip, "pointerdown", 30, 110);
    pointer(grip, "pointermove", 500, 400, 100);
    expect(dock.classList.contains("v")).toBe(false);
    expect(dock.classList.contains("free")).toBe(true);
    // offset x = min(grab y offset 10, half the width), y = half the height
    expect([left(dock), top(dock)]).toEqual([490, 380]);
  });

  it("a second pointer cannot hijack a live drag", async () => {
    const { grip, brand, dock } = await setup({ at:{ x: 100, y: 200, edge: null } });
    pointer(grip, "pointerdown", 150, 215, 0, 1);
    pointer(grip, "pointermove", 350, 315, 100, 1);
    expect([left(dock), top(dock)]).toEqual([300, 300]);
    pointer(brand, "pointerdown", 10, 10, 110, 2); // ignored: a drag is live
    pointer(grip, "pointermove", 700, 700, 120, 2); // wrong id: ignored
    pointer(grip, "pointerup", 700, 700, 130, 2); // wrong id: does not end the drag
    expect([left(dock), top(dock)]).toEqual([300, 300]);
    expect(dock.classList.contains("dragging")).toBe(true);
    pointer(grip, "pointermove", 360, 325, 140, 1);
    expect([left(dock), top(dock)]).toEqual([310, 310]);
    pointer(grip, "pointerup", 360, 325, 1200, 1);
    expect(dock.classList.contains("dragging")).toBe(false);
    // and the drag after it works normally
    pointer(brand, "pointerdown", 330, 330, 1300, 3);
    pointer(brand, "pointermove", 430, 330, 1400, 3);
    expect(dock.classList.contains("dragging")).toBe(true);
  });

  it("interrupting a settle keeps the live position in state, storage and the owner", async () => {
    reduceMotion(false);
    const clock = rafClock();
    const onPositionChange = vi.fn();
    const { grip, dock } = await setup({
      at:{ x: 400, y: 300, edge: null },
      onPositionChange,
    });
    pointer(grip, "pointerdown", 450, 315);
    pointer(grip, "pointermove", 200, 315, 0);
    pointer(grip, "pointermove", 60, 315, 1000);
    pointer(grip, "pointerup", 60, 315, 2000); // snap to the left bar, springing from x = 10 to 12
    clock.run(2);
    const live = left(dock);
    expect(live).not.toBe(12);
    pointer(grip, "pointerdown", 20, 20, 2100); // interrupts the settle
    const saved = JSON.parse(localStorage.getItem(DOCK_KEY)!);
    expect(saved).toEqual({ x: live, y: top(dock), edge: "l" });
    expect(onPositionChange).toHaveBeenLastCalledWith(saved);
    expect(left(dock)).toBe(live); // it did not jump to the resting spot
    expect(dock.classList.contains("edge-l")).toBe(true);
    clock.run();
    expect(left(dock)).toBe(live); // the spring is really stopped
  });

  it("moves from the brand too", async () => {
    const { brand, dock } = await setup({ at:{ x: 100, y: 200, edge: null } });
    pointer(brand, "pointerdown", 120, 215);
    pointer(brand, "pointermove", 220, 315, 100);
    expect([left(dock), top(dock)]).toEqual([200, 300]);
  });

  it("ignores non-primary buttons", async () => {
    const { grip, dock } = await setup({ at:{ x: 100, y: 200, edge: null } });
    act(() => {
      grip.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 2, pointerId: 1, clientX: 110, clientY: 210 }));
    });
    pointer(grip, "pointermove", 300, 300, 100);
    expect([left(dock), top(dock)]).toEqual([100, 200]);
  });
});

describe("reset", () => {
  it("double-click returns to the bottom centre, clears storage and toasts", async () => {
    localStorage.setItem(DOCK_KEY, JSON.stringify({ x: 12, y: 100, edge: "l" }));
    const onPositionChange = vi.fn();
    const { grip, dock } = await setup({ onPositionChange });
    expect(dock.classList.contains("edge-l")).toBe(true);
    act(() => void grip.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
    expect(dock.classList.contains("free")).toBe(false);
    expect(dock.classList.contains("v")).toBe(false);
    expect(dock.style.left).toBe("");
    expect(localStorage.getItem(DOCK_KEY)).toBeNull();
    expect(onPositionChange).toHaveBeenLastCalledWith(null);
    expect(m!.shadow().querySelectorAll(".toast")).toHaveLength(1);
  });
});

describe("saved position", () => {
  it("restores from localStorage", async () => {
    localStorage.setItem(DOCK_KEY, JSON.stringify({ x: 222, y: 333, edge: null }));
    const { dock } = await setup();
    expect([left(dock), top(dock)]).toEqual([222, 333]);
  });

  it("survives storage that throws", async () => {
    const boom = () => {
      throw new Error("blocked");
    };
    vi.stubGlobal("localStorage", { getItem: boom, setItem: boom, removeItem: boom });
    const { dock, grip, brand } = await setup();
    expect(dock.classList.contains("free")).toBe(false);
    expect(dock.classList.contains("col")).toBe(false);
    key(brand, "Enter");
    expect(dock.classList.contains("col")).toBe(true);
    key(grip, "ArrowUp");
    expect(dock.classList.contains("free")).toBe(true);
  });
});

describe("placement", () => {
  it("publishes the rect and tooltip side for the default (lower) and an upper dock", async () => {
    await setup();
    expect(getDockPlacement()).toMatchObject({ mode: "horizontal", tooltipSide: "top", toastPosition: "top" });
    expect(getDockPlacement().rect).toMatchObject({ left: 350, top: 740, width: 300, height: 40 });
    await m!.unmount();
    m = undefined;
    await setup({ at:{ x: 100, y: 20, edge: null } });
    expect(getDockPlacement()).toMatchObject({ mode: "horizontal", tooltipSide: "bottom", toastPosition: "bottom" });
  });

  it("goes back to the default when the dock unmounts", async () => {
    await setup({ at:{ x: 12, y: 100, edge: "r" } });
    expect(getDockPlacement().mode).toBe("vertical-right");
    await m!.unmount();
    m = undefined;
    expect(getDockPlacement().rect).toBeNull();
  });
});
