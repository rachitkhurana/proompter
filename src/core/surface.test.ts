import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createFrameSurface,
  createPageSurface,
  frameUrl,
  freezeSurface,
  layoutDevice,
  projectRect,
  stagePadding,
  viewportSize,
  type FrameLike,
  type Rect,
} from "./surface";

afterEach(() => {
  document.body.innerHTML = "";
  delete (document as { getAnimations?: unknown }).getAnimations;
});

const domRect = (left: number, top: number, width: number, height: number) =>
  ({ x: left, y: top, left, top, width, height, right: left + width, bottom: top + height, toJSON: () => ({}) }) as DOMRect;

/** An iframe stand-in whose box and layout size we can change, like the real one after rotate or refit. */
function fakeFrame(init: { left: number; top: number; layoutW: number; layoutH: number; scale: number }) {
  const state = { ...init };
  const frame = {
    contentDocument: document as Document | null,
    contentWindow: window as Window | null,
    ownerDocument: document,
    get offsetWidth() {
      return state.layoutW;
    },
    get offsetHeight() {
      return state.layoutH;
    },
    getBoundingClientRect: () => domRect(state.left, state.top, state.layoutW * state.scale, state.layoutH * state.scale),
  };
  return { frame: frame as unknown as FrameLike & { contentDocument: Document | null }, state, raw: frame };
}

describe("projectRect", () => {
  it("scales then offsets", () => {
    const r: Rect = { left: 10, top: 20, width: 100, height: 40 };
    expect(projectRect(r, { left: 200, top: 100 }, 0.5)).toEqual({ left: 205, top: 110, width: 50, height: 20 });
  });
  it("is the identity at scale 1 with a zero origin", () => {
    const r: Rect = { left: 3, top: 4, width: 5, height: 6 };
    expect(projectRect(r, { left: 0, top: 0 }, 1)).toEqual(r);
  });
});

describe("device layout", () => {
  const stage = { width: 1280, height: 720 };
  const padding = stagePadding({ viewportWidth: 1280 });

  it("uses the prototype presets", () => {
    expect(viewportSize("desktop", false)).toEqual({ width: 1440, height: 900 });
    expect(viewportSize("tablet", false)).toEqual({ width: 834, height: 1194 });
    expect(viewportSize("mobile", false)).toEqual({ width: 390, height: 844 });
    expect(viewportSize("responsive", false)).toBeNull();
  });

  it("rotate swaps width and height", () => {
    expect(viewportSize("mobile", true)).toEqual({ width: 844, height: 390 });
  });

  it("fits Mobile inside the stage: scale = min(1, availW / w, availH / h)", () => {
    const l = layoutDevice({ viewport: "mobile", rotated: false, stage, padding })!;
    const availH = 720 - 72 - 104 - 20; // stage - padding - 2 * bezel(10)
    expect(l.scale).toBeCloseTo(availH / 844, 10);
    expect(l.bezel).toBe(10);
    expect(l.radius).toBe(38);
    expect(l.clipRadius).toBe(28);
    expect(l.wrap.width).toBeCloseTo(390 * l.scale + 20, 10);
    expect(l.wrap.height).toBeCloseTo(844 * l.scale + 20, 10);
  });

  it("rotating Mobile makes it landscape and refits (landscape fits at 100% here)", () => {
    const l = layoutDevice({ viewport: "mobile", rotated: true, stage, padding })!;
    expect(l.size).toEqual({ width: 844, height: 390 });
    expect(l.scale).toBe(1);
    expect(l.wrap).toEqual({ width: 864, height: 410 });
  });

  it("never scales up and never below 15%", () => {
    expect(layoutDevice({ viewport: "mobile", rotated: false, stage: { width: 4000, height: 4000 }, padding })!.scale).toBe(1);
    expect(layoutDevice({ viewport: "desktop", rotated: false, stage: { width: 100, height: 100 }, padding })!.scale).toBe(0.15);
  });

  it("Desktop and Tablet bezels", () => {
    const d = layoutDevice({ viewport: "desktop", rotated: false, stage, padding })!;
    expect([d.bezel, d.radius, d.clipRadius]).toEqual([8, 14, 6]);
    const t = layoutDevice({ viewport: "tablet", rotated: false, stage, padding })!;
    expect([t.bezel, t.radius, t.clipRadius]).toEqual([12, 26, 14]);
  });

  it("is null for Responsive", () => {
    expect(layoutDevice({ viewport: "responsive", rotated: false, stage, padding })).toBeNull();
  });

  it("leaves side room for a vertical dock and small gutters on narrow screens", () => {
    expect(stagePadding({ viewportWidth: 1280 })).toEqual({ top: 72, right: 32, bottom: 104, left: 32 });
    expect(stagePadding({ viewportWidth: 1280, dockVertical: true })).toEqual({ top: 56, right: 104, bottom: 56, left: 104 });
    expect(stagePadding({ viewportWidth: 700 })).toEqual({ top: 56, right: 16, bottom: 132, left: 16 });
    expect(stagePadding({ viewportWidth: 700, dockVertical: true })).toEqual({ top: 56, right: 104, bottom: 56, left: 104 });
  });
});

