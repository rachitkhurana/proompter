import { findBySelector } from "../../core/resolve";
import { rectBottom, rectRight, type PickSurface, type ViewportId } from "../../core/surface";
import type { Priority } from "../primitives/priority-icon";
import type { Status } from "../primitives/status-icon";

/** What the pin layer needs to know about an entry. */
export interface PinModel {
  id: number | string;
  title: string;
  priority: Priority;
  status: Status;
  /** Pins only show on the viewport the entry was filed on. */
  viewport: ViewportId;
  /** Route the entry was filed on (`/feeds`). Undefined or null: shown on every route. */
  route?: string | null;
  /** Element selector. Null or empty for page notes. */
  selector: string | null;
  /** Shown in the hover card and the pin's name (`PRO-5`). */
  ref: string;
}

export interface PlacedPin {
  pin: PinModel;
  /** Screen position of the pin's tip (after stacking offset). */
  x: number;
  y: number;
}

/** Horizontal gap between pins stacked on the same spot, px. */
export const PIN_STACK_STEP = 28;

/**
 * Where a pin sits: 4px inside the top-right corner of its element, in screen space.
 * Null when it should not show: other viewport or route, element missing or empty, or scrolled out of the surface.
 * Page notes (no selector) sit 16px inside the surface's top-right corner.
 */
export function anchorFor(
  pin: PinModel,
  surface: PickSurface,
  viewport: ViewportId,
  route?: string,
): { x: number; y: number } | null {
  if (pin.viewport !== viewport) return null;
  if (route !== undefined && pin.route != null && pin.route !== route) return null;
  const f = surface.bounds();
  if (!pin.selector) return { x: rectRight(f) - 16, y: f.top + 16 };
  const el = findBySelector(surface.doc, pin.selector);
  if (!el) return null;
  const raw = el.getBoundingClientRect();
  if (!raw.width || !raw.height) return null;
  const r = surface.toScreen(raw);
  const x = rectRight(r) - 4;
  const y = r.top + 4;
  if (y < f.top + 6 || y > rectBottom(f) - 6 || x > rectRight(f) + 2 || x < f.left - 2) return null;
  return { x, y };
}

/** Anchor every pin; pins that land on the same spot (rounded to px) fan out to the left, 28px apart. */
export function layoutPins(
  pins: readonly PinModel[],
  surface: PickSurface,
  viewport: ViewportId,
  route?: string,
): PlacedPin[] {
  const used = new Map<string, number>();
  const out: PlacedPin[] = [];
  for (const pin of pins) {
    const a = anchorFor(pin, surface, viewport, route);
    if (!a) continue;
    const key = `${Math.round(a.x)}:${Math.round(a.y)}`;
    const n = used.get(key) ?? 0;
    used.set(key, n + 1);
    out.push({ pin, x: a.x - n * PIN_STACK_STEP, y: a.y });
  }
  return out;
}
