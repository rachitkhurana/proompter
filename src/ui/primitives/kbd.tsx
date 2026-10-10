import type { ComponentPropsWithRef } from "react";
import { cx } from "./cx";

export function Kbd({ className, ...rest }: ComponentPropsWithRef<"kbd">) {
  return <kbd {...rest} className={cx("kbd", className)} />;
}
