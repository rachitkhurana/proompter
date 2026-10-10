/**
 * A tiny critically damped spring (DESIGN D1: no animation dependency). Damping ratio 1.0, so it never
 * oscillates; `response` is the time scale in seconds (0.35 by default). The dock uses it for release and
 * edge snap, handing over the pointer's velocity so the motion continues instead of restarting.
 *
 * Closed form, so the result does not depend on the frame rate:
 *   d(t) = (d0 + (v0 + w*d0) * t) * e^(-w*t), with w = 2*pi / response and d = value - to.
 */

export interface SpringOptions {
  from: number;
  to: number;
  /** Starting velocity in units per second (the drag's release velocity). */
  velocity?: number;
  onUpdate: (value: number) => void;
  /** Called once, after the final `onUpdate(to)`. Not called when cancelled. */
  onDone?: () => void;
  /** Override the `prefers-reduced-motion` check (tests). */
  reducedMotion?: boolean;
}

export interface SpringHandle {
  cancel(): void;
}

/** Time scale in seconds. */
const RESPONSE = 0.35;
const REST_DISTANCE = 0.1;
const REST_SPEED = 1;

export function prefersReducedMotion(): boolean {
  try {
    return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/** Animate `from` to `to` on requestAnimationFrame. With reduced motion it jumps straight to `to`. */
export function spring(o: SpringOptions): SpringHandle {
  const w = (2 * Math.PI) / RESPONSE;
  if (o.reducedMotion ?? prefersReducedMotion()) {
    o.onUpdate(o.to);
    o.onDone?.();
    return { cancel() {} };
  }
  const d0 = o.from - o.to;
  const b = (o.velocity ?? 0) + w * d0;
  let start: number | undefined;
  let id = 0;
  let live = true;
  const frame = (now: number) => {
    if (!live) return;
    start ??= now;
    const t = (now - start) / 1000;
    const e = Math.exp(-w * t);
    const d = (d0 + b * t) * e;
    const v = (b - w * (d0 + b * t)) * e;
    if (Math.abs(d) < REST_DISTANCE && Math.abs(v) < REST_SPEED) {
      live = false;
      o.onUpdate(o.to);
      o.onDone?.();
      return;
    }
    o.onUpdate(o.to + d);
    id = requestAnimationFrame(frame);
  };
  id = requestAnimationFrame(frame);
  return {
    cancel() {
      live = false;
      cancelAnimationFrame(id);
    },
  };
}
