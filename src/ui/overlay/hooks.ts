import { useEffect, useState, useSyncExternalStore } from "react";
import type { PickEngine, PickSnapshot } from "../../core/pick";
import { freezeSurface, type PickSurface } from "../../core/surface";

/** The engine's state, as a React value. */
export function usePickSnapshot(engine: PickEngine): PickSnapshot {
  return useSyncExternalStore(engine.subscribe, engine.getSnapshot, engine.getSnapshot);
}

/**
 * A counter that bumps (at most once per animation frame) when the surface scrolls, resizes or is told its
 * layout settled. Re-render on it to re-measure pins, selections and the hover box.
 */
export function useRelayout(surface: PickSurface | null): number {
  const [tick, setTick] = useState(0);
  useEffect(() => surface?.onLayout(() => setTick((t) => t + 1)), [surface]);
  return tick;
}

/** Keep animations and videos paused while `frozen` is true. Restores exactly what it paused. */
export function useFreeze(surface: PickSurface | null, frozen: boolean): void {
  useEffect(() => {
    if (!surface || !frozen) return;
    return freezeSurface(surface);
  }, [surface, frozen]);
}

/** Remember the last non-null value, so an element can fade out where it was instead of jumping. */
export function useLast<T>(value: T | null): T | null {
  const [last, setLast] = useState<T | null>(value);
  if (value !== null && value !== last) setLast(value);
  return value ?? last;
}
