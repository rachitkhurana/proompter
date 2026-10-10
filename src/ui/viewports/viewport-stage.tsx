import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import {
  createFrameSurface,
  createPageSurface,
  frameUrl,
  layoutDevice,
  stagePadding,
  VIEWPORTS,
  type PickSurface,
  type ViewportId,
} from "../../core/surface";
import { Button } from "../primitives/button";
import { viewportCss } from "./viewport-styles";

/** Renders the stage CSS. Mount it once, inside the shadow root. */
export function ViewportStyles() {
  return <style data-proompter-viewports="">{viewportCss}</style>;
}

export interface ViewportStageProps {
  viewport: ViewportId;
  rotated: boolean;
  /** The dock is a vertical bar on a screen edge: the stage leaves room at the sides. */
  dockVertical?: boolean;
  /** Open entries filed on this viewport, for the caption. */
  openOnSize?: number;
  /** Page to frame. Defaults to the current URL, read when a device stage opens. */
  url?: string;
  /**
   * The surface to review: the live page for Responsive, the frame's document for devices (null while the frame
   * loads, when it can't be framed, and when the stage closes).
   */
  onSurface(surface: PickSurface | null): void;
  /** Leave device mode (the notice's button). */
  onExit?(): void;
}

/**
 * Size of the stage element itself (what the prototype measures), not the window: a classic scrollbar on the host
 * page would otherwise make the device frame fit a width that isn't there. Starts from the window until measured.
 */
function useStageSize(ref: RefObject<HTMLElement | null>) {
  const [size, setSize] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w && h) setSize((s) => (s.width === w && s.height === h ? s : { width: w, height: h }));
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

/**
 * The viewport switcher's canvas. Responsive: nothing is drawn, the surface is the live page. Desktop, Tablet and
 * Mobile: a full-screen stage with the page in a same-origin iframe (`?__proompter_frame=1`), scaled to fit
 * inside a device bezel, with a caption below.
 */
export function ViewportStage({ viewport, rotated, dockVertical, openOnSize = 0, url, onSurface, onExit }: ViewportStageProps) {
  const device = viewport !== "responsive";
  const emit = useRef(onSurface);
  useEffect(() => {
    emit.current = onSurface;
  });

  // Responsive: the live page is the surface.
  useEffect(() => {
    if (device) return;
    const notify = emit.current;
    notify(createPageSurface());
    return () => notify(null);
  }, [device]);

  return (
    <>
      <ViewportStyles />
      {device ? (
        <DeviceStage
          viewport={viewport}
          rotated={rotated}
          dockVertical={!!dockVertical}
          openOnSize={openOnSize}
          url={url}
          emit={emit}
          onExit={onExit}
        />
      ) : null}
    </>
  );
}

interface DeviceStageProps {
  viewport: ViewportId;
  rotated: boolean;
  dockVertical: boolean;
  openOnSize: number;
  url?: string;
  emit: { current: (s: PickSurface | null) => void };
  onExit?: () => void;
}

function DeviceStage({ viewport, rotated, dockVertical, openOnSize, url, emit, onExit }: DeviceStageProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const win = useStageSize(stageRef);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const surfaceRef = useRef<PickSurface | null>(null);
  // The URL is read once, when the stage opens; switching between devices keeps the frame (and where it navigated to).
  const [src] = useState(() => frameUrl(url ?? window.location.href));
  const [load, setLoad] = useState<{ n: number; blocked: boolean }>({ n: 0, blocked: false });

  const padding = stagePadding({ dockVertical, viewportWidth: win.width });
  const layout = layoutDevice({ viewport, rotated, stage: win, padding });

  const onLoad = () => {
    const frame = frameRef.current;
    if (!frame) return;
    // A refused frame (X-Frame-Options / CSP) loads the browser's error page: its document isn't reachable.
    const probe = createFrameSurface(frame, viewport);
    setLoad((l) => ({ n: l.n + 1, blocked: !probe }));
  };

  // A fresh surface after every load, and when the device changes (the document is the same, the viewport isn't).
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame || load.n === 0 || load.blocked) return;
    const notify = emit.current;
    const s = createFrameSurface(frame, viewport);
    surfaceRef.current = s;
    notify(s);
    return () => {
      surfaceRef.current = null;
      notify(null);
    };
  }, [load, viewport, emit]);

  // Overlays re-measure once the frame has moved (rotate, resize, device switch).
  const settle = () => surfaceRef.current?.emitLayout();
  const sx = layout?.scale;
  useEffect(() => {
    surfaceRef.current?.emitLayout();
  }, [sx, rotated, viewport, dockVertical]);

  if (!layout) return null;
  const { size, scale, bezel, radius, clipRadius, wrap } = layout;
  const capBottom = dockVertical ? 20 : win.width <= 760 ? 96 : 64;
  const wrapStyle = {
    width: wrap.width,
    height: wrap.height,
    "--bz": `${bezel}px`,
    "--br": `${radius}px`,
  } as CSSProperties;

  return (
    <div
      ref={stageRef}
      className="pm-stage"
      style={{ padding: `${padding.top}px ${padding.right}px ${padding.bottom}px ${padding.left}px` }}
      data-viewport={viewport}
    >
      <div className="pm-dwrap" style={wrapStyle} onTransitionEnd={settle}>
        <div className="pm-dclip" style={{ "--cr": `${clipRadius}px` } as CSSProperties}>
          <iframe
            ref={frameRef}
            title="App under review"
            src={src}
            data-blocked={load.blocked ? "" : undefined}
            style={{ width: size.width, height: size.height, transform: `scale(${scale})` }}
            onLoad={onLoad}
          />
          {load.blocked ? (
            <div className="pm-notice" role="alert">
              <p>
                <b>This page can't be shown at a fixed size</b>
                It refuses to be framed (X-Frame-Options or a Content-Security-Policy frame-ancestors rule). Allow
                framing from the same origin to review on Desktop, Tablet and Mobile.
              </p>
              {onExit ? (
                <Button size="sm" onClick={onExit}>
                  Back to Responsive
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
      <div className="pm-devcap" style={{ bottom: capBottom }}>
        <b>{VIEWPORTS[viewport].label}</b>
        <span className="mono num">
          {size.width}×{size.height}
        </span>
        <span className="dot" />
        <span className="num">{Math.round(scale * 100)}%</span>
        <span className="dot" />
        <span>{openOnSize ? `${openOnSize} open on this size` : "Nothing filed on this size yet"}</span>
      </div>
    </div>
  );
}
