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
}

/** Decorative: a visible label always sits next to it. */
export function PriorityIcon({ priority, className, ...rest }: PriorityIconProps) {
  return (
    <span {...rest} aria-hidden="true" className={cx("prio", priority, className)}>
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