describe("frameUrl", () => {
  it("adds the frame flag, keeping path, query and hash", () => {
    expect(frameUrl("http://localhost:3100/feeds?tab=hot#top")).toBe(
      "http://localhost:3100/feeds?tab=hot&__proompter_frame=1#top",
    );
  });
  it("leaves the host's own query string exactly as written", () => {
    expect(frameUrl("http://x.test/a?q=a+b&r=%7E&s=%2F&flag")).toBe(
      "http://x.test/a?q=a+b&r=%7E&s=%2F&flag&__proompter_frame=1",
    );
    expect(frameUrl("http://x.test/a?")).toBe("http://x.test/a?__proompter_frame=1");
    expect(frameUrl("http://x.test/#/route?x=1")).toBe("http://x.test/?__proompter_frame=1#/route?x=1");
  });
  it("does not duplicate the flag", () => {
    expect(frameUrl("http://x.test/?__proompter_frame=1")).toBe("http://x.test/?__proompter_frame=1");
  });
});

describe("frame surface", () => {
  it("projects rects with the frame's origin and scale", () => {
    const { frame } = fakeFrame({ left: 200, top: 100, layoutW: 390, layoutH: 844, scale: 0.5 });
    const s = createFrameSurface(frame, "mobile")!;
    expect(s.kind).toBe("frame");
    expect(s.viewport).toBe("mobile");
    expect(s.scale).toBe(0.5);
    expect(s.toScreen({ left: 10, top: 20, width: 100, height: 40 })).toEqual({ left: 205, top: 110, width: 50, height: 20 });
  });

  it("follows the frame when it rotates and refits (toScreen is live)", () => {
    const { frame, state } = fakeFrame({ left: 200, top: 100, layoutW: 390, layoutH: 844, scale: 0.5 });
    const s = createFrameSurface(frame, "mobile")!;
    // Rotate: landscape, fits at 100%, and the bezel moves.
    Object.assign(state, { left: 40, top: 60, layoutW: 844, layoutH: 390, scale: 1 });
    expect(s.scale).toBe(1);
    expect(s.size()).toEqual({ width: 844, height: 390 });
    expect(s.bounds()).toEqual({ left: 40, top: 60, width: 844, height: 390 });
    expect(s.toScreen({ left: 10, top: 20, width: 100, height: 40 })).toEqual({ left: 50, top: 80, width: 100, height: 40 });
  });

  it("is null when the document can't be reached (framing refused)", () => {
    const a = fakeFrame({ left: 0, top: 0, layoutW: 1, layoutH: 1, scale: 1 });
    a.raw.contentDocument = null;
    expect(createFrameSurface(a.frame, "mobile")).toBeNull();

    const b = fakeFrame({ left: 0, top: 0, layoutW: 1, layoutH: 1, scale: 1 });
    Object.defineProperty(b.raw, "contentDocument", {
      get() {
        throw new DOMException("Blocked a frame from accessing a cross-origin frame.", "SecurityError");
      },
    });
    expect(createFrameSurface(b.frame, "mobile")).toBeNull();

    const c = fakeFrame({ left: 0, top: 0, layoutW: 1, layoutH: 1, scale: 1 });
    c.raw.contentDocument = { URL: "chrome-error://chromewebdata/", documentElement: {} } as unknown as Document;
    expect(createFrameSurface(c.frame, "mobile")).toBeNull();
  });

  it("re-measures once the frame's fonts are ready, even if that happens before anyone subscribes", async () => {
    const { frame } = fakeFrame({ left: 0, top: 0, layoutW: 10, layoutH: 10, scale: 1 });
    Object.defineProperty(document, "fonts", { configurable: true, value: { ready: Promise.resolve() } });
    try {
      const s = createFrameSurface(frame, "mobile")!;
      await Promise.resolve();
      await Promise.resolve();
      const cb = vi.fn();
      const off = s.onLayout(cb);
      await vi.waitFor(() => expect(cb).toHaveBeenCalledTimes(1));
      off();
    } finally {
      delete (document as { fonts?: unknown }).fonts;
    }
  });

  it("coalesces layout events into one callback per frame", async () => {
    const { frame } = fakeFrame({ left: 0, top: 0, layoutW: 10, layoutH: 10, scale: 1 });
    const s = createFrameSurface(frame, "mobile")!;
    const cb = vi.fn();
    const off = s.onLayout(cb);
    document.dispatchEvent(new Event("scroll"));
    document.dispatchEvent(new Event("scroll"));
    s.emitLayout();
    await vi.waitFor(() => expect(cb).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 40));
    expect(cb).toHaveBeenCalledTimes(1);
    off();
    s.emitLayout();
    await new Promise((r) => setTimeout(r, 40));
    expect(cb).toHaveBeenCalledTimes(1);
  });
});

