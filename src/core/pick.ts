/**
 * Pick engine (DESIGN §4, T04): modes, hover, tree walk, multi-select, box select, text quote, page note.
 *
 * Framework-free. It attaches listeners to the surface's document (the live page or the device iframe), keeps an
 * immutable snapshot for the UI (`useSyncExternalStore`-compatible), and reports finished picks through
 * `onCommit`. It never draws anything; the overlay does.
 */
import {
  describeTarget,
  eventElement,
  isInKit,
  parentTarget,
  resolveTarget,
  targetFor,
  type ResolvedTarget,
  type TargetInfo,
} from "./resolve";
import { rectBottom, rectRight, type PickSurface, type Rect } from "./surface";

export type PickMode = "idle" | "pick" | "multi" | "box" | "text" | "note";

export type PickCommit =
  | { kind: "element"; target: ResolvedTarget }
  | { kind: "multi"; targets: ResolvedTarget[] }
  | { kind: "box"; targets: ResolvedTarget[]; rect: Rect }
  | { kind: "text"; quote: string; target: ResolvedTarget | null; rect: Rect }
  | { kind: "note" };

export interface PickHover {
  target: TargetInfo;
  /** How many steps up the tree the user has walked (the label shows `↓N`). */
  walked: number;
}

export interface PickSnapshot {
  mode: PickMode;
  /** True while a composer is open: hover and clicks are ignored so the target stays put. */
  busy: boolean;
  hover: PickHover | null;
  /** Multi-select, in click order (badge 1, 2, ...). */
  multi: readonly ResolvedTarget[];
}

export interface PickEngineOptions {
  onCommit(commit: PickCommit): void;
  onModeChange?(mode: PickMode): void;
  /**
   * Esc leaves the current mode (default true). Esc pressed inside the kit's own UI is ignored either way, so a
   * central handler can close menus, the composer and the command menu first.
   */
  escapeExits?: boolean;
  /** Keys pressed inside a device iframe that the engine did not use. The host document never sees them. */
  forwardKey?(ev: KeyboardEvent): void;
}

/** Smallest box-select drag, px, on both sides. */
export const MIN_BOX = 8;
/** Longest quote kept from a text selection. */
export const MAX_QUOTE = 200;

const TYPING = "input,textarea,select,[contenteditable]";
/** Events the page must not see while picking an element (clicks are handled separately). */
const BLOCKED = ["pointerdown", "mousedown", "pointerup", "mouseup", "touchstart", "dblclick", "auxclick", "contextmenu"];
const CROSSHAIR_STYLE = "data-proompter-pick";

