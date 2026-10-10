import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState, type ComponentProps } from "react";
import { toast } from "../primitives/toast";
import { Dock, type DockTool, type DockViewport } from "./dock";
import type { DockPosition } from "./dock-math";
import { COLLAPSED_KEY, DOCK_KEY } from "./dock-storage";
import { DockedToaster } from "./placement";

/** Seeds what the dock restores from `localStorage` on mount, and clears it after the story. */
const seeded = (position?: DockPosition, collapsed = false) => () => {
  const clear = () => {
    localStorage.removeItem(DOCK_KEY);
    localStorage.removeItem(COLLAPSED_KEY);
  };
  clear();
  if (position) localStorage.setItem(DOCK_KEY, JSON.stringify(position));
  if (collapsed) localStorage.setItem(COLLAPSED_KEY, "1");
  return clear;
};

/**
 * The dock is `position: fixed`, so it sits at the bottom of the story canvas (or wherever the seeded
 * position puts it). Each story starts from a seeded `localStorage` and clears it afterwards; drag, flick it
 * to an edge, double-click the grip to reset, click the logo to collapse.
 */
const meta: Meta<typeof Dock> = {
  title: "Shell/Dock",
  component: Dock,
  args: { openCount: 3, viewport: "responsive", activeTool: "pick" },
  beforeEach: seeded(),
  parameters: { layout: "fullscreen" },
};
export default meta;
type Story = StoryObj<typeof Dock>;

export const Horizontal: Story = {};

export const VerticalLeft: Story = {
  beforeEach: seeded({ x: 12, y: 96, edge: "l" }),
};

export const VerticalRight: Story = {
  beforeEach: seeded({ x: 0, y: 96, edge: "r" }),
};

export const Collapsed: Story = {
  beforeEach: seeded(undefined, true),
};

/** Collapsed on an edge: only the grip and the logo, with the open count as a corner badge. */
export const CollapsedVertical: Story = {
  args: { openCount: 7 },
  beforeEach: seeded({ x: 12, y: 96, edge: "l" }, true),
};

export const IconStates: Story = {
  name: "Frozen, desktop, rotated, sheet open",
  args: { activeTool: "multi", frozen: true, viewport: "desktop", rotated: true, entriesOpen: true },
};

/** Fully wired to local state. Toasts (reset the position to see one) move to the end opposite the dock. */
export const Interactive: Story = {
  render: (args) => <InteractiveDock {...args} />,
};

function InteractiveDock(args: ComponentProps<typeof Dock>) {
  const [tool, setTool] = useState<DockTool | null>(args.activeTool ?? null);
  const [frozen, setFrozen] = useState(false);
  const [viewport, setViewport] = useState<DockViewport>("responsive");
  const [rotated, setRotated] = useState(false);
  const [entries, setEntries] = useState(false);
  return (
    <>
      <Dock
        {...args}
        activeTool={tool}
        frozen={frozen}
        viewport={viewport}
        rotated={rotated && viewport !== "responsive"}
        entriesOpen={entries}
        onTool={(t) => setTool((cur) => (cur === t ? null : t))}
        onFreeze={() => {
          setFrozen((f) => !f);
          toast(frozen ? "Motion resumed" : "Motion frozen on the page");
        }}
        onViewport={(v) => {
          setViewport(v);
          if (v === "responsive") setRotated(false);
        }}
        onRotate={() => setRotated((r) => !r)}
        onCommand={() => toast("Command menu")}
        onEntries={() => setEntries((e) => !e)}
        onCollapsedChange={(c) => {
          if (c) setTool(null);
        }}
      />
      <DockedToaster />
    </>
  );
}