describe("page surface", () => {
  it("is the live page: identity projection at scale 1", () => {
    const s = createPageSurface(window);
    expect(s.kind).toBe("page");
    expect(s.viewport).toBe("responsive");
    expect(s.doc).toBe(document);
    expect(s.win).toBe(window);
    expect(s.scale).toBe(1);
    expect(s.toScreen({ left: 5, top: 6, width: 7, height: 8 })).toEqual({ left: 5, top: 6, width: 7, height: 8 });
    expect(s.bounds()).toEqual({ left: 0, top: 0, width: window.innerWidth, height: window.innerHeight });
  });

  it("reports scroll and resize", async () => {
    const s = createPageSurface(window);
    const cb = vi.fn();
    const off = s.onLayout(cb);
    window.dispatchEvent(new Event("scroll"));
    await vi.waitFor(() => expect(cb).toHaveBeenCalledTimes(1));
    window.dispatchEvent(new Event("resize"));
    await vi.waitFor(() => expect(cb).toHaveBeenCalledTimes(2));
    off();
  });
});

// ---------------------------------------------------------------------------------------------------------

interface FakeAnim {
  playState: "running" | "paused" | "idle" | "finished";
  effect: { target: Element } | null;
  pause: ReturnType<typeof vi.fn>;
  play: ReturnType<typeof vi.fn>;
}

function anim(playState: FakeAnim["playState"], target?: Element): FakeAnim {
  const a: FakeAnim = {
    playState,
    effect: target ? { target } : null,
    pause: vi.fn(() => void (a.playState = "paused")),
    play: vi.fn(() => void (a.playState = "running")),
  };
  return a;
}

function provide(list: FakeAnim[]) {
  Object.defineProperty(document, "getAnimations", { configurable: true, value: () => list });
}

