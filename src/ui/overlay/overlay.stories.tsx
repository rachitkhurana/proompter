import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { expect, userEvent, within } from "storybook/test";
import { PickEngine, type PickCommit, type PickMode } from "../../core/pick";
import { createPageSurface } from "../../core/surface";
import { Button } from "../primitives/button";
import { shadowOf } from "../primitives/story-frame";
import { BoxCatcher } from "./box-catcher";
import { HoverBox, HoverLabel } from "./hover";
import { MultiBar } from "./multi-bar";
import { Overlay, OverlayStyles } from "./overlay";
import type { PinModel } from "./pin-layout";
import { PinMarker } from "./pins";
import { SelectionBox } from "./selection";

const meta: Meta = { title: "Overlay/Pieces", parameters: { layout: "fullscreen" } };
export default meta;
type Story = StoryObj;

/** A dark page with one "element" outlined at a fixed screen position, so the fixed-position pieces have something to sit on. */
function Backdrop({ children, rect }: { children?: ReactNode; rect?: { left: number; top: number; width: number; height: number } }) {
  return (
    <>
      <OverlayStyles />
      <div style={{ position: "fixed", inset: 0, background: "#18181b" }} />
      {rect ? (
        <div
          style={{
            position: "fixed",
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height,
            background: "#3f3f46",
            borderRadius: 6,
          }}
        />
      ) : null}
      {children}
    </>
  );
}

const RECT = { left: 160, top: 140, width: 220, height: 64 };

export const HoverDefault: Story = {
  render: () => (
    <Backdrop rect={RECT}>
      <HoverBox rect={RECT} visible />
      <HoverLabel rect={RECT} visible label="img · avatar" source="src/app/(app)/feeds/avatar.tsx:6:7" inherited={false} walked={0} />
    </Backdrop>
  ),
};

export const HoverInheritedAndWalked: Story = {
  render: () => (
    <Backdrop rect={RECT}>
      <HoverBox rect={RECT} visible />
      <HoverLabel rect={RECT} visible label="PostCard" source="src/components/post-card.tsx:48:7" inherited walked={2} />
    </Backdrop>
  ),
};

export const HoverNoSource: Story = {
  render: () => (
    <Backdrop rect={RECT}>
      <HoverBox rect={RECT} visible />
      <HoverLabel rect={RECT} visible label="button “Share”" source={null} inherited={false} walked={0} />
    </Backdrop>
  ),
};

/** Within 34px of the top edge the label drops below the box instead of above. */
export const HoverLabelFlipsNearTop: Story = {
  render: () => {
    const r = { left: 40, top: 12, width: 260, height: 48 };
    return (
      <Backdrop rect={r}>
        <HoverBox rect={r} visible />
        <HoverLabel rect={r} visible label="header" source="src/app/layout.tsx:12:5" inherited={false} walked={0} />
      </Backdrop>
    );
  },
};

export const SelectionBoxes: Story = {
  render: () => (
    <Backdrop>
      <SelectionBox rect={{ left: 120, top: 120, width: 180, height: 56 }} index={1} />
      <SelectionBox rect={{ left: 340, top: 160, width: 120, height: 120 }} index={2} />
      <SelectionBox rect={{ left: 140, top: 220, width: 160, height: 40 }} index={3} />
    </Backdrop>
  ),
};

export const MultiBarShown: Story = {
  render: () => (
    <Backdrop>
      <MultiBar count={3} onClear={() => {}} onAdd={() => {}} dockRect={{ left: 400, top: 560, width: 320, height: 46 }} />
    </Backdrop>
  ),
};

export const MultiBarHidden: Story = {
  render: () => (
    <Backdrop>
      <MultiBar count={0} onClear={() => {}} onAdd={() => {}} />
    </Backdrop>
  ),
};

export const BoxSelect: Story = {
  render: () => (
    <Backdrop rect={{ left: 200, top: 160, width: 260, height: 120 }}>
      <BoxCatcher bounds={{ left: 0, top: 0, width: window.innerWidth, height: window.innerHeight }} onSelect={() => {}} />
    </Backdrop>
  ),
};

const pin = (over: Partial<PinModel> & Pick<PinModel, "id">) => ({
  title: "Avatar is cropped on mobile",
  priority: "important" as const,
  status: "open" as const,
  viewport: "mobile" as const,
  selector: null,
  ...over,
});

