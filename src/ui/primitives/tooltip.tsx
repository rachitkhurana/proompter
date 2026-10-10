import {
  cloneElement,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type PointerEvent,
  type ReactElement,
  type ReactNode,
  type Ref,
} from "react";
import { createPortal } from "react-dom";
import { useShadowContainer } from "../shadow-root";
import { clamp, reducedMotion } from "../../core/motion";

export type TooltipSide = "top" | "bottom" | "left" | "right";

const GAP = 10; // distance from the trigger, as in the prototype
const HEIGHT = 24;
const EDGE = 8; // keep this far from the viewport edge
/** The first tooltip waits this long; neighbours are instant while warm. */
const DELAY_MS = 350;
/** Cold hide, as in the prototype: fade over 120ms, starting after a 350ms delay. A warm hide is instant. */
const EXIT_MS = 120;
const EXIT_DELAY_MS = 350;

/**
 * Shared "warm" state, the prototype's `.dock.warm`. The group goes warm `warmAfterMs` (420) after the
 * pointer goes over a tooltip trigger, stays warm while the pointer is anywhere in the group, and goes
 * cold `cooldownMs` (250) after the pointer leaves the whole group. Only the pointer warms: keyboard
 * focus never calls `pointerOver()`.
 */
export class TooltipWarmth {
  warm = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  constructor(
    readonly cooldownMs: number = 250,
    readonly warmAfterMs: number = 420,
  ) {}
  /** Pointer went over a trigger: (re)start the warm-up. */
  pointerOver() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.warm = true;
    }, this.warmAfterMs);
  }
  /** Pointer entered the group: cancel a pending cool-down. */
  enterGroup() {
    clearTimeout(this.timer);
  }
  /** Pointer left the whole group: go cold after the cool-down. */
  leaveGroup() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.warm = false;
    }, this.cooldownMs);
  }
  reset() {
    clearTimeout(this.timer);
    this.warm = false;
  }
}

const TooltipContext = createContext<TooltipWarmth | null>(null);

function missingProvider(): never {
  throw new Error("<Tooltip> must be inside a <TooltipProvider>");
}

/**
 * Scopes the warm state to a group of triggers (one per dock). Renders a `display: contents` wrapper
 * whose pointerenter/pointerleave define "the pointer is inside the group". Every `<Tooltip>` must be
 * inside one.
 */
export function TooltipProvider({ children }: { children?: ReactNode }) {
  const warmth = useMemo(() => new TooltipWarmth(), []);
  return (
    <TooltipContext value={warmth}>
      <div
        style={{ display: "contents" }}
        onPointerOverCapture={(e) => {
          if (e.pointerType !== "touch" && !movesWithin(e)) warmth.enterGroup();
        }}
        onPointerOut={(e) => {
          if (e.pointerType !== "touch" && !movesWithin(e)) warmth.leaveGroup();
        }}
      >
        {children}
      </div>
    </TooltipContext>
  );
}

/**
 * True when the pointer moved between two nodes inside `currentTarget`. Enter/leave are derived from
 * pointerover/pointerout rather than React's onPointerEnter/onPointerLeave: React skips the synthesized
 * "enter" when the previous element is also managed by React, which is always the case when the UI is a
 * portal into a shadow root inside the host app's React tree (the pointer comes from a host element), so
 * the tooltips would never open on re-entry.
 */
function movesWithin(e: PointerEvent<HTMLElement>): boolean {
  const related = e.relatedTarget as Node | null;
  return !!related && e.currentTarget.contains(related);
}

interface TriggerProps {
  ref?: Ref<HTMLElement>;
  onPointerOver?: (e: PointerEvent<HTMLElement>) => void;
  onPointerOut?: (e: PointerEvent<HTMLElement>) => void;
  onPointerDown?: (e: PointerEvent<HTMLElement>) => void;
  onFocus?: (e: FocusEvent<HTMLElement>) => void;
  onBlur?: (e: FocusEvent<HTMLElement>) => void;
  "aria-describedby"?: string;
}

export interface TooltipProps {
  content: ReactNode;
  /** Preferred side. Flips to the opposite side when there's no room. */
  side?: TooltipSide;
  /** One element that forwards `ref` and DOM event props (a button, chip, ...). */
  children: ReactElement<TriggerProps>;
}

type Phase = "closed" | "open" | "closing";

interface Placement {
  side: TooltipSide;
  left: number;
  top: number;
}

const OPPOSITE: Record<TooltipSide, TooltipSide> = { top: "bottom", bottom: "top", left: "right", right: "left" };

