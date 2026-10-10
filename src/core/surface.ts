/**
 * Surfaces (DESIGN §6): the thing the kit reviews.
 *
 * - Responsive: the live page itself. Screen space and page space are the same.
 * - Desktop / Tablet / Mobile: a same-origin iframe of the current URL (`?__proompter_frame=1`) scaled to fit
 *   inside a device bezel. Rects measured in the frame's document are projected to screen space by `toScreen`.
 *
 * Framework-free.
 */
import { isInKit } from "./resolve";

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** A real window: the host's, or a frame's (capture patches `fetch`, `XMLHttpRequest` and `console` on it). */
export type SurfaceWindow = Window & typeof globalThis;

/** What the rest of the kit (capture, snapshots) needs from a surface. The one definition; capture re-exports it. */
export interface Surface {
  doc: Document;
  win: SurfaceWindow;
  /** Project a rect measured in `doc` (CSS px) to screen space (what `position: fixed` overlays use). */
  toScreen(rect: Rect): Rect;
  /** Screen px per document px. 1 on the live page. */
  scale: number;
}

export type ViewportId = "responsive" | "desktop" | "tablet" | "mobile";

/** Order of the `1`-`4` shortcuts. */
export const VIEWPORT_ORDER: readonly ViewportId[] = ["responsive", "desktop", "tablet", "mobile"];

export interface ViewportSpec {
  id: ViewportId;
  label: string;
  /** Width, height in portrait orientation. Null for Responsive. */
  size: readonly [number, number] | null;
  /** Bezel thickness, px. */
  bezel: number;
  /** Outer radius of the bezel, px. */
  radius: number;
}

// Numbers from design/prototype.html (`layoutStage`).
export const VIEWPORTS: Record<ViewportId, ViewportSpec> = {
  responsive: { id: "responsive", label: "Responsive", size: null, bezel: 0, radius: 0 },
  desktop: { id: "desktop", label: "Desktop", size: [1440, 900], bezel: 8, radius: 14 },
  tablet: { id: "tablet", label: "Tablet", size: [834, 1194], bezel: 12, radius: 26 },
  mobile: { id: "mobile", label: "Mobile", size: [390, 844], bezel: 10, radius: 38 },
};

export const FRAME_PARAM = "__proompter_frame";

export const rectRight = (r: Rect) => r.left + r.width;
export const rectBottom = (r: Rect) => r.top + r.height;

/** Project `rect` (measured inside a scaled frame whose top-left sits at `origin` on screen). */
export function projectRect(rect: Rect, origin: { left: number; top: number }, scale: number): Rect {
  return {
    left: origin.left + rect.left * scale,
    top: origin.top + rect.top * scale,
    width: rect.width * scale,
    height: rect.height * scale,
  };
}

/** Viewport size, swapped when rotated. Null for Responsive. */
export function viewportSize(vp: ViewportId, rotated: boolean): { width: number; height: number } | null {
  const s = VIEWPORTS[vp].size;
  if (!s) return null;
  return rotated ? { width: s[1], height: s[0] } : { width: s[0], height: s[1] };
}

export interface Padding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/**
 * Space the device stage leaves around the bezel (prototype `.stage.device`).
 * A vertical (edge-docked) dock needs side room; narrow screens get small gutters and extra bottom room.
 */
export function stagePadding(opts: { dockVertical?: boolean; viewportWidth: number }): Padding {
  if (opts.dockVertical) return { top: 56, right: 104, bottom: 56, left: 104 };
  if (opts.viewportWidth <= 760) return { top: 56, right: 16, bottom: 132, left: 16 };
  return { top: 72, right: 32, bottom: 104, left: 32 };
}

export interface DeviceLayout {
  /** Frame CSS size (unscaled). */
  size: { width: number; height: number };
  scale: number;
  bezel: number;
  radius: number;
  /** Radius of the clip inside the bezel: `max(4, radius - bezel)`. */
  clipRadius: number;
  /** Outer size of the bezel box on screen. */
  wrap: { width: number; height: number };
}

/** Layout of a device frame inside a stage of `stage` px with `padding` around it. Null for Responsive. */
export function layoutDevice(opts: {
  viewport: ViewportId;
  rotated: boolean;
  stage: { width: number; height: number };
  padding: Padding;
}): DeviceLayout | null {
  const size = viewportSize(opts.viewport, opts.rotated);
  if (!size) return null;
  const { bezel, radius } = VIEWPORTS[opts.viewport];
  const avail = {
    width: opts.stage.width - opts.padding.left - opts.padding.right - bezel * 2,
    height: opts.stage.height - opts.padding.top - opts.padding.bottom - bezel * 2,
  };
  // `max(.15, min(1, availW / w, availH / h))`: never scaled up, never below 15%.
  const scale = Math.max(0.15, Math.min(1, avail.width / size.width, avail.height / size.height));
  return {
    size,
    scale,
    bezel,
    radius,
    clipRadius: Math.max(4, radius - bezel),
    wrap: { width: size.width * scale + bezel * 2, height: size.height * scale + bezel * 2 },
  };
}

