import { createElement, useSyncExternalStore, type ReactElement } from "react";
import { Toaster } from "../primitives/toast";
import type { TooltipSide } from "../primitives/tooltip";
import type { DockEdge } from "./dock-math";

/**
 * Where the dock is, and what that means for everything around it (DESIGN section 7):
 * tooltips open away from the edge, toasts go to the opposite end of the screen, the multi-select bar sits
 * next to the dock, and the sheet opens on the side away from it. The dock publishes this; anything else
 * reads it with `useDockPlacement()` (or `getDockPlacement()` outside React).
 */

export type DockMode = "horizontal" | "vertical-left" | "vertical-right";

/** The dock's saved edge (`l`, `r`, or floating/default) as a placement mode, and back. */
export const modeOf = (edge: DockEdge): DockMode =>
  edge === "l" ? "vertical-left" : edge === "r" ? "vertical-right" : "horizontal";
export const edgeOf = (mode: DockMode): DockEdge =>
  mode === "vertical-left" ? "l" : mode === "vertical-right" ? "r" : null;

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
