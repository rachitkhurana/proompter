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

export interface PinMarkerProps {
  pin: PinModel;
  /** Screen position. */
  x: number;
  y: number;
  /** Play the pop-in. Decided once, when the pin first mounts. */
  fresh: boolean;
  /** Playing the "Show on page" ring. */
  pulse?: PulseRequest | null;
  onOpen?(id: PinModel["id"]): void;
}

/** One numbered pin: coloured by priority, grey when resolved, with a hover card. */
export function PinMarker({ pin, x, y, fresh, pulse, onOpen }: PinMarkerProps) {
  const ref = pin.ref ?? `PRO-${pin.id}`;
  const pulseNonce = pulse && pulse.id === pin.id ? pulse.nonce : null;
  return (
    <button
      type="button"
      className={cx("pm-pin", pin.status === "resolved" ? "done" : pin.priority, fresh && "fresh")}
      style={{ left: x, top: y }}
      data-id={pin.id}
      aria-label={`Pin ${ref}: ${pin.title}`}
      onClick={() => onOpen?.(pin.id)}
    >
      {pin.id}
      {pulseNonce !== null ? <i key={pulseNonce} className="pm-pin-ring" aria-hidden="true" /> : null}
      <span className="pm-pin-card" aria-hidden="true">
        <b>{pin.title}</b>
        <span>
          <PriorityIcon priority={pin.priority} />
          {PRIORITY_LABEL[pin.priority]}
          <i className="dot" />
          {ref}
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
  const [seen] = useState(() => new Set<PinModel["id"]>());
  const [pulsed] = useState(() => new Set<string>());
  if (!surface) return null;
  return (
    <>
      {layoutPins(pins, surface, viewport, route).map(({ pin, x, y }) => (
        <SeenPin key={pin.id} seen={seen} pulsed={pulsed} pin={pin} x={x} y={y} pulse={pulse} onOpen={onOpen} />
      ))}
    </>
  );
}

function SeenPin({
  seen,
  pulsed,
  pulse,
  ...props
}: Omit<PinMarkerProps, "fresh"> & { seen: Set<PinModel["id"]>; pulsed: Set<string> }) {
  // Read once on mount: re-renders must not cut the animation short, and a pin that mounts again later
  // (viewport switch back and forth) must not pop in again.
  const id = props.pin.id;
  const [fresh] = useState(() => !seen.has(id));
  // Same for the "Show on page" ring: one request plays once. A pin that mounts after its request already
  // played (viewport or route switch) ignores that request; a new nonce plays again.
  const token = pulse && pulse.id === id ? `${id}:${pulse.nonce}` : null;
  const [stale] = useState(() => (token !== null && pulsed.has(token) ? token : null));
  useEffect(() => {
    seen.add(id);
    if (token) pulsed.add(token);
  }, [seen, pulsed, id, token]);
  return <PinMarker {...props} fresh={fresh} pulse={token !== null && token === stale ? null : pulse} />;
}