function place(trigger: Element, width: number, preferred: TooltipSide): Placement {
  const r = trigger.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const fits: Record<TooltipSide, boolean> = {
    top: r.top - GAP - HEIGHT >= EDGE,
    bottom: vh - (r.bottom + GAP + HEIGHT) >= EDGE,
    left: r.left - GAP - width >= EDGE,
    right: vw - (r.right + GAP + width) >= EDGE,
  };
  const side = fits[preferred] ? preferred : fits[OPPOSITE[preferred]] ? OPPOSITE[preferred] : preferred;
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  switch (side) {
    case "top":
      return { side, left: clamp(cx, EDGE + width / 2, vw - EDGE - width / 2), top: r.top - GAP - HEIGHT };
    case "bottom":
      return { side, left: clamp(cx, EDGE + width / 2, vw - EDGE - width / 2), top: r.bottom + GAP };
    case "left":
      return { side, left: r.left - GAP, top: clamp(cy - HEIGHT / 2, EDGE, vh - EDGE - HEIGHT) };
    case "right":
      return { side, left: r.right + GAP, top: clamp(cy - HEIGHT / 2, EDGE, vh - EDGE - HEIGHT) };
  }
}

/**
 * Hand-built tooltip. The first one waits `delay` (350ms); while warm, neighbours show instantly.
 * Opens on hover (mouse and pen only) and on keyboard focus; Esc or leaving closes it.
 * Renders into the shadow container, positioned `fixed` so no ancestor can clip it.
 */
export function Tooltip({ content, side: preferredSide = "top", children }: TooltipProps) {
  const warmth = useContext(TooltipContext) ?? missingProvider();
  const container = useShadowContainer();
  const id = useId();
  const [phase, setPhase] = useState<Phase>("closed");
  const [instant, setInstant] = useState(false);
  const [placement, setPlacement] = useState<Placement | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);
  const showTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const phaseRef = useRef<Phase>("closed");
  phaseRef.current = phase;

  const open = useCallback(() => {
    clearTimeout(hideTimer.current);
    if (phaseRef.current === "open") return;
    clearTimeout(showTimer.current);
    const show = (isInstant: boolean) => {
      setInstant(isInstant);
      setPhase("open");
    };
    if (warmth.warm) show(true);
    else showTimer.current = setTimeout(() => show(false), DELAY_MS);
  }, [warmth]);

  const close = useCallback(() => {
    clearTimeout(showTimer.current);
    if (phaseRef.current !== "open") return;
    const wasWarm = warmth.warm;
    if (wasWarm || reducedMotion()) {
      // Warm hide is instant (the prototype zeroes its transition delay and duration).
      setPhase("closed");
      return;
    }
    // Cold hide: the prototype's delayed fade (350ms delay, 120ms fade).
    setPhase("closing");
    hideTimer.current = setTimeout(() => setPhase("closed"), EXIT_DELAY_MS + EXIT_MS);
  }, [warmth]);

  useEffect(
    () => () => {
      clearTimeout(showTimer.current);
      clearTimeout(hideTimer.current);
    },
    [],
  );

  // Esc closes an open tooltip from anywhere.
  useEffect(() => {
    if (phase !== "open") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [phase, close]);

  useLayoutEffect(() => {
    if (phase === "closed") {
      setPlacement(null);
      return;
    }
    const trigger = triggerRef.current;
    const pop = popRef.current;
    if (!trigger || !pop) return;
    setPlacement(place(trigger, pop.offsetWidth, preferredSide));
  }, [phase, preferredSide, content]);

  const child = children;
  const childProps = child.props;
  const trigger = cloneElement(child, {
    ref: (el: HTMLElement | null) => {
      triggerRef.current = el;
      const r = childProps.ref;
      if (typeof r === "function") r(el);
      else if (r) (r as { current: HTMLElement | null }).current = el;
    },
    onPointerOver: (e: PointerEvent<HTMLElement>) => {
      childProps.onPointerOver?.(e);
      if (e.pointerType !== "touch" && !movesWithin(e)) {
        warmth.pointerOver(); // only the pointer warms the group
        open();
      }
    },
    onPointerOut: (e: PointerEvent<HTMLElement>) => {
      childProps.onPointerOut?.(e);
      if (movesWithin(e)) return;
      close();
    },
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      childProps.onPointerDown?.(e);
      close();
    },
    onFocus: (e: FocusEvent<HTMLElement>) => {
      childProps.onFocus?.(e);
      let visible = true;
      try {
        visible = e.currentTarget.matches(":focus-visible");
      } catch {
        // `:focus-visible` unsupported: treat every focus as keyboard focus.
      }
      if (visible) open();
    },
    onBlur: (e: FocusEvent<HTMLElement>) => {
      childProps.onBlur?.(e);
      close();
    },
    "aria-describedby": phase !== "closed" ? id : childProps["aria-describedby"],
  });

  const pop =
    phase === "closed" ? null : (
      <div
        ref={popRef}
        id={id}
        role="tooltip"
        className="tip-pop"
        data-side={placement?.side ?? preferredSide}
        data-state={phase}
        data-instant={instant || undefined}
        style={placement ? { left: placement.left, top: placement.top } : { left: 0, top: 0, visibility: "hidden" }}
      >
        {content}
      </div>
    );

  return (
    <>
      {trigger}
      {pop ? createPortal(pop, container ?? document.body) : null}
    </>
  );
}
