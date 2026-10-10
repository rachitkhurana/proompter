import { useLayoutEffect, useRef } from "react";
import { shortSource } from "../../core/resolve";
import { rectBottom, type Rect } from "../../core/surface";
import { cx } from "../primitives/cx";

export interface HoverBoxProps {
  /** Screen rect of the hovered element. Keep passing the last one while fading out. */
  rect: Rect | null;
  visible: boolean;
}

/** The coral box around the hovered element. It glides between targets (`left/top/width/height .09s`). */
export function HoverBox({ rect, visible }: HoverBoxProps) {
  if (!rect) return null;
  return (
    <div
      className={cx("pm-hov", visible && "on")}
      style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
      aria-hidden="true"
    />
  );
}

export interface HoverLabelProps {
  rect: Rect | null;
  visible: boolean;
  /** `Avatar`, `img · avatar`, `button “Share”`. */
  label: string;
  /** `file:line:col`; shown as the file name. Null when nothing is stamped. */
  source: string | null;
  /** Prefix the source with `↳`. */
  inherited: boolean;
  /** Steps walked up the tree; shown as `↓N`. */
  walked: number;
}

/** The label above the hover box: sits 28px above (or 6px below near the top edge) and never leaves the screen. */
export function HoverLabel({ rect, visible, label, source, inherited, walked }: HoverLabelProps) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !rect) return;
    const max = window.innerWidth - el.offsetWidth - 8;
    el.style.left = `${Math.max(8, Math.min(rect.left, max))}px`;
  });
  if (!rect) return null;
  return (
    <div
      ref={ref}
      className={cx("pm-hlab", visible && "on")}
      style={{ top: rect.top > 34 ? rect.top - 28 : rectBottom(rect) + 6 }}
      aria-hidden="true"
    >
      {label}
      {source ? (
        <span className="mono">
          {inherited ? "↳ " : ""}
          {shortSource(source)}
        </span>
      ) : null}
      {walked > 0 ? <span className="mono">↓{walked}</span> : null}
    </div>
  );
}
