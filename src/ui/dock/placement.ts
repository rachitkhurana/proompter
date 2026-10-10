import { createElement, useSyncExternalStore, type ReactElement } from "react";
import { Toaster } from "../primitives/toast";
import type { TooltipSide } from "../primitives/tooltip";

/**
 * Where the dock is, and what that means for everything around it (DESIGN section 7):
 * tooltips open away from the edge, toasts go to the opposite end of the screen, the multi-select bar sits
 * next to the dock, and the sheet opens on the side away from it. The dock publishes this; anything else
 * reads it with `useDockPlacement()` (or `getDockPlacement()` outside React).
 */

export type DockMode = "horizontal" | "vertical-left" | "vertical-right";

export interface DockRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface DockPlacement {
  mode: DockMode;
  /** The dock's rect in viewport coordinates, or null before it has mounted. */
  rect: DockRect | null;
  /** The dock's centre is in the lower half of the window (the prototype's "lower"). */
  lower: boolean;
  /** Side that tooltips open on. */
  tooltipSide: TooltipSide;
  /** Toasts sit at the opposite end: `top` when the dock is in the lower half. */
  toastPosition: "top" | "bottom";
  /** The sheet opens on the side away from the dock: `left` only when the dock is on the right edge. */
  sheetSide: "left" | "right";
}

export function derivePlacement(mode: DockMode, rect: DockRect | null, viewportH: number): DockPlacement {
  const lower = rect ? rect.top + rect.height / 2 > viewportH / 2 : true;
  return {
    mode,
    rect,
    lower,
    tooltipSide: mode === "vertical-left" ? "right" : mode === "vertical-right" ? "left" : lower ? "top" : "bottom",
    toastPosition: lower ? "top" : "bottom",
    sheetSide: mode === "vertical-right" ? "left" : "right",
  };
}

export const DEFAULT_PLACEMENT: DockPlacement = derivePlacement("horizontal", null, 0);

function same(a: DockPlacement, b: DockPlacement): boolean {
  const ra = a.rect;
  const rb = b.rect;
  return (
    a.mode === b.mode &&
    a.lower === b.lower &&
    (ra === rb ||
      (!!ra && !!rb && ra.left === rb.left && ra.top === rb.top && ra.width === rb.width && ra.height === rb.height))
  );
}

let current: DockPlacement = DEFAULT_PLACEMENT;
const listeners = new Set<() => void>();

/** Called by `<Dock>`. Returns true when the placement actually changed. */
export function publishDockPlacement(next: DockPlacement): boolean {
  if (same(current, next)) return false;
  current = next;
  for (const l of listeners) l();
  return true;
}

export function resetDockPlacement(): void {
  publishDockPlacement(DEFAULT_PLACEMENT);
}

export function getDockPlacement(): DockPlacement {
  return current;
}

export function subscribeDockPlacement(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Re-renders when the dock moves, snaps to an edge, resizes, or goes away. */
export function useDockPlacement(): DockPlacement {
  return useSyncExternalStore(subscribeDockPlacement, getDockPlacement, () => DEFAULT_PLACEMENT);
}

/** The shared `<Toaster>`, following the dock: opposite end of the screen. Mount this instead of `<Toaster>`. */
export function DockedToaster(): ReactElement {
  const { toastPosition } = useDockPlacement();
  return createElement(Toaster, { position: toastPosition });
}

/**
 * Where the multi-select bar ("N selected / Clear / Add entry") goes: centred above (dock in the lower
 * half) or below (upper half) a horizontal dock; beside a vertical one, aligned to its top. Clamped to
 * the window. Ported from the prototype's `placeSubbar`.
 */
export function subbarPosition(
  placement: Pick<DockPlacement, "mode" | "rect" | "lower">,
  bar: { width: number; height: number },
  viewport: { width: number; height: number },
): { left: number; top: number } {
  const r = placement.rect ?? { left: viewport.width / 2 - 100, top: viewport.height - 70, width: 200, height: 50 };
  const sw = bar.width || 220;
  const sh = bar.height || 42;
  let x = r.left + r.width / 2 - sw / 2;
  let y = placement.lower ? r.top - sh - 10 : r.top + r.height + 10;
  if (placement.mode === "vertical-left") {
    x = r.left + r.width + 10;
    y = r.top;
  }
  if (placement.mode === "vertical-right") {
    x = r.left - sw - 10;
    y = r.top;
  }
  return {
    left: Math.min(Math.max(8, x), viewport.width - sw - 8),
    top: Math.min(Math.max(8, y), viewport.height - sh - 8),
  };
}
