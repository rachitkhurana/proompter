import { useState } from "react";
import { toast } from "../primitives/toast";
import { ShadowRoot } from "../shadow-root";
import { Dock, type DockTool, type DockViewport } from "./dock";
import { DockedToaster } from "./placement";

/**
 * Test-only harness, exported through `@rachitkay/proompter/internal/fixtures` (see src/internal/fixtures.ts).
 * Mounts the dock in a real shadow root, wired to local state, and prints that state for the e2e test.
 * Not public API.
 */
export function DockHarness() {
  const [tool, setTool] = useState<DockTool | null>(null);
  const [frozen, setFrozen] = useState(false);
  const [viewport, setViewport] = useState<DockViewport>("responsive");
  const [rotated, setRotated] = useState(false);
  const [entries, setEntries] = useState(false);
  const [command, setCommand] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [position, setPosition] = useState("default");

  return (
    <>
      <output data-testid="state" style={{ display: "block", fontFamily: "monospace" }}>
        {`tool=${tool ?? "none"} frozen=${frozen} viewport=${viewport} rotated=${rotated} entries=${entries} command=${command} collapsed=${collapsed} position=${position}`}
      </output>
      <ShadowRoot>
        <Dock
          activeTool={tool}
          frozen={frozen}
          viewport={viewport}
          rotated={rotated}
          entriesOpen={entries}
          commandOpen={command}
          openCount={3}
          onTool={(t) => setTool((cur) => (cur === t ? null : t))}
          onFreeze={() => {
            setFrozen(!frozen);
            toast(frozen ? "Motion resumed" : "Motion frozen on the page");
          }}
          onViewport={(v) => {
            setViewport(v);
            if (v === "responsive") setRotated(false);
          }}
          onRotate={() => setRotated((r) => !r)}
          onCommand={() => setCommand((c) => !c)}
          onEntries={() => setEntries((e) => !e)}
          onCollapsedChange={(c) => {
            setCollapsed(c);
            if (c) setTool(null);
          }}
          onPositionChange={(p) =>
            setPosition(p ? `${p.edge ?? "free"}:${Math.round(p.x)},${Math.round(p.y)}` : "default")
          }
        />
        <DockedToaster />
      </ShadowRoot>
    </>
  );
}