describe("freezeSurface", () => {
  it("pauses running animations and resumes exactly those", () => {
    const running = anim("running");
    const already = anim("paused");
    const done = anim("finished");
    provide([running, already, done]);
    const unfreeze = freezeSurface({ doc: document });
    expect(running.pause).toHaveBeenCalledTimes(1);
    expect(already.pause).not.toHaveBeenCalled();
    expect(done.pause).not.toHaveBeenCalled();
    unfreeze();
    expect(running.play).toHaveBeenCalledTimes(1);
    expect(already.play).not.toHaveBeenCalled(); // the page paused it, not us
    expect(done.play).not.toHaveBeenCalled();
  });

  it("does not resume an animation the page cancelled meanwhile", () => {
    const a = anim("running");
    provide([a]);
    const unfreeze = freezeSurface({ doc: document });
    a.playState = "idle";
    unfreeze();
    expect(a.play).not.toHaveBeenCalled();
  });

  it("leaves the kit's own animations alone", () => {
    document.body.innerHTML = `<div id="page">page</div><proompter-root></proompter-root>`;
    const shadow = document.querySelector("proompter-root")!.attachShadow({ mode: "open" });
    shadow.innerHTML = `<div id="kit">kit</div>`;
    const page = anim("running", document.getElementById("page")!);
    const kit = anim("running", shadow.getElementById("kit")!);
    provide([page, kit]);
    const unfreeze = freezeSurface({ doc: document });
    expect(page.pause).toHaveBeenCalled();
    expect(kit.pause).not.toHaveBeenCalled();
    unfreeze();
    expect(kit.play).not.toHaveBeenCalled();
  });

  it("pauses animations that start while frozen, and stops listening afterwards", () => {
    provide([]);
    document.body.innerHTML = `<div id="late">x</div>`;
    const el = document.getElementById("late")!;
    const late = anim("running", el);
    (el as unknown as { getAnimations: () => FakeAnim[] }).getAnimations = () => [late];
    const unfreeze = freezeSurface({ doc: document });
    el.dispatchEvent(new Event("animationstart", { bubbles: true }));
    expect(late.pause).toHaveBeenCalledTimes(1);
    unfreeze();
    expect(late.play).toHaveBeenCalledTimes(1);
    late.playState = "running";
    el.dispatchEvent(new Event("animationstart", { bubbles: true }));
    expect(late.pause).toHaveBeenCalledTimes(1);
  });

  it("pauses playing videos and restarts only those", async () => {
    document.body.innerHTML = `<video id="a"></video><video id="b"></video>`;
    const mk = (id: string, paused: boolean) => {
      const v = document.getElementById(id) as HTMLVideoElement;
      Object.defineProperty(v, "paused", { configurable: true, value: paused });
      Object.defineProperty(v, "ended", { configurable: true, value: false });
      v.pause = vi.fn();
      v.play = vi.fn(() => Promise.resolve());
      return v;
    };
    const playing = mk("a", false);
    const stopped = mk("b", true);
    provide([]);
    const unfreeze = freezeSurface({ doc: document });
    expect(playing.pause).toHaveBeenCalledTimes(1);
    expect(stopped.pause).not.toHaveBeenCalled();
    unfreeze();
    expect(playing.play).toHaveBeenCalledTimes(1);
    expect(stopped.play).not.toHaveBeenCalled();
  });

  it("hands a CSS animation back to the stylesheet when the stylesheet is holding it paused", () => {
    document.body.innerHTML = `<div id="t">x</div>`;
    const t = document.getElementById("t")!;
    const css = Object.assign(anim("running", t), { animationName: "spin" });
    const free = Object.assign(anim("running", t), { animationName: "fade" });
    provide([css, free]);
    const spy = vi.spyOn(window, "getComputedStyle").mockReturnValue({ animationPlayState: "paused" } as CSSStyleDeclaration);
    const unfreeze = freezeSurface({ doc: document });
    unfreeze();
    expect(css.play).not.toHaveBeenCalled(); // skipped: both are held by CSS here
    expect(free.play).not.toHaveBeenCalled();
    spy.mockReturnValue({ animationPlayState: "running" } as CSSStyleDeclaration);
    const again = anim("running", t);
    Object.assign(again, { animationName: "spin" });
    provide([again]);
    freezeSurface({ doc: document })();
    expect(again.play).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it("pauses media that starts playing while frozen", () => {
    document.body.innerHTML = `<video id="v"></video>`;
    const v = document.getElementById("v") as HTMLVideoElement;
    Object.defineProperty(v, "paused", { configurable: true, value: false });
    Object.defineProperty(v, "ended", { configurable: true, value: false });
    v.pause = vi.fn();
    v.play = vi.fn(() => Promise.resolve());
    provide([]);
    const unfreeze = freezeSurface({ doc: document });
    expect(v.pause).toHaveBeenCalledTimes(1); // was playing
    (v.pause as ReturnType<typeof vi.fn>).mockClear();
    v.dispatchEvent(new Event("play")); // the page restarted it
    expect(v.pause).toHaveBeenCalledTimes(1);
    unfreeze();
    expect(v.play).toHaveBeenCalledTimes(1);
  });

  it("catches animations started with el.animate() while frozen (no event fires for them)", async () => {
    const list: FakeAnim[] = [];
    provide(list);
    const unfreeze = freezeSurface({ doc: document });
    const late = anim("running");
    list.push(late);
    await vi.waitFor(() => expect(late.pause).toHaveBeenCalled());
    unfreeze();
    expect(late.play).toHaveBeenCalledTimes(1);
  });

  it("unfreezing twice is harmless", () => {
    const a = anim("running");
    provide([a]);
    const unfreeze = freezeSurface({ doc: document });
    unfreeze();
    unfreeze();
    expect(a.play).toHaveBeenCalledTimes(1);
  });
});
