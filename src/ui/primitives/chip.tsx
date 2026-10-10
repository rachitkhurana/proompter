import type { ComponentPropsWithRef, ReactNode } from "react";
import { cx } from "./cx";

export interface ChipProps extends Omit<ComponentPropsWithRef<"button">, "type"> {
  /** `button` renders a `<button>` (property chips, menu triggers); otherwise a static `<span>`. */
  as?: "button";
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
export function Chip({ as, mono, accent, ghost, icon, className, children, ...rest }: ChipProps) {
  const classes = cx("chip", mono && "mono", accent && "acc", ghost && "ghost", className);
  if (as === "button") {
    return (
      <button {...rest} type="button" className={classes}>
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
