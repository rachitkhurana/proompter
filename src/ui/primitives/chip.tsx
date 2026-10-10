import type { ComponentPropsWithRef, ReactNode } from "react";
import { cx } from "./cx";

export interface ChipProps extends Omit<ComponentPropsWithRef<"button">, "type"> {
  /**
   * Render a `<button>` (property chips, menu triggers) or a static `<span>`.
   * Defaults to a button when `onClick` is given, otherwise static.
   */
  as?: "button" | "span";
  /** Monospace text, for file names and selectors. */
  mono?: boolean;
  /** Coral outline, for plugin-provided facts like the task. */
  accent?: boolean;
  /** No outline, muted. */
  ghost?: boolean;
  /** Leading icon. */
  icon?: ReactNode;
}

/**
 * A 24px pill. The label is wrapped in a `<span>` so long text truncates; pass plain text (or a single
 * inline node) as `children`.
 */
export function Chip({ as, mono, accent, ghost, icon, className, children, onClick, ...rest }: ChipProps) {
  const isButton = as === "button" || (as === undefined && onClick !== undefined);
  const classes = cx("chip", mono && "mono", accent && "acc", ghost && "ghost", className);
  if (isButton) {
    return (
      <button {...rest} type="button" onClick={onClick} className={classes}>
        {icon}
        <span>{children}</span>
      </button>
    );
  }
  // Static chips drop the button-only props.
  const { ref: _ref, ...spanRest } = rest;
  return (
    <span {...(spanRest as ComponentPropsWithRef<"span">)} className={classes}>
      {icon}
      <span>{children}</span>
    </span>
  );
}
