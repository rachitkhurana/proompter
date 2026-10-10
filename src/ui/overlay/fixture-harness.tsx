import { createElement, useEffect, useMemo, useState, useSyncExternalStore } from "react";
// T04 test harness: mounts the pick engine, overlay and viewport stage directly in a light-DOM <proompter-root>
// (no shadow root, so no `?inline` CSS). Exposed to the playground through `@rachitkay/proompter/internal/fixtures`.
import { PickEngine, type PickCommit } from "../../core/pick";
import {
  FRAME_PARAM,
  VIEWPORT_ORDER,
  VIEWPORTS,
  type PickSurface,
  type ViewportId,
} from "../../core/surface";
import { Overlay } from "./index";
import { ViewportStage } from "../viewports";

// The handful of kit tokens the overlay and stage use (the real kit gets these from `.pp` in styles.css).
const TOKENS = `
.pm-harness{--canvas:#09090b;--mat-1:rgba(30,30,34,.72);--blur-1:blur(20px) saturate(1.8);--edge:inset 0 1px 0 rgba(255,255,255,.07);
--fg:#f4f4f5;--fg-2:#a1a1aa;--fg-3:#71717a;--fg-4:#52525b;--acc:#ff6363;--acc-soft:rgba(255,99,99,.13);--acc-line:rgba(255,99,99,.4);
--p-blocking:#ff5c5c;--sans:system-ui,sans-serif;--mono:ui-monospace,monospace;--ease:cubic-bezier(.23,1,.32,1);--ease-drawer:cubic-bezier(.32,.72,0,1);
--sh-2:0 0 0 1px rgba(255,255,255,.12),0 16px 40px -8px rgba(0,0,0,.6);font:13px/20px var(--sans);color:var(--fg)}
.pm-harness .mono{font-family:var(--mono)}
.pm-harness .bar{position:fixed;left:12px;bottom:12px;z-index:100;display:flex;gap:6px;align-items:center;padding:6px;border-radius:12px;background:#1e1e22}
.pm-harness .bar button{font:inherit;padding:4px 10px;border-radius:8px;border:0;background:#3f3f46;color:#fff;cursor:pointer}
.pm-harness .bar button[aria-pressed="true"]{background:var(--acc)}
.pm-harness pre{margin:0;max-width:60vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
`;

const subscribe = () => () => {};

export function PickHarness() {
  // Frame mode (DESIGN §3): inside a device frame the kit renders nothing.
  const inFrame = useSyncExternalStore(
    subscribe,
    () => new URLSearchParams(window.location.search).has(FRAME_PARAM),
    () => true,
  );
  return inFrame ? null : <Kit />;
}

function Kit() {
  const [vp, setVp] = useState<ViewportId>("responsive");
  const [mode, setMode] = useState("idle");
  const [surface, setSurface] = useState<PickSurface | null>(null);
  const [commit, setCommit] = useState<PickCommit | null>(null);
  const engine = useMemo(() => new PickEngine({ onCommit: setCommit, onModeChange: (m) => setMode(m) }), []);

  useEffect(() => {
    engine.attach(surface);
    return () => engine.attach(null);
  }, [engine, surface]);

  const picked =
    commit?.kind === "element"
      ? JSON.stringify({
          kind: commit.kind,
          viewport: vp,
          source: commit.target.source,
          inherited: commit.target.inherited,
          selector: commit.target.selector,
          label: commit.target.label,
          crumb: commit.target.crumb,
        })
      : "";

  return createElement(
    "proompter-root",
    { class: "pp pm-harness" },
    <style>{TOKENS}</style>,
    <ViewportStage viewport={vp} rotated={false} onSurface={setSurface} onExit={() => setVp("responsive")} />,
    <Overlay surface={surface} engine={engine} viewport={vp} />,
    <div className="bar" role="toolbar" aria-label="Fixture controls">
      {VIEWPORT_ORDER.map((id) => (
        <button key={id} type="button" aria-pressed={vp === id} onClick={() => setVp(id)}>
          {VIEWPORTS[id].label}
        </button>
      ))}
      <button type="button" aria-pressed={mode === "pick"} onClick={() => engine.toggleMode("pick")}>
        Pick
      </button>
      <pre data-testid="pp-picked">{picked}</pre>
    </div>,
  );
}
