import { useLayoutEffect, useRef, useState } from "react";
import type { Rect } from "../../core/surface";
import { Button } from "../primitives/button";
import { cx } from "../primitives/cx";

export type DockEdge = "l" | "r" | null;

/**
 * Where the multi bar sits: 10px above the dock (or below it when the dock is in the top half), centred on it;
 * beside it when the dock is a vertical bar on a screen edge. Clamped 8px inside the screen. (`placeSubbar` in the prototype.)
 */
export function placeSubbar(
  dock: Rect | null,
  bar: { width: number; height: number },
  screen: { width: number; height: number },
  edge: DockEdge = null,
): { left: number; top: number } {
  const d: Rect = dock ?? { left: screen.width / 2 - 140, top: screen.height - 70, width: 280, height: 46 };
  const lower = d.top + d.height / 2 > screen.height / 2;
  let x = d.left + d.width / 2 - bar.width / 2;
  let y = lower ? d.top - bar.height - 10 : d.top + d.height + 10;
  if (edge === "l") {
    x = d.left + d.width + 10;
    y = d.top;
  }
  if (edge === "r") {
    x = d.left - bar.width - 10;
    y = d.top;
  }
  return {
    left: Math.min(Math.max(8, x), screen.width - bar.width - 8),
    top: Math.min(Math.max(8, y), screen.height - bar.height - 8),
  };
}

export interface MultiBarProps {
  /** Number of selected elements; the bar shows while it is above 0. */
  count: number;
  onClear(): void;
  onAdd(): void;
  /** Screen rect of the dock, so the bar can sit next to it. */
  dockRect?: Rect | null;
  dockEdge?: DockEdge;
}

/** The "N selected · Clear · Add entry" bar that appears in multi mode. */
export function MultiBar({ count, onClear, onAdd, dockRect = null, dockEdge = null }: MultiBarProps) {
  const ref = useRef<HTMLDivElement>(null);
  const shown = count > 0;
  // Keep the last non-zero count while the bar fades out, so it doesn't flash "0 selected".
  const [last, setLast] = useState(count);
  if (shown && count !== last) setLast(count);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const pos = placeSubbar(
      dockRect,
      { width: el.offsetWidth || 220, height: el.offsetHeight || 42 },
      { width: window.innerWidth, height: window.innerHeight },
      dockEdge,
    );
    el.style.left = `${pos.left}px`;
    el.style.top = `${pos.top}px`;
  });

  return (
    <div ref={ref} className={cx("pm-subbar", shown && "on")} inert={!shown} role="group" aria-label="Multi-select">
      <span className="num" aria-live="polite">
        {shown ? count : last} selected
      </span>
      <Button variant="ghost" size="sm" onClick={onClear}>
        Clear
      </Button>
      <Button variant="pri" size="sm" onClick={onAdd}>
        Add entry
      </Button>
    </div>
  );
}
