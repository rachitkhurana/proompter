import { useEffect, useMemo, useState, useSyncExternalStore, type CSSProperties } from "react";
// T04 test harness: mounts the pick engine, overlay and viewport stage inside the kit's real <ShadowRoot>
// (so they get styles.css). Exposed to the playground through `@rachitkay/proompter/internal/fixtures`.
import { PickEngine, type PickCommit } from "../../core/pick";
import {
  FRAME_PARAM,
  VIEWPORT_ORDER,
  VIEWPORTS,
  type PickSurface,
  type ViewportId,
} from "../../core/surface";
import { Overlay } from "./overlay";
import { ViewportStage } from "../viewports/viewport-stage";
import { ShadowRoot } from "../shadow-root";

// Placement only; the look comes from the kit's `.seg` / `.seg-t` / `.mono` classes.
const BAR: CSSProperties = { position: "fixed", left: 12, bottom: 12, zIndex: 100, alignItems: "center" };
const PICKED: CSSProperties = {
  margin: 0,
  maxWidth: "60vw",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};
const pressed = (on: boolean) => (on ? "seg-t on" : "seg-t");

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

  return (
    <ShadowRoot>
      <ViewportStage viewport={vp} rotated={false} onSurface={setSurface} onExit={() => setVp("responsive")} />
      <Overlay surface={surface} engine={engine} viewport={vp} />
      <div className="seg" style={BAR} role="toolbar" aria-label="Fixture controls">
        {VIEWPORT_ORDER.map((id) => (
          <button
            key={id}
            type="button"
            className={pressed(vp === id)}
            aria-pressed={vp === id}
            onClick={() => setVp(id)}
          >
            {VIEWPORTS[id].label}
          </button>
        ))}
        <button
          type="button"
          className={pressed(mode === "pick")}
          aria-pressed={mode === "pick"}
          onClick={() => engine.toggleMode("pick")}
        >
          Pick
        </button>
        <pre data-testid="pp-picked" className="mono" style={PICKED}>
          {picked}
        </pre>
      </div>
    </ShadowRoot>
  );
}
