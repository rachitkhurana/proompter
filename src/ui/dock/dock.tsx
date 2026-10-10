import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { flushSync } from "react-dom";
import { spring, type SpringHandle } from "../../core/spring";
import { GripIcon, Icon } from "../icons";
import { IconButton } from "../primitives/button";
import { cx } from "../primitives/cx";
import { Kbd } from "../primitives/kbd";
import { Segmented, type SegmentedItem } from "../primitives/segmented";
import { toast } from "../primitives/toast";
import { Tooltip, TooltipProvider, type TooltipSide } from "../primitives/tooltip";
import { reducedMotion } from "../../core/motion";
import { DOCK_CSS } from "./dock-css";
import {
  capSpeed,
  defaultPosition,
  dragPosition,
  exceedsClickSlop,
  keyStep,
  projectX,
  pushSample,
  releaseVelocity,
  restingPosition,
  snapEdge,
  viewportSize,
  type DockEdge,
  type DockPosition,
  type Sample,
} from "./dock-math";
import { loadCollapsed, loadPosition, saveCollapsed, savePosition } from "./dock-storage";
import { derivePlacement, modeOf, publishDockPlacement, resetDockPlacement } from "./placement";

export type DockTool = "pick" | "multi" | "area" | "text" | "note";
export type DockViewport = "responsive" | "desktop" | "tablet" | "mobile";

export interface DockProps {
  /** The active tool, or null/undefined when idle. The dock only reports clicks; the owner toggles. */
  activeTool?: DockTool | null;
  frozen?: boolean;
  viewport?: DockViewport;
  /** Device rotated. The Rotate button is disabled while the viewport is `responsive`. */
  rotated?: boolean;
  /** Command menu open (lights the search button). */
  commandOpen?: boolean;
  /** Entries sheet open (lights the inbox button). */
  entriesOpen?: boolean;
  /** Open (unresolved) entries: the badge on Entries, and on the logo when collapsed. */
  openCount?: number;
  onTool?: (tool: DockTool) => void;
  onFreeze?: () => void;
  onViewport?: (viewport: DockViewport) => void;
  onRotate?: () => void;
  onCommand?: () => void;
  onEntries?: () => void;
  /** Collapse or expand. Collapsing while a tool is active should deactivate it (the prototype does). */
  onCollapsedChange?: (collapsed: boolean) => void;
  /** After a drag, key step or reset; `null` is the default position. */
  onPositionChange?: (position: DockPosition | null) => void;
}

// A tool's and a viewport's value is also its icon name (see `icons.tsx`).
const TOOLS: ReadonlyArray<{ tool: DockTool; label: string; name: string; key: string; extra?: string }> = [
  { tool: "pick", label: "Pick element", name: "Pick element", key: "P", extra: "· ↑↓ to walk" },
  { tool: "multi", label: "Select several", name: "Select several elements", key: "M" },
  { tool: "area", label: "Box select", name: "Box select", key: "B" },
  { tool: "text", label: "Quote text", name: "Quote text", key: "T" },
  { tool: "note", label: "Page note", name: "Page note", key: "N" },
];

const VIEWPORTS: ReadonlyArray<{ value: DockViewport; label: string; tip: string; key: string }> = [
  { value: "responsive", label: "Responsive", tip: "Responsive", key: "1" },
  { value: "desktop", label: "Desktop", tip: "Desktop 1440", key: "2" },
  { value: "tablet", label: "Tablet", tip: "Tablet 834", key: "3" },
  { value: "mobile", label: "Mobile", tip: "Mobile 390", key: "4" },
];

function tip(label: string, key: string, extra?: string): ReactNode {
  return (
    <>
      {label}
      <Kbd>{key}</Kbd>
      {extra ? <span style={{ color: "var(--fg-3)" }}>{extra}</span> : null}
    </>
  );
}

