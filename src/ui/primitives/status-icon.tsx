import type { ComponentPropsWithRef } from "react";
import { cx } from "./cx";

export type Status = "open" | "progress" | "resolved";

export const STATUS_LABEL: Record<Status, string> = {
  open: "Open",
  progress: "In progress",
  resolved: "Resolved",
};

export interface StatusIconProps extends Omit<ComponentPropsWithRef<"span">, "children"> {
  status: Status;
  /** Accessible name. Omit when a visible label sits next to the icon. */
  label?: string;
}

export function StatusIcon({ status, label, className, ...rest }: StatusIconProps) {
  const a11y = label ? { role: "img", "aria-label": label } : { "aria-hidden": true as const };
  return (
    <span {...rest} {...a11y} className={cx("st", status, className)}>
      <i />
    </span>
  );
}
