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
}

/** Decorative: a visible label always sits next to it. */
export function StatusIcon({ status, className, ...rest }: StatusIconProps) {
  return (
    <span {...rest} aria-hidden="true" className={cx("st", status, className)}>
      <i />
    </span>
  );
}
