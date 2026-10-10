import type { Rect } from "../../core/surface";

export interface SelectionBoxProps {
  rect: Rect;
  /** 1-based badge number. */
  index: number;
}

/** A multi-select box with its numbered badge. */
export function SelectionBox({ rect, index }: SelectionBoxProps) {
  return (
    <div
      className="pm-selb"
      style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
      aria-hidden="true"
    >
      <b>{index}</b>
    </div>
  );
}
