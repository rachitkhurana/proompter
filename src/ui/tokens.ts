/**
 * Design tokens that code needs (WAAPI, positioning, timing). The colours, materials, shadows and type
 * live in `styles.css` as CSS custom properties on `.pp`; reference them with `token("acc")`.
 * Values mirror `design/prototype.html`'s `:root` block.
 */

export const ease = "cubic-bezier(.23,1,.32,1)";
export const easeIo = "cubic-bezier(.77,0,.175,1)";
export const easeDrawer = "cubic-bezier(.32,.72,0,1)";

/** Milliseconds, as used by the prototype's transitions. */
export const duration = {
  /** Hover and press feedback. */
  fast: 120,
  /** Menus, tooltips, composer scale. */
  base: 160,
  /** Fades, toasts out. */
  slow: 200,
  /** Collapsing toolbar sections. */
  collapse: 320,
  /** Sheet, device frame. */
  drawer: 380,
} as const;

/** Stacking order inside the shadow root (prototype z-indexes). */
export const z = {
  overlay: 40,
  pin: 40,
  dock: 60,
  subbar: 61,
  sheet: 70,
  scrim: 84,
  composer: 90,
  command: 90,
  menu: 120,
  tooltip: 130,
  toast: 150,
} as const;

/** Tooltip: the first one waits this long, neighbours are instant while warm. */
export const TOOLTIP_DELAY_MS = 350;
/** Tooltips stay "warm" this long after the last one closed. */
export const TOOLTIP_COOLDOWN_MS = 250;
/** Prototype: the dock turns "warm" 420ms after the pointer goes over a trigger. */
export const TOOLTIP_WARM_AFTER_MS = 420;
/** Cold hide, as in the prototype: fade over 120ms, starting after a 350ms delay. A warm hide is instant. */
export const TOOLTIP_EXIT_MS = 120;
export const TOOLTIP_EXIT_DELAY_MS = 350;

export const TOAST_DURATION_MS = 2800;
export const TOAST_EXIT_MS = 200;
export const MAX_TOASTS = 3;

export type TokenName =
  | "canvas" | "mat-1" | "mat-2" | "blur-1" | "blur-2"
  | "fill-1" | "fill-2" | "fill-3" | "line" | "line-2" | "edge"
  | "fg" | "fg-2" | "fg-3" | "fg-4"
  | "acc" | "acc-solid" | "acc-fg" | "acc-press" | "acc-soft" | "acc-line"
  | "p-blocking" | "p-important" | "p-minor" | "ok" | "prog"
  | "sans" | "mono" | "ease" | "ease-io" | "ease-drawer"
  | "sh-1" | "sh-2" | "sh-3";

/** `token("acc")` -> `var(--acc)`. */
export function token(name: TokenName): string {
  return `var(--${name})`;
}
