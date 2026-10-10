/**
 * Pure dock geometry, ported from design/prototype.html (startDrag / applyDock / grip keydown).
 * No DOM here, so every number is unit-tested.
 */

export type DockEdge = "l" | "r" | null;

/** Where the dock was left. `edge` set means a vertical bar pinned to that side. */
export interface DockPosition {
  x: number;
  y: number;
  edge: DockEdge;
}

export interface Size {
  w: number;
  h: number;
}

/** Keep this far from the window edge when floating. */
export const MARGIN = 8;
/** A vertical bar sits this far from its edge. */
export const EDGE_GAP = 12;
/** Releasing with the projected x within this distance of a side edge snaps to it. */
export const SNAP_DISTANCE = 72;
/** Less movement than this on release is a click, not a drag. */
export const CLICK_SLOP = 4;
/** Arrow keys on the grip move the dock this far. */
export const KEY_STEP = 24;
/** The default (reset) position sits this far above the bottom edge. */
export const DEFAULT_BOTTOM = 20;
/** Prototype: velocity projection uses a 0.99-per-ms decay (UIScrollView's "normal" deceleration). */
const DECELERATION = 0.99;
/** The release velocity handed to the spring is capped so a flick cannot throw it far off screen. */
export const MAX_RELEASE_SPEED = 3000;

/** The visible window: excludes scrollbars (clientWidth/Height), falling back to inner size without layout. */
export function viewportSize(): Size {
  const d = document.documentElement;
  return { w: d.clientWidth || window.innerWidth, h: d.clientHeight || window.innerHeight };
}

/** Soft resistance past a limit: `o` is how far past, `d` the dock's own extent along that axis. */
export function rubber(o: number, d: number, c = 0.55): number {
  return (o * d * c) / (d + c * Math.abs(o));
}

/** One axis of the drag: 1:1 inside [min, max], rubber-banded outside. */
export function rubberClamp(v: number, min: number, max: number, extent: number): number {
  if (v < min) return min - rubber(min - v, extent);
  if (v > max) return max + rubber(v - max, extent);
  return v;
}

/** The dock's top-left while dragging: 1:1 under the pointer from the grab offset, resisting past the edges. */
export function dragPosition(
  pointer: { x: number; y: number },
  offset: { x: number; y: number },
  size: Size,
  viewport: Size,
): { x: number; y: number } {
  return {
    x: rubberClamp(pointer.x - offset.x, MARGIN, viewport.w - size.w - MARGIN, size.w),
    y: rubberClamp(pointer.y - offset.y, MARGIN, viewport.h - size.h - MARGIN, size.h),
  };
}

/** Movement past the click slop turns a press into a drag. */
export function exceedsClickSlop(dx: number, dy: number): boolean {
  return Math.hypot(dx, dy) >= CLICK_SLOP;
}

export interface Sample {
  x: number;
  y: number;
  /** ms */
  t: number;
}

/** Keep the last 6 pointer samples, as the prototype does. */
export function pushSample(history: Sample[], s: Sample): void {
  history.push(s);
  if (history.length > 6) history.shift();
}

/** Samples older than this (relative to the last one) are ignored: a pause before release means no speed. */
export const VELOCITY_WINDOW_MS = 100;

/** Release velocity in px/s from the first and last recent sample (dt floored at 16ms). */
export function releaseVelocity(history: readonly Sample[]): { x: number; y: number } {
  const b = history[history.length - 1];
  const a = b ? history.find((s) => b.t - s.t <= VELOCITY_WINDOW_MS) : undefined;
  if (!a || !b) return { x: 0, y: 0 };
  const dt = Math.max(16, b.t - a.t);
  return { x: ((b.x - a.x) / dt) * 1000, y: ((b.y - a.y) / dt) * 1000 };
}

/** Where the pointer would coast to: x + v / 1000 * 0.99 / (1 - 0.99). */
export function projectX(x: number, vx: number): number {
  return x + ((vx / 1000) * DECELERATION) / (1 - DECELERATION);
}

/** Snap to a side edge when the projected x lands within 72px of it. */
export function snapEdge(projectedX: number, viewportW: number): DockEdge {
  if (projectedX < SNAP_DISTANCE) return "l";
  if (projectedX > viewportW - SNAP_DISTANCE) return "r";
  return null;
}

export function capSpeed(v: number): number {
  return Math.max(-MAX_RELEASE_SPEED, Math.min(MAX_RELEASE_SPEED, v));
}

/** The on-screen top-left for a saved position: vertical bars hug their edge, everything is kept in the window. */
export function restingPosition(p: DockPosition, size: Size, viewport: Size): { x: number; y: number } {
  let x = p.edge === "l" ? EDGE_GAP : p.edge === "r" ? viewport.w - size.w - EDGE_GAP : p.x;
  let y = p.y;
  x = Math.min(Math.max(MARGIN, x), viewport.w - size.w - MARGIN);
  y = Math.min(Math.max(MARGIN, y), viewport.h - size.h - MARGIN);
  return { x, y };
}

/** Top-left of the default spot: bottom centre, 20px up. */
export function defaultPosition(size: Size, viewport: Size): { x: number; y: number } {
  return { x: (viewport.w - size.w) / 2, y: viewport.h - size.h - DEFAULT_BOTTOM };
}

/** Arrow-key step for the grip, or null for any other key. */
const KEY_STEPS = new Map<string, [number, number]>([
  ["ArrowLeft", [-KEY_STEP, 0]],
  ["ArrowRight", [KEY_STEP, 0]],
  ["ArrowUp", [0, -KEY_STEP]],
  ["ArrowDown", [0, KEY_STEP]],
]);

export function keyStep(key: string): [number, number] | null {
  return KEY_STEPS.get(key) ?? null;
}

/** Parse a stored position. Anything malformed is `null` (default position). */
export function parsePosition(raw: unknown): DockPosition | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.x !== "number" || typeof r.y !== "number" || !Number.isFinite(r.x) || !Number.isFinite(r.y)) {
    return null;
  }
  const edge: DockEdge = r.edge === "l" || r.edge === "r" ? r.edge : null;
  return { x: r.x, y: r.y, edge };
}
