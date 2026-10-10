import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import type { PickSurface, ViewportId } from "../../core/surface";
import { VIEWPORT_ORDER, VIEWPORTS } from "../../core/surface";
import { Button } from "../primitives/button";
import { ViewportStage } from "./viewport-stage";

const meta: Meta = {
  title: "Viewports/Stage",
  component: ViewportStage,
  parameters: { layout: "fullscreen" },
};
export default meta;
type Story = StoryObj;

/** A page for the frame to show: Storybook's own canvas, with a story that has something on it. */
const SAMPLE = () => `${window.location.origin}/iframe.html?viewMode=story&id=viewports-stage--sample-page`;

export const SamplePage: Story = {
  parameters: { layout: "padded" },
  render: () => (
    <div style={{ font: "14px system-ui", color: "#e4e4e7", background: "#18181b", padding: 24, minHeight: 600 }}>
      <h1 style={{ font: "600 20px system-ui" }}>Sample page</h1>
      <p>This page is what the device frames show.</p>
    </div>
  ),
};

function Demo({
  initial,
  rotated: initialRotated = false,
  url,
  dockVertical,
}: {
  initial: ViewportId;
  rotated?: boolean;
  url?: string;
  dockVertical?: boolean;
}) {
  const [vp, setVp] = useState<ViewportId>(initial);
  const [rotated, setRotated] = useState(initialRotated);
  const [surface, setSurface] = useState<PickSurface | null>(null);
  return (
    <>
      <ViewportStage
        viewport={vp}
        rotated={rotated}
        dockVertical={dockVertical}
        openOnSize={vp === "mobile" ? 1 : 0}
        url={url ?? SAMPLE()}
        onSurface={setSurface}
        onExit={() => setVp("responsive")}
      />
      <div style={{ position: "fixed", left: 16, bottom: 16, display: "flex", gap: 8, alignItems: "center", zIndex: 100 }}>
        {VIEWPORT_ORDER.map((id) => (
          <Button key={id} variant={vp === id ? "pri" : "default"} size="sm" onClick={() => setVp(id)}>
            {VIEWPORTS[id].label}
          </Button>
        ))}
        <Button size="sm" disabled={vp === "responsive"} onClick={() => setRotated((r) => !r)}>
          Rotate
        </Button>
        <span className="mono" style={{ color: "var(--fg-2)" }}>
          {surface ? `${surface.kind} · ${surface.viewport} · scale ${surface.scale.toFixed(2)}` : "no surface"}
        </span>
      </div>
    </>
  );
}

export const Mobile: Story = { render: () => <Demo initial="mobile" /> };
export const MobileRotated: Story = { render: () => <Demo initial="mobile" rotated /> };
export const Tablet: Story = { render: () => <Demo initial="tablet" /> };
export const Desktop: Story = { render: () => <Demo initial="desktop" /> };
export const Responsive: Story = { render: () => <Demo initial="responsive" /> };
export const WithVerticalDock: Story = { render: () => <Demo initial="mobile" dockVertical /> };

/** A cross-origin page can't be read (the same thing happens when X-Frame-Options or CSP refuses the frame). */
export const FramingRefused: Story = {
  render: () => <Demo initial="mobile" url="https://example.com/" />,
};