/**
 * The current URL with `?__proompter_frame=1` appended to the query string as written (so the host's own
 * parameters are not re-encoded or reordered). The hash is kept.
 */
export function frameUrl(href: string): string {
  const u = new URL(href);
  if (u.searchParams.get(FRAME_PARAM) === "1") return u.toString();
  const hash = u.hash;
  u.hash = "";
  const base = u.toString();
  const sep = base.endsWith("?") ? "" : u.search ? "&" : "?";
  return `${base}${sep}${FRAME_PARAM}=1${hash}`;
}

// ---------------------------------------------------------------------------------------------------------
// Pick surfaces

/** A surface plus what the pick engine and overlay need. */
export interface PickSurface extends Surface {
  readonly kind: "page" | "frame";
  readonly viewport: ViewportId;
  /** The iframe element for device surfaces. */
  readonly frame: HTMLIFrameElement | null;
  /** Visible area of the surface on screen. Pins outside it are hidden; the box-select catcher covers it. */
  bounds(): Rect;
  /** Exact size entries record: the window for Responsive, the preset (rotated) for devices. */
  size(): { width: number; height: number };
  /** Scroll / resize / explicit `emitLayout()`. Coalesced to one callback per animation frame. */
  onLayout(cb: () => void): () => void;
  emitLayout(): void;
}

/** A layout notifier: `attach` wires the underlying events while at least one subscriber exists. */
function createLayoutBus(win: Window, attach: (emit: () => void) => () => void) {
  const subs = new Set<() => void>();
  let detach: (() => void) | null = null;
  let raf = 0;
  // An emit with nobody listening yet (fonts finishing before the overlay subscribes) is replayed on subscribe.
  let pending = false;
  const flush = () => {
    raf = 0;
    for (const cb of [...subs]) cb();
  };
  const emit = () => {
    if (subs.size === 0) {
      pending = true;
      return;
    }
    if (raf) return;
    raf = win.requestAnimationFrame(flush);
  };
  return {
    emit,
    subscribe(cb: () => void) {
      subs.add(cb);
      detach ??= attach(emit);
      if (pending) {
        pending = false;
        emit();
      }
      return () => {
        subs.delete(cb);
        if (subs.size === 0) {
          detach?.();
          detach = null;
          if (raf) win.cancelAnimationFrame(raf);
          raf = 0;
        }
      };
    },
  };
}

/** The live page as a surface (Responsive). */
export function createPageSurface(win: SurfaceWindow = window): PickSurface {
  const bus = createLayoutBus(win, (emit) => {
    win.addEventListener("scroll", emit, { capture: true, passive: true });
    win.addEventListener("resize", emit);
    return () => {
      win.removeEventListener("scroll", emit, { capture: true });
      win.removeEventListener("resize", emit);
    };
  });
  return {
    kind: "page",
    viewport: "responsive",
    frame: null,
    doc: win.document,
    win,
    scale: 1,
    toScreen: (r) => ({ left: r.left, top: r.top, width: r.width, height: r.height }),
    bounds: () => ({ left: 0, top: 0, width: win.innerWidth, height: win.innerHeight }),
    size: () => ({ width: win.innerWidth, height: win.innerHeight }),
    onLayout: bus.subscribe,
    emitLayout: bus.emit,
  };
}

/** The members of an iframe that `createFrameSurface` uses (lets tests pass a stand-in). */
export type FrameLike = Pick<
  HTMLIFrameElement,
  "contentDocument" | "contentWindow" | "getBoundingClientRect" | "offsetWidth" | "offsetHeight" | "ownerDocument"
>;

/**
 * A device iframe as a surface. Returns null when the frame's document is not reachable (cross-origin, or a
 * browser error page because of X-Frame-Options / CSP), so the caller can show the "can't be framed" notice.
 * Create a new surface after every frame load.
 */
