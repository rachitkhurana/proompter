import { useEffect, useState } from "react";
import type { PickSurface, ViewportId } from "../../core/surface";
import { cx } from "../primitives/cx";
import { PRIORITY_LABEL, PriorityIcon } from "../primitives/priority-icon";
import { layoutPins, type PinModel } from "./pin-layout";

export interface PulseRequest {
  id: PinModel["id"];
  /** Change it to replay the pulse on the same pin ("Show on page" twice). */
  nonce: number;
}

/** What has already played, so a pin that mounts again later (viewport or route switch) doesn't replay it. */
export interface Played {
  seen: Set<PinModel["id"]>;
  pulsed: Set<string>;
}

export const createPlayed = (seen: readonly PinModel["id"][] = []): Played => ({
  seen: new Set(seen),
  pulsed: new Set(),
});

export interface PinMarkerProps {
  pin: PinModel;
  /** Screen position. */
  x: number;
  y: number;
  played: Played;
  /** The "Show on page" request; the ring plays when it is for this pin and has not played before. */
  pulse?: PulseRequest | null;
  onOpen?(id: PinModel["id"]): void;
}

/** One numbered pin: coloured by priority, grey when resolved, with a hover card. It pops in the first time it is shown. */
export function PinMarker({ pin, x, y, played, pulse, onOpen }: PinMarkerProps) {
  const { id } = pin;
  // Read once on mount: re-renders must not cut the animation short, and a pin that mounts again later
  // must not pop in again.
  const [fresh] = useState(() => !played.seen.has(id));
  // Same for the "Show on page" ring: one request plays once. A pin that mounts after its request already
  // played ignores that request; a new nonce plays again.
  const token = pulse && pulse.id === id ? `${id}:${pulse.nonce}` : null;
  const [stale] = useState(() => (token !== null && played.pulsed.has(token) ? token : null));
  useEffect(() => {
    played.seen.add(id);
    if (token) played.pulsed.add(token);
  }, [played, id, token]);
  const ringNonce = token !== null && token !== stale ? pulse!.nonce : null;
  return (
    <button
      type="button"
      className={cx("pm-pin", pin.status === "resolved" ? "done" : pin.priority, fresh && "fresh")}
      style={{ left: x, top: y }}
      data-id={id}
      aria-label={`Pin ${pin.ref}: ${pin.title}`}
      onClick={() => onOpen?.(id)}
    >
      {id}
      {ringNonce !== null ? <i key={ringNonce} className="pm-pin-ring" aria-hidden="true" /> : null}
      <span className="pm-pin-card" aria-hidden="true">
        <b>{pin.title}</b>
        <span>
          <PriorityIcon priority={pin.priority} />
          {PRIORITY_LABEL[pin.priority]}
          <i className="dot" />
          {pin.ref}
        </span>
      </span>
    </button>
  );
}

export interface PinsProps {
  pins: readonly PinModel[];
  surface: PickSurface | null;
  /** The viewport currently shown. Pins from other viewports are not rendered. */
  viewport: ViewportId;
  /** The route currently shown; pins filed on other routes are hidden. Omit to ignore routes. */
  route?: string;
  pulse?: PulseRequest | null;
  onOpen?(id: PinModel["id"]): void;
}

/**
 * The pin layer. Anchored by selector, so it re-anchors whenever the parent re-renders (the overlay does that on
 * scroll, resize and layout changes). A pin pops in the first time it is shown, never again.
 */
export function Pins({ pins, surface, viewport, route, pulse, onOpen }: PinsProps) {
  const [played] = useState(createPlayed);
  if (!surface) return null;
  return (
    <>
      {layoutPins(pins, surface, viewport, route).map(({ pin, x, y }) => (
        <PinMarker key={pin.id} played={played} pin={pin} x={x} y={y} pulse={pulse} onOpen={onOpen} />
      ))}
    </>
  );
}
