import type { ComponentPropsWithRef, MouseEvent, ReactNode } from "react";
import { cx } from "./cx";

type NativeButtonProps = Omit<ComponentPropsWithRef<"button">, "disabled">;

function guardClick<E extends MouseEvent>(disabled: boolean | undefined, onClick: ((e: E) => void) | undefined) {
  if (!disabled) return onClick;
  return (e: E) => e.preventDefault();
}

export interface ButtonProps extends NativeButtonProps {
  variant?: "default" | "pri" | "ghost";
  size?: "md" | "sm";
  /** Dims the button and blocks activation, but keeps it focusable (`aria-disabled`), as in the prototype. */
  disabled?: boolean;
}

export function Button({
  variant = "default",
  size = "md",
  disabled,
  className,
  type = "button",
  onClick,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      aria-disabled={disabled || undefined}
      onClick={guardClick(disabled, onClick)}
      className={cx("btn", variant !== "default" && variant, size === "sm" && "sm", className)}
    />
  );
}

export interface IconButtonProps extends NativeButtonProps {
  /** Accessible name. Required: the button has no visible text. */
  label: string;
  /** Toggled-on look (coral tint) and `aria-pressed`. Leave undefined for a plain, non-toggle button. */
  pressed?: boolean;
  /** Corner count, e.g. the open-entries badge. */
  badge?: ReactNode;
  disabled?: boolean;
}

export function IconButton({
  label,
  pressed,
  badge,
  disabled,
  className,
  type = "button",
  onClick,
  children,
  ...rest
}: IconButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      aria-label={label}
      aria-pressed={pressed}
      aria-disabled={disabled || undefined}
      onClick={guardClick(disabled, onClick)}
      className={cx("ib", pressed && "on", className)}
    >
      {children}
      {badge !== undefined && badge !== null && badge !== false ? (
        <span className="badge num">{badge}</span>
      ) : null}
    </button>
  );
}