export function createFrameSurface(frame: FrameLike, viewport: ViewportId): PickSurface | null {
  const reached = ((): { doc: Document; win: SurfaceWindow } | null => {
    try {
      const d = frame.contentDocument;
      const w = frame.contentWindow as SurfaceWindow | null; // `WindowProxy` is typed as a bare Window
      if (d) void d.documentElement; // touching it throws for cross-origin documents
      return d && w ? { doc: d, win: w } : null;
    } catch {
      return null;
    }
  })();
  if (!reached || reached.doc.URL.startsWith("chrome-error:")) return null;
  const { doc, win } = reached;
  const hostWin = frame.ownerDocument.defaultView ?? window;

  // The frame is laid out at the preset size and scaled with `transform` (origin 0 0), so the ratio of its
  // painted box to its layout box is the scale.
  const getScale = () => {
    const w = frame.offsetWidth;
    return w ? frame.getBoundingClientRect().width / w : 1;
  };

  const bus = createLayoutBus(hostWin, (emit) => {
    doc.addEventListener("scroll", emit, { capture: true, passive: true });
    win.addEventListener("resize", emit);
    hostWin.addEventListener("resize", emit);
    return () => {
      doc.removeEventListener("scroll", emit, { capture: true });
      win.removeEventListener("resize", emit);
      hostWin.removeEventListener("resize", emit);
    };
  });

  const surface: PickSurface = {
    kind: "frame",
    viewport,
    frame: frame as HTMLIFrameElement,
    doc,
    win,
    get scale() {
      return getScale();
    },
    toScreen: (r) => projectRect(r, frame.getBoundingClientRect(), getScale()),
    bounds: () => {
      const b = frame.getBoundingClientRect();
      return { left: b.left, top: b.top, width: b.width, height: b.height };
    },
    size: () => ({ width: frame.offsetWidth, height: frame.offsetHeight }),
    onLayout: bus.subscribe,
    emitLayout: bus.emit,
  };
  // Text reflows when the frame's web fonts arrive: re-measure pins and selections.
  void doc.fonts?.ready.then(bus.emit, () => {});
  return surface;
}

// ---------------------------------------------------------------------------------------------------------
// Freeze

/**
 * Pause animations and media inside the surface's document. Returns the function that restores them:
 * only what we paused is resumed, and anything the page cancelled, finished or paused itself in the meantime is
 * left alone.
 *
 * Covers CSS animations, transitions and Web Animations (`document.getAnimations()`), plus ones that start while
 * frozen (`animationstart` / `transitionrun` events, and a re-scan every animation frame for `el.animate()`),
 * and media that starts playing. The kit's own animations (inside `<proompter-root>`) are never touched.
 */
export function freezeSurface(surface: Pick<Surface, "doc">): () => void {
  const doc = surface.doc;
  const win = doc.defaultView;
  const animations = new Set<Animation>();
  const media = new Set<HTMLMediaElement>();

  const pauseAnimation = (a: Animation) => {
    const target = (a.effect as KeyframeEffect | null)?.target;
    if (target && isInKit(target)) return;
    if (a.playState !== "running") return;
    a.pause();
    animations.add(a);
  };
  const pauseMedia = (v: HTMLMediaElement) => {
    if (isInKit(v) || v.paused || v.ended) return;
    v.pause();
    media.add(v);
  };
  const sweep = () => {
    if (typeof doc.getAnimations === "function") doc.getAnimations().forEach(pauseAnimation);
  };

  sweep();
  doc.querySelectorAll("video,audio").forEach((v) => pauseMedia(v as HTMLMediaElement));

  const onStart = (e: Event) => {
    const t = e.target as Element | null;
    if (!t || t.nodeType !== 1 || isInKit(t) || typeof t.getAnimations !== "function") return;
    t.getAnimations().forEach(pauseAnimation);
  };
  const onPlay = (e: Event) => {
    const t = e.target as HTMLMediaElement | null;
    if (t && t.nodeType === 1 && typeof t.pause === "function") pauseMedia(t);
  };
  doc.addEventListener("animationstart", onStart, true);
  doc.addEventListener("transitionrun", onStart, true);
  doc.addEventListener("play", onPlay, true); // media events don't bubble, so capture

  // el.animate() and script-driven animations raise no event: catch them on the next frame, every frame.
  let raf = 0;
  const loop = () => {
    sweep();
    raf = win?.requestAnimationFrame(loop) ?? 0;
  };
  if (win) raf = win.requestAnimationFrame(loop);

  /** CSS-driven animations that the stylesheet itself holds paused (e.g. `:hover { animation-play-state: paused }`). */
  const heldByCss = (a: Animation) => {
    if (!("animationName" in a)) return false;
    const target = (a.effect as KeyframeEffect | null)?.target;
    if (!target || !win) return false;
    return win.getComputedStyle(target).animationPlayState.split(",").some((v) => v.trim() === "paused");
  };

  let done = false;
  return () => {
    if (done) return;
    done = true;
    if (raf && win) win.cancelAnimationFrame(raf);
    doc.removeEventListener("animationstart", onStart, true);
    doc.removeEventListener("transitionrun", onStart, true);
    doc.removeEventListener("play", onPlay, true);
    for (const a of animations) if (a.playState === "paused" && !heldByCss(a)) a.play();
    for (const v of media) void Promise.resolve(v.play()).catch(() => {});
    animations.clear();
    media.clear();
  };
}