export function Dock({
  activeTool = null,
  frozen = false,
  viewport = "responsive",
  rotated = false,
  commandOpen,
  entriesOpen,
  openCount = 0,
  onTool,
  onFreeze,
  onViewport,
  onRotate,
  onCommand,
  onEntries,
  onCollapsedChange,
  onPositionChange,
}: DockProps) {
  const toolsId = useId();
  // The position and collapsed state are restored from, and saved to, `localStorage`.
  const [pos, setPos] = useState<DockPosition | null>(loadPosition);
  const [collapsed, setCollapsedState] = useState<boolean>(loadCollapsed);
  const [dragging, setDragging] = useState(false);
  const [intro, setIntro] = useState(true);
  const [tooltipSide, setTooltipSide] = useState<TooltipSide>("top");

  // Reduced motion turns every animation off, so `animationend` never fires and the intro class would stay.
  useEffect(() => {
    if (reducedMotion()) setIntro(false);
  }, []);

  const dockRef = useRef<HTMLDivElement>(null);
  const posRef = useRef(pos);
  const collapsedRef = useRef(collapsed);
  const animating = useRef(false);
  const springs = useRef<SpringHandle[]>([]);
  const dragCleanup = useRef<(() => void) | null>(null);
  const cb = useRef({ onCollapsedChange, onPositionChange });
  cb.current = { onCollapsedChange, onPositionChange };

  /** Tell the rest of the UI where the dock is (tooltips, toasts, sub-bar, sheet). */
  const publish = useCallback(() => {
    const el = dockRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const next = derivePlacement(
      modeOf(posRef.current?.edge ?? null),
      { left: r.left, top: r.top, width: r.width, height: r.height },
      viewportSize().h,
    );
    publishDockPlacement(next);
    setTooltipSide(next.tooltipSide);
  }, []);

  /** Put the element where `posRef` says (clamped to the window), or back on the CSS default. */
  const applyPosition = useCallback(() => {
    const el = dockRef.current;
    if (!el) return;
    const p = posRef.current;
    if (!animating.current) {
      if (p) {
        const { x, y } = restingPosition(
          p,
          { w: el.offsetWidth, h: el.offsetHeight },
          viewportSize(),
        );
        el.style.left = `${x}px`;
        el.style.top = `${y}px`;
      } else {
        el.style.left = "";
        el.style.top = "";
      }
    }
    publish();
  }, [publish]);

  const commit = useCallback(
    (p: DockPosition | null) => {
      posRef.current = p;
      if (p) setIntro(false);
      flushSync(() => setPos(p));
      applyPosition();
    },
    [applyPosition],
  );

  /**
   * Cancel a running settle. With `keepPosition` (an interruption by a new drag or key) the dock stays
   * where the spring had got to: React state, storage and the owner all get that live position, with the
   * shape (vertical bar or not) it was settling into.
   */
  const stopSprings = useCallback(
    (keepPosition: boolean) => {
      for (const h of springs.current) h.cancel();
      springs.current = [];
      if (!animating.current) return;
      animating.current = false;
      const el = dockRef.current;
      if (!keepPosition || !el) return;
      const r = el.getBoundingClientRect();
      const live: DockPosition = { x: r.left, y: r.top, edge: posRef.current?.edge ?? null };
      commit(live);
      // commit() re-applies the resting position; the dock must stay where it is mid-flight
      el.style.left = `${r.left}px`;
      el.style.top = `${r.top}px`;
      publish();
      savePosition(live);
      cb.current.onPositionChange?.(live);
    },
    [commit, publish],
  );

  /**
   * Release: spring the dock from where it is to where it rests, handing over the pointer velocity.
   * `provisional` applies the final shape (vertical or horizontal) immediately; `final === null` is the
   * default bottom-centre, handed back to CSS at the end.
   */
  const settle = useCallback(
    (provisional: DockPosition, final: DockPosition | null, velocity: { x: number; y: number }) => {
      const el = dockRef.current;
      if (!el) return;
      stopSprings(true);
      const from = el.getBoundingClientRect();
      animating.current = true;
      commit(provisional);
      el.style.left = `${from.left}px`;
      el.style.top = `${from.top}px`;
      const size = { w: el.offsetWidth, h: el.offsetHeight };
      const vp = viewportSize();
      const target = final ? restingPosition(final, size, vp) : defaultPosition(size, vp);
      const saved: DockPosition | null = final ? { x: target.x, y: target.y, edge: final.edge } : null;
      savePosition(saved);
      cb.current.onPositionChange?.(saved);

      const maxX = Math.max(0, vp.w - size.w);
      const maxY = Math.max(0, vp.h - size.h);
      let pending = 2;
      const finish = () => {
        if (--pending > 0) return;
        springs.current = [];
        animating.current = false;
        commit(saved);
      };
      const vx = Math.abs(from.left - target.x) < 0.5 ? 0 : capSpeed(velocity.x);
      const vy = Math.abs(from.top - target.y) < 0.5 ? 0 : capSpeed(velocity.y);
      springs.current = [
        spring({
          from: from.left,
          to: target.x,
          velocity: vx,
          // a hard flick must not carry the dock off screen
          onUpdate: (v) => (el.style.left = `${Math.min(Math.max(v, 0), maxX)}px`),
          onDone: finish,
        }),
        spring({
          from: from.top,
          to: target.y,
          velocity: vy,
          onUpdate: (v) => (el.style.top = `${Math.min(Math.max(v, 0), maxY)}px`),
          onDone: finish,
        }),
      ];
    },
    [commit, stopSprings],
  );

  const setCollapsed = useCallback((v: boolean) => {
    collapsedRef.current = v;
    setCollapsedState(v);
    saveCollapsed(v);
    cb.current.onCollapsedChange?.(v);
  }, []);

  useLayoutEffect(() => {
    applyPosition();
  }, [pos, collapsed, applyPosition]);

  // Keep a free-floating dock anchored while its width animates (collapse), and inside the window on resize.
  useEffect(() => {
    const el = dockRef.current;
    let ro: ResizeObserver | undefined;
    if (el && typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(() => applyPosition());
      ro.observe(el);
    }
    const onResize = () => applyPosition();
    window.addEventListener("resize", onResize);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", onResize);
    };
  }, [applyPosition]);

  useEffect(
    () => () => {
      stopSprings(false);
      dragCleanup.current?.();
      resetDockPlacement();
    },
    [stopSprings],
  );

  function startDrag(ev: ReactPointerEvent<HTMLElement>) {
    if (ev.button !== 0) return;
    ev.preventDefault();
    const el = dockRef.current;
    // A second finger or button while a drag is live must not hijack it.
    if (!el || dragCleanup.current) return;
    stopSprings(true);
    const r0 = el.getBoundingClientRect();
    let off = { x: ev.clientX - r0.left, y: ev.clientY - r0.top };
    let moved = false;
    const hist: Sample[] = [];
    let last = { x: ev.clientX, y: ev.clientY };
    const target = ev.currentTarget;
    const isBrand = target.classList.contains("brand");
    try {
      target.setPointerCapture(ev.pointerId);
    } catch {
      // not capturable (synthetic pointer): the listeners below still work
    }

    const mine = (e: PointerEvent) => e.pointerId === ev.pointerId;
    const mv = (e: PointerEvent) => {
      if (!mine(e)) return;
      last = { x: e.clientX, y: e.clientY };
      if (!moved) {
        if (!exceedsClickSlop(e.clientX - ev.clientX, e.clientY - ev.clientY)) return;
        moved = true;
        const cur = posRef.current;
        if (cur?.edge) {
          // Leaving a vertical bar: become a floating horizontal dock under the pointer.
          commit({ x: r0.left, y: r0.top, edge: null });
          const r1 = el.getBoundingClientRect();
          off = { x: Math.min(off.y, r1.width / 2), y: r1.height / 2 };
        } else if (!cur) {
          commit({ x: r0.left, y: r0.top, edge: null });
        }
        setDragging(true);
      }
      pushSample(hist, { x: e.clientX, y: e.clientY, t: performance.now() });
      const { x, y } = dragPosition(
        { x: e.clientX, y: e.clientY },
        off,
        { w: el.offsetWidth, h: el.offsetHeight },
        viewportSize(),
      );
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
    };

    const end = (e: PointerEvent, cancelled: boolean) => {
      cleanup();
      setDragging(false);
      if (!moved) {
        if (isBrand && !cancelled) setCollapsed(!collapsedRef.current);
        return;
      }
      const v = releaseVelocity(hist);
      const x = cancelled ? last.x : e.clientX;
      const vp = viewportSize();
      const edge: DockEdge = snapEdge(projectX(x, v.x), vp.w);
      const r = el.getBoundingClientRect();
      const provisional: DockPosition = { x: r.left, y: r.top, edge };
      const rest = restingPosition(provisional, { w: el.offsetWidth, h: el.offsetHeight }, vp);
      if (!edge && Math.abs(rest.x - r.left) < 0.5 && Math.abs(rest.y - r.top) < 0.5) {
        // Released inside the window: it stays exactly where it is.
        savePosition(provisional);
        cb.current.onPositionChange?.(provisional);
        commit(provisional);
        return;
      }
      settle(provisional, provisional, v);
    };
    const up = (e: PointerEvent) => {
      if (mine(e)) end(e, false);
    };
    const cancel = (e: PointerEvent) => {
      if (mine(e)) end(e, true);
    };
    function cleanup() {
      target.removeEventListener("pointermove", mv);
      target.removeEventListener("pointerup", up);
      target.removeEventListener("pointercancel", cancel);
      dragCleanup.current = null;
    }
    target.addEventListener("pointermove", mv);
    target.addEventListener("pointerup", up);
    target.addEventListener("pointercancel", cancel);
    dragCleanup.current = cleanup;
  }

  function onGripKeyDown(ev: ReactKeyboardEvent<HTMLElement>) {
    const d = keyStep(ev.key);
    if (!d) return;
    ev.preventDefault(); // shortcut handlers elsewhere should skip defaultPrevented events
    ev.stopPropagation();
    const el = dockRef.current;
    if (!el) return;
    stopSprings(true);
    const r = el.getBoundingClientRect();
    const next: DockPosition = { x: r.left + d[0], y: r.top + d[1], edge: null };
    commit(next);
    // commit() clamps through applyPosition; save what actually landed
    const landed: DockPosition = {
      x: parseFloat(el.style.left) || next.x,
      y: parseFloat(el.style.top) || next.y,
      edge: null,
    };
    commit(landed);
    savePosition(landed);
    onPositionChange?.(landed);
  }

  function resetPosition() {
    const el = dockRef.current;
    if (!el) return;
    const narrow = typeof matchMedia === "function" && matchMedia("(max-width: 760px)").matches;
    if (!posRef.current || narrow) {
      stopSprings(false);
      savePosition(null);
      onPositionChange?.(null);
      commit(null);
    } else {
      const r = el.getBoundingClientRect();
      settle({ x: r.left, y: r.top, edge: null }, null, { x: 0, y: 0 });
    }
    toast("Toolbar is back at the bottom centre");
  }

  const edge = pos?.edge ?? null;
  const vertical = edge !== null;
  const free = pos !== null;

  const viewportItems: Array<SegmentedItem<DockViewport>> = VIEWPORTS.map((v) => ({
    value: v.value,
    label: v.label,
    icon: <Icon name={v.value} />,
    tooltip: tip(v.tip, v.key),
  }));

  return (
    <TooltipProvider>
      <style>{DOCK_CSS}</style>
      <div
        ref={dockRef}
        className={cx(
          "dock",
          free && "free",
          vertical && "v",
          edge === "l" && "edge-l",
          edge === "r" && "edge-r",
          collapsed && "col",
          dragging && "dragging",
          intro && !free && "intro",
        )}
        role="toolbar"
        aria-label="Proompter"
        aria-orientation={vertical ? "vertical" : "horizontal"}
        data-placement={modeOf(edge)}
        onAnimationEnd={() => setIntro(false)}
      >
        <button
          type="button"
          className="grip"
          aria-label="Move toolbar. Drag it, or focus and use the arrow keys. Double-click to reset."
          onPointerDown={startDrag}
          onKeyDown={onGripKeyDown}
          onDoubleClick={resetPosition}
        >
          <GripIcon />
        </button>
        <div
          className="brand"
          role="button"
          tabIndex={0}
          aria-expanded={!collapsed}
          aria-controls={toolsId}
          aria-label={
            collapsed ? (openCount > 0 ? `Expand toolbar, ${openCount} open entries` : "Expand toolbar") : "Collapse toolbar"
          }
          title="Click to collapse or expand · drag to move"
          onPointerDown={startDrag}
          onKeyDown={(ev) => {
            if (ev.key === "Enter" || ev.key === " ") {
              ev.preventDefault();
              setCollapsed(!collapsedRef.current);
            }
          }}
        >
          <span className="logo">
            <Icon name="logo" />
          </span>
          <span className="nm-w">
            <span className="nm">Proompter</span>
          </span>
          <span className="lbadge num" aria-hidden="true" hidden={!(collapsed && openCount > 0)}>
            {openCount}
          </span>
        </div>
        <div className="tw" id={toolsId}>
          <div className="tw-in">
            <span className="sep" />
            {TOOLS.map(({ tool, label, name, key, extra }) => (
              <Tooltip key={tool} content={tip(label, key, extra)} side={tooltipSide}>
                <IconButton label={name} pressed={activeTool === tool} onClick={() => onTool?.(tool)}>
                  <Icon name={tool} />
                </IconButton>
              </Tooltip>
            ))}
            <Tooltip content={tip("Freeze motion", "F")} side={tooltipSide}>
              <IconButton label="Freeze animations" pressed={frozen} onClick={onFreeze}>
                <Icon name="freeze" />
              </IconButton>
            </Tooltip>
            <span className="sep" />
            <Segmented
              items={viewportItems}
              value={viewport}
              onValueChange={(v) => onViewport?.(v)}
              label="Viewport"
              orientation={vertical ? "vertical" : "horizontal"}
              tooltipSide={tooltipSide}
            />
            <Tooltip content={tip("Rotate", "R")} side={tooltipSide}>
              <IconButton
                label="Rotate device"
                pressed={rotated}
                disabled={viewport === "responsive"}
                onClick={onRotate}
              >
                <Icon name="rotate" />
              </IconButton>
            </Tooltip>
            <span className="sep" />
            <Tooltip content={tip("Command menu", "⌘K")} side={tooltipSide}>
              <IconButton label="Command menu" pressed={commandOpen} onClick={onCommand}>
                <Icon name="search" />
              </IconButton>
            </Tooltip>
            <Tooltip content={tip("Entries", "E")} side={tooltipSide}>
              <IconButton
                label={openCount > 0 ? `Entries, ${openCount} open` : "Entries"}
                pressed={entriesOpen}
                badge={openCount > 0 ? openCount : undefined}
                onClick={onEntries}
              >
                <Icon name="inbox" />
              </IconButton>
            </Tooltip>
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}
