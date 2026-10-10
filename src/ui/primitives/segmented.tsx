import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { cx } from "./cx";
import { Tooltip, type TooltipSide } from "./tooltip";

export interface SegmentedItem<V extends string> {
  value: V;
  /** Accessible name. Also the visible text in the `text` variant. */
  label: string;
  /** Icon (icon variant) or leading icon (text variant). */
  icon?: ReactNode;
  /** Trailing count, text variant only. */
  count?: ReactNode;
  /** Tooltip content. Icon-only items usually want one. */
  tooltip?: ReactNode;
  disabled?: boolean;
}

export interface SegmentedProps<V extends string> {
  items: ReadonlyArray<SegmentedItem<V>>;
  value: V;
  onValueChange: (value: V) => void;
  /** Accessible name of the group. */
  label: string;
  /** `icon`: 28x26 icon buttons (the dock's viewport switcher). `text`: the sheet's tab strip. */
  variant?: "icon" | "text";
  orientation?: "horizontal" | "vertical";
  /** Where item tooltips open. Point them away from the screen edge. */
  tooltipSide?: TooltipSide;
  className?: string;
}

/**
 * A radio group drawn as a segmented control. One tab stop (the selected item); arrow keys move and
 * select, Home/End jump. Hand-built, as in the prototype.
 */
export function Segmented<V extends string>({
  items,
  value,
  onValueChange,
  label,
  variant = "icon",
  orientation = "horizontal",
  tooltipSide,
  className,
}: SegmentedProps<V>) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const enabled = items.map((it, i) => (it.disabled ? -1 : i)).filter((i) => i >= 0);

  function move(from: number, delta: number | "first" | "last") {
    if (enabled.length === 0) return;
    let next: number | undefined;
    if (delta === "first") next = enabled[0];
    else if (delta === "last") next = enabled[enabled.length - 1];
    else {
      const pos = enabled.indexOf(from);
      next = enabled[(pos + delta + enabled.length) % enabled.length];
    }
    const item = next === undefined ? undefined : items[next];
    if (next === undefined || !item) return;
    onValueChange(item.value);
    refs.current[next]?.focus();
  }

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    const vertical = orientation === "vertical";
    const prev = vertical ? "ArrowUp" : "ArrowLeft";
    const next = vertical ? "ArrowDown" : "ArrowRight";
    let handled = true;
    if (e.key === next) move(index, 1);
    else if (e.key === prev) move(index, -1);
    else if (e.key === "Home") move(index, "first");
    else if (e.key === "End") move(index, "last");
    else handled = false;
    if (handled) e.preventDefault();
  }

  const selectedIndex = items.findIndex((it) => it.value === value);
  // Roving tabindex: the selected item, or the first enabled one if nothing is selected.
  const tabStop = selectedIndex >= 0 && !items[selectedIndex]?.disabled ? selectedIndex : enabled[0];

  return (
    <div
      role="radiogroup"
      aria-label={label}
      aria-orientation={orientation}
      className={cx("seg", className)}
    >
      {items.map((it, i) => {
        const on = it.value === value;
        const button = (
          <button
            key={it.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={variant === "icon" ? it.label : undefined}
            aria-disabled={it.disabled || undefined}
            tabIndex={i === tabStop ? 0 : -1}
            className={cx(variant === "icon" ? "ib" : "seg-t", on && "on")}
            onClick={() => {
              if (!it.disabled) onValueChange(it.value);
            }}
            onKeyDown={(e) => onKeyDown(e, i)}
          >
            {it.icon}
            {variant === "text" ? <span>{it.label}</span> : null}
            {variant === "text" && it.count !== undefined ? <span className="n num">{it.count}</span> : null}
          </button>
        );
        return it.tooltip ? (
          <Tooltip key={it.value} content={it.tooltip} side={tooltipSide}>
            {button}
          </Tooltip>
        ) : (
          button
        );
      })}
    </div>
  );
}