/** The rect between two screen points, whichever way the drag went. */
export function dragRect(a: { x: number; y: number }, b: { x: number; y: number }): Rect {
  return {
    left: Math.min(a.x, b.x),
    top: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}

/**
 * Box select: every stamped element fully inside `screenRect`, keeping only the topmost ones (an element whose
 * stamped ancestor is also inside is dropped).
 */
export function boxTargets(surface: PickSurface, screenRect: Rect): Element[] {
  const hits = new Set<Element>();
  surface.doc.querySelectorAll("[data-src]").forEach((el) => {
    if (isInKit(el)) return;
    const raw = el.getBoundingClientRect();
    if (!raw.width) return;
    const r = surface.toScreen(raw);
    if (
      r.left >= screenRect.left &&
      rectRight(r) <= rectRight(screenRect) &&
      r.top >= screenRect.top &&
      rectBottom(r) <= rectBottom(screenRect)
    ) {
      hits.add(el);
    }
  });
  return [...hits].filter((el) => {
    for (let p = el.parentElement; p; p = p.parentElement) if (hits.has(p)) return false;
    return true;
  });
}

export class PickEngine {
  private readonly opts: PickEngineOptions;
  private surface: PickSurface | null = null;
  private snap: PickSnapshot = { mode: "idle", busy: false, hover: null, multi: [] };
  private readonly listeners = new Set<() => void>();
  /** Elements walked up from, so `↓` can return along the same path. */
  private walk: Element[] = [];
  private hoverEl: Element | null = null;
  private lastRaw: Element | null = null;
  private off: (() => void) | null = null;
  /** Whether the current mouse gesture started on the page (not on the kit). */
  private gestureInSurface = false;

  constructor(opts: PickEngineOptions) {
    this.opts = opts;
  }

  // -- store ---------------------------------------------------------------------------------------------

  readonly subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => void this.listeners.delete(cb);
  };

  readonly getSnapshot = (): PickSnapshot => this.snap;

  private set(patch: Partial<PickSnapshot>) {
    this.snap = { ...this.snap, ...patch };
    this.listeners.forEach((cb) => cb());
  }

  get mode(): PickMode {
    return this.snap.mode;
  }

  // -- surface -------------------------------------------------------------------------------------------

  /** Listen on this surface's document (null detaches). Call again whenever the surface changes. */
  attach(surface: PickSurface | null): void {
    this.off?.();
    this.off = null;
    this.surface = surface;
    this.clearHover();
    if (this.snap.multi.length) this.set({ multi: [] });
    if (!surface) return;

    const doc = surface.doc;
    const win = surface.win;
    const click = (e: Event) => this.onClick(e as MouseEvent);
    const move = (e: Event) => this.onMove(e as MouseEvent);
    const down = (e: Event) => {
      this.gestureInSurface = !isInKit(eventElement(e));
    };
    const up = (e: Event) => this.onTextUp(e);
    const key = (e: Event) => this.onKey(e as KeyboardEvent, "surface");
    const hostKey = (e: Event) => this.onKey(e as KeyboardEvent, "host");
    const wheel = (e: Event) => this.onWheel(e as WheelEvent);
    const leave = () => this.clearHover();
    const block = (e: Event) => this.block(e);
    doc.addEventListener("mousemove", move);
    doc.addEventListener("mousedown", down, true);
    doc.addEventListener("click", click, true);
    doc.addEventListener("mouseup", up);
    doc.addEventListener("wheel", wheel, { passive: false });
    doc.documentElement.addEventListener("mouseleave", leave);
    // Capture on the window: the engine's keys never reach the host app, and Esc doesn't also close a host modal.
    win.addEventListener("keydown", key, true);
    // Focus stays in the host document when the surface is a device frame, so listen there too.
    const hostDoc = surface.kind === "frame" ? (surface.frame?.ownerDocument ?? null) : null;
    hostDoc?.addEventListener("keydown", hostKey, true);
    // While picking, the page must not react to the gesture: no menus, focus, drags or press handlers.
    for (const t of BLOCKED) win.addEventListener(t, block, { capture: true, passive: false });
    this.off = () => {
      doc.removeEventListener("mousemove", move);
      doc.removeEventListener("mousedown", down, true);
      doc.removeEventListener("click", click, true);
      doc.removeEventListener("mouseup", up);
      doc.removeEventListener("wheel", wheel);
      doc.documentElement.removeEventListener("mouseleave", leave);
      win.removeEventListener("keydown", key, true);
      hostDoc?.removeEventListener("keydown", hostKey, true);
      for (const t of BLOCKED) win.removeEventListener(t, block, true);
      this.setCrosshair(doc, false);
    };
    this.syncCrosshair();
  }

  dispose(): void {
    this.attach(null);
    this.listeners.clear();
  }

  // -- modes ---------------------------------------------------------------------------------------------

  setMode(next: PickMode): void {
    if (next === "note") {
      // A page note needs no target: report it and stay idle.
      this.clearHover();
      if (this.snap.mode !== "idle" || this.snap.multi.length) this.set({ mode: "idle", multi: [] });
      this.syncCrosshair();
      this.opts.onModeChange?.("idle");
      this.opts.onCommit({ kind: "note" });
      return;
    }
    if (next === this.snap.mode) return;
    this.clearHover();
    this.set({ mode: next, multi: next === "multi" ? this.snap.multi : [] });
    this.syncCrosshair();
    this.opts.onModeChange?.(next);
  }

  /** The dock buttons and `P M B T N`: pressing the active mode again leaves it. */
  toggleMode(m: PickMode): void {
    this.setMode(this.snap.mode === m ? "idle" : m);
  }

  /** Set while the composer is open: freezes hover and clicks. */
  setBusy(busy: boolean): void {
    if (busy !== this.snap.busy) this.set({ busy });
  }

  private get picking(): boolean {
    return this.snap.mode === "pick" || this.snap.mode === "multi";
  }

  // -- hover and tree walk -------------------------------------------------------------------------------

  private showHover(el: Element) {
    this.hoverEl = el;
    this.set({ hover: { target: describeTarget(el), walked: this.walk.length } });
  }

  private clearHover() {
    this.walk = [];
    this.lastRaw = null;
    this.hoverEl = null;
    if (this.snap.hover) this.set({ hover: null });
  }

  /** `↑` / `[` / Alt+wheel up. True when a hover exists (the key is used even at the top). */
  walkUp(): boolean {
    if (!this.hoverEl) return false;
    const p = parentTarget(this.hoverEl);
    if (!p) return true;
    this.walk.push(this.hoverEl);
    this.showHover(p);
    return true;
  }

  /** `↓` / `]` / Alt+wheel down: back along the walked path. */
  walkDown(): boolean {
    if (!this.hoverEl) return false;
    const c = this.walk.pop();
    if (c) this.showHover(c);
    return true;
  }

  private onMove(e: MouseEvent) {
    if (!this.picking || this.snap.busy) return;
    const raw = eventElement(e);
    if (!raw || isInKit(raw)) return this.clearHover();
    if (raw === this.lastRaw && this.hoverEl) return;
    this.lastRaw = raw;
    this.walk = [];
    const el = targetFor(raw);
    if (el) this.showHover(el);
    else this.clearHover();
  }

  private onWheel(e: WheelEvent) {
    if (!e.altKey || !this.picking || this.snap.busy || !this.hoverEl) return;
    const raw = eventElement(e);
    if (raw && isInKit(raw)) return;
    e.preventDefault();
    if (e.deltaY < 0) this.walkUp();
    else this.walkDown();
  }

  // -- commits -------------------------------------------------------------------------------------------

  private onClick(e: MouseEvent) {
    if (!this.picking) return;
    const raw = eventElement(e);
    if (!raw || isInKit(raw)) return; // our own UI keeps its clicks
    const hit = targetFor(raw);
    if (!hit) return;
    // Keep the element the user walked to, as long as the click is inside it.
    const el = this.hoverEl?.contains(hit) ? this.hoverEl : hit;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    if (this.snap.busy) return;
    const target = resolveTarget(el);
    if (this.snap.mode === "pick") {
      this.opts.onCommit({ kind: "element", target });
      return;
    }
    const has = this.snap.multi.some((t) => t.selector === target.selector);
    this.set({ multi: has ? this.snap.multi.filter((t) => t.selector !== target.selector) : [...this.snap.multi, target] });
  }

  clearMulti(): void {
    if (this.snap.multi.length) this.set({ multi: [] });
  }

  /** The "Add entry" button of the multi bar. */
  commitMulti(): void {
    if (this.snap.multi.length) this.opts.onCommit({ kind: "multi", targets: [...this.snap.multi] });
  }

  /** Called by the box-select catcher with the dragged rect in screen space. False when it was too small. */
  commitBox(screenRect: Rect): boolean {
    const s = this.surface;
    if (!s || this.snap.mode !== "box" || this.snap.busy) return false;
    if (screenRect.width < MIN_BOX || screenRect.height < MIN_BOX) return false;
    const targets = boxTargets(s, screenRect).map(resolveTarget);
    this.opts.onCommit({ kind: "box", targets, rect: screenRect });
    return true;
  }

  private block(e: Event) {
    if (!this.picking) return;
    const t = eventElement(e);
    if (!t || isInKit(t)) return;
    // preventDefault on touchstart would also cancel the click the touch turns into, which is how a tap picks.
    if (e.type !== "touchstart") e.preventDefault();
    e.stopImmediatePropagation();
  }

  private onTextUp(e: Event) {
    const s = this.surface;
    const started = this.gestureInSurface;
    this.gestureInSurface = false;
    if (!s || this.snap.mode !== "text" || this.snap.busy || !started) return;
    const raw = eventElement(e);
    if (raw && isInKit(raw)) return;
    const sel = s.doc.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
    const quote = sel.toString().trim();
    if (!quote) return;
    const anchor = sel.anchorNode;
    const n = anchor ? (anchor.nodeType === 1 ? (anchor as Element) : anchor.parentElement) : null;
    if (n && isInKit(n)) return;
    const el = n ? targetFor(n) : null;
    this.opts.onCommit({
      kind: "text",
      quote: quote.slice(0, MAX_QUOTE),
      target: el ? resolveTarget(el) : null,
      rect: s.toScreen(sel.getRangeAt(0).getBoundingClientRect()),
    });
  }

  // -- keyboard ------------------------------------------------------------------------------------------

  private onKey(ev: KeyboardEvent, from: "surface" | "host") {
    const t = eventElement(ev);
    // Our own UI (and its inputs) owns its keys: nothing here applies, and nothing is swallowed.
    if (t && isInKit(t)) return this.forward(ev, from);
    const consume = () => {
      ev.preventDefault();
      ev.stopImmediatePropagation();
    };
    if (ev.key === "Escape") {
      if (this.opts.escapeExits === false || this.snap.mode === "idle" || this.snap.busy) return this.forward(ev, from);
      consume();
      this.setMode("idle");
      return;
    }
    const typing = !!t && !!t.closest(TYPING);
    if (typing || ev.metaKey || ev.ctrlKey || ev.altKey) return this.forward(ev, from);
    if (this.picking && !this.snap.busy && this.hoverEl) {
      if (ev.key === "ArrowUp" || ev.key === "[") {
        consume();
        this.walkUp();
        return;
      }
      if (ev.key === "ArrowDown" || ev.key === "]") {
        consume();
        this.walkDown();
        return;
      }
    }
    this.forward(ev, from);
  }

  private forward(ev: KeyboardEvent, from: "surface" | "host") {
    if (from === "surface" && this.surface?.kind === "frame") this.opts.forwardKey?.(ev);
  }

  // -- cursor --------------------------------------------------------------------------------------------

  private syncCrosshair() {
    const s = this.surface;
    if (s) this.setCrosshair(s.doc, s.kind === "frame" && this.picking);
  }

  /**
   * Crosshair while picking. Only inside a device frame: on the live page the kit adds nothing to the host's
   * document (DESIGN §1.2), so Responsive relies on the hover box instead.
   */
  private setCrosshair(doc: Document, on: boolean) {
    const existing = doc.head?.querySelector(`style[${CROSSHAIR_STYLE}]`);
    if (!on) return existing?.remove();
    if (existing || !doc.head) return;
    const style = doc.createElement("style");
    style.setAttribute(CROSSHAIR_STYLE, "");
    style.textContent = "html,html *{cursor:crosshair!important}";
    doc.head.appendChild(style);
  }
}
