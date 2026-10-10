/**
 * Timing constants that code needs (tooltips, toasts). The colours, materials, shadows, type, easings
 * and z-indexes live in `styles.css` / the CSS strings as custom properties on `.pp`.
 * Values mirror `design/prototype.html`.
 */

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