export const PinStates: Story = {
  render: () => (
    <Backdrop>
      <PinMarker pin={pin({ id: 1, priority: "blocking" })} x={120} y={120} fresh />
      <PinMarker pin={pin({ id: 2, priority: "important" })} x={200} y={120} fresh />
      <PinMarker pin={pin({ id: 3, priority: "minor" })} x={280} y={120} fresh />
      <PinMarker pin={pin({ id: 4, status: "resolved" })} x={360} y={120} fresh />
    </Backdrop>
  ),
};

/** Pins stacked on one spot fan out 28px apart. The card appears on hover or keyboard focus. */
export const PinStackAndCard: Story = {
  render: () => (
    <Backdrop>
      <PinMarker pin={pin({ id: 7, priority: "blocking", title: "Standings show the squad ID" })} x={300} y={160} fresh={false} />
      <PinMarker pin={pin({ id: 8 })} x={272} y={160} fresh={false} />
      <PinMarker pin={pin({ id: 9, priority: "minor" })} x={244} y={160} fresh={false} />
    </Backdrop>
  ),
  play: async ({ canvasElement }) => {
    const shadow = await shadowOf(canvasElement);
    const pin7 = within(shadow as unknown as HTMLElement).getByRole("button", { name: /PRO-7/ });
    await userEvent.hover(pin7);
    await expect(pin7.querySelector(".pm-pin-card")).not.toBeNull();
  },
};

export const PinPulse: Story = {
  render: () => (
    <Backdrop>
      <PinMarker pin={pin({ id: 3 })} x={240} y={160} fresh={false} pulse={{ id: 3, nonce: 1 }} />
    </Backdrop>
  ),
};

// ---------------------------------------------------------------------------------------------------------
// Live: the real engine on a stamped mock page (rendered outside the shadow root, as a host app would be).

const MOCK = `
<div style="font:14px system-ui;color:#e4e4e7;padding:24px;max-width:520px;margin:48px auto" data-src="mock/page.tsx:1:1" data-comp="MockPage">
  <article data-src="mock/post-card.tsx:20:5" data-comp="PostCard" style="padding:16px;border-radius:12px;background:#27272a;margin-bottom:16px">
    <header data-src="mock/post-card.tsx:22:7" style="display:flex;gap:12px;align-items:center">
      <div data-src="mock/avatar.tsx:5:5" data-comp="Avatar"><img class="avatar" alt="" width="40" height="40" style="border-radius:50%;background:#52525b;display:block" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='40'%3E%3Crect width='40' height='40' fill='%2352525b'/%3E%3C/svg%3E" data-src="mock/avatar.tsx:6:7"></div>
      <span data-src="mock/post-card.tsx:24:9">Rachit</span>
    </header>
    <p data-src="mock/post-card.tsx:26:7">Clutched a 1v4 against the whole lobby</p>
    <button data-src="mock/post-card.tsx:28:7" style="margin-top:8px">Share</button>
  </article>
</div>`;

function Live() {
  const [mode, setMode] = useState<PickMode>("idle");
  const [last, setLast] = useState("nothing picked yet");
  const { engine, surface } = useMemo(() => {
    const e = new PickEngine({
      onCommit: (c: PickCommit) =>
        setLast(
          c.kind === "element"
            ? `${c.target.label}  ${c.target.selector}`
            : c.kind === "multi" || c.kind === "box"
              ? `${c.kind}: ${c.targets.map((t) => t.label).join(", ")}`
              : c.kind === "text"
                ? `quote: ${c.quote}`
                : "page note",
        ),
      onModeChange: setMode,
    });
    return { engine: e, surface: createPageSurface(window) };
  }, []);

  useEffect(() => {
    const page = document.createElement("div");
    page.innerHTML = MOCK;
    document.body.appendChild(page);
    engine.attach(surface);
    return () => {
      engine.dispose();
      page.remove();
    };
  }, [engine, surface]);

  return (
    <>
      <Overlay surface={surface} engine={engine} viewport="responsive" />
      <div style={{ position: "fixed", left: 16, bottom: 16, display: "flex", gap: 8, alignItems: "center", zIndex: 100 }}>
        {(["pick", "multi", "box", "text", "note"] as const).map((m) => (
          <Button key={m} variant={mode === m ? "pri" : "default"} size="sm" onClick={() => engine.toggleMode(m)}>
            {m}
          </Button>
        ))}
        <span className="mono" style={{ color: "var(--fg-2)" }}>
          {last}
        </span>
      </div>
    </>
  );
}

/** Hover the mock post, press ↑ / [ to walk to the parent, ↓ / ] to come back; Alt + wheel works too. Esc leaves the mode. */
export const LiveEngine: Story = { render: () => <Live /> };
