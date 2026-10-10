import type { PickEngine } from "../../core/pick";
import { findBySelector, shortSource } from "../../core/resolve";
import type { PickSurface, Rect, ViewportId } from "../../core/surface";
import { BoxCatcher } from "./box-catcher";
import { usePickSnapshot, useLast, useRelayout } from "./hooks";
import { HoverBox, HoverLabel } from "./hover";
import { MultiBar, type DockEdge } from "./multi-bar";
import { overlayCss } from "./overlay-styles";
import type { PinModel } from "./pin-layout";
import { Pins, type PulseRequest } from "./pins";
import { SelectionBox } from "./selection";

/** Renders the overlay's CSS. Mount it once, inside the shadow root. */
export function OverlayStyles() {
  return <style data-proompter-overlay="">{overlayCss}</style>;
}

export interface OverlayProps {
  surface: PickSurface | null;
  engine: PickEngine;
  /** The viewport currently shown (pins from other viewports are hidden). */
  viewport: ViewportId;
  pins?: readonly PinModel[];
  /** The route currently shown; pins filed on other routes are hidden. */
  route?: string;
  /** Replays the "Show on page" ring on one pin. */
  pulse?: PulseRequest | null;
  onOpenPin?(id: PinModel["id"]): void;
  /** Dock position, so the multi bar can sit next to it. */
  dock?: { rect: Rect | null; edge: DockEdge };
}

/**
 * Everything drawn over the surface: hover box and label, numbered selections, the box-select catcher, pins and
 * the multi bar. All state comes from the engine; geometry is re-measured on scroll, resize and layout changes.
 */
export function Overlay({ surface, engine, viewport, pins = [], route, pulse, onOpenPin, dock }: OverlayProps) {
  const snap = usePickSnapshot(engine);
  useRelayout(surface);
  const hover = useLast(snap.hover);
  const picking = snap.mode === "pick" || snap.mode === "multi";

  const hoverRect: Rect | null =
    hover && surface ? surface.toScreen(hover.target.el.getBoundingClientRect()) : null;

  return (
    <>
      <OverlayStyles />
      <div className="pm-ovl">
        {/* Keyboard picking (D8): each move of the target is announced as "<label>, <source or no source>". */}
        <div className="pm-sr" role="status" aria-live="polite">
          {picking && snap.hover
            ? `${snap.hover.target.label}, ${snap.hover.target.source ? shortSource(snap.hover.target.source) : "no source"}`
            : ""}
        </div>
        <HoverBox rect={hoverRect} visible={picking && !!snap.hover} />
        {hover ? (
          <HoverLabel
            rect={hoverRect}
            visible={picking && !!snap.hover}
            label={hover.target.label}
            source={hover.target.source}
            inherited={hover.target.inherited}
            walked={hover.walked}
          />
        ) : null}
        {surface && snap.mode === "multi"
          ? snap.multi.map((t, i) => {
              const el = t.el.isConnected ? t.el : findBySelector(surface.doc, t.selector);
              if (!el) return null;
              return <SelectionBox key={t.selector} index={i + 1} rect={surface.toScreen(el.getBoundingClientRect())} />;
            })
          : null}
        {surface && snap.mode === "box" ? (
          <BoxCatcher bounds={surface.bounds()} onSelect={(r) => engine.commitBox(r)} />
        ) : null}
        <Pins pins={pins} surface={surface} viewport={viewport} route={route} pulse={pulse} onOpen={onOpenPin} />
      </div>
      <MultiBar
        count={snap.mode === "multi" ? snap.multi.length : 0}
        onClear={() => engine.clearMulti()}
        onAdd={() => engine.commitMulti()}
        dockRect={dock?.rect ?? null}
        dockEdge={dock?.edge ?? null}
      />
    </>
  );
}
