import type { ComponentPropsWithRef } from "react";
import { cx } from "./cx";

/** One vocabulary everywhere: UI keys, CSS classes, and the entry file format (DESIGN D2.5). */
export type Priority = "blocking" | "important" | "minor";

export const PRIORITY_LABEL: Record<Priority, string> = {
  blocking: "Blocking",
  important: "Important",
  minor: "Minor",
};

export interface PriorityIconProps extends Omit<ComponentPropsWithRef<"span">, "children"> {
  priority: Priority;
  /** Accessible name. Omit when a visible label sits next to the icon (the icon is then decorative). */
  label?: string;
}

export function PriorityIcon({ priority, label, className, ...rest }: PriorityIconProps) {
  const a11y = label ? { role: "img", "aria-label": label } : { "aria-hidden": true as const };
  return (
    <span {...rest} {...a11y} className={cx("prio", priority, className)}>
      {priority === "blocking" ? "!" : (
        <>
          <i />
          <i />
          <i />
        </>
      )}
    </span>
  );
}
