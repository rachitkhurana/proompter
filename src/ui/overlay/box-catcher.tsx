import { useState, type PointerEvent } from "react";
import { dragRect } from "../../core/pick";
import type { Rect } from "../../core/surface";

export interface BoxCatcherProps {
  /** Screen rect of the surface: the catcher covers exactly this. */
  bounds: Rect;
  /** Called with the dragged rect (screen space) on release. The engine ignores drags under 8px. */
  onSelect(rect: Rect): void;
}

/**
 * Box-select mode: a crosshair layer over the surface. It sits above the page so the page never sees the drag,
 * and draws the rubber band while dragging.
 */
export function BoxCatcher({ bounds, onSelect }: BoxCatcherProps) {
  const [drag, setDrag] = useState<{ x: number; y: number; to: { x: number; y: number } } | null>(null);

  const down = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ x: e.clientX, y: e.clientY, to: { x: e.clientX, y: e.clientY } });
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    setDrag((d) => (d ? { ...d, to: { x: e.clientX, y: e.clientY } } : d));
  };
  const up = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    const rect = dragRect(drag, { x: e.clientX, y: e.clientY });
    setDrag(null);
    onSelect(rect);
  };

  const band = drag ? dragRect(drag, drag.to) : null;
  return (
    <>
      <div
        className="pm-catch"
        style={{ left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height }}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={() => setDrag(null)}
        data-testid="pm-box-catcher"
      />
      {band ? (
        <div
          className="pm-drag"
          style={{ left: band.left, top: band.top, width: band.width, height: band.height }}
          aria-hidden="true"
        />
      ) : null}
    </>
  );
}
