import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";
import type { ProompterPlugin } from "../../core/entry";
import type { PickCommit } from "../../core/pick";
import { resolveTarget } from "../../core/resolve";
import { createPageSurface, VIEWPORTS, type Rect } from "../../core/surface";
import { Button } from "../primitives/button";
import { Toaster, toast } from "../primitives/toast";
import { shadowOf } from "../primitives/story-frame";
import { Composer, type ComposerHandle, type ComposerResult } from "./composer";
import { createMemoryStore, createStubCapture, mountMockPage, samplePlugin } from "./composer-fixtures";
import { unionBox } from "./place";

/**
 * The composer is `position: fixed`, anchored to the target on a small stamped page that these stories add to the
 * document (the pale card at the top left). Close it (Esc, click outside, Cancel, or file an entry) and use
 * "Reopen" to see it grow out of the target again. Context and snapshot come from a stub capture; the store is
 * in memory.
 */
const meta: Meta = {
  title: "Composer/Composer",
  parameters: { layout: "fullscreen" },
};
export default meta;
type Story = StoryObj;

type Case = "element" | "inherited" | "multi" | "box" | "text" | "note";

const screenRect = (el: Element): Rect => {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
};

function buildCommit(kind: Case, els: ReturnType<typeof mountMockPage>["els"]): PickCommit {
  switch (kind) {
    case "element":
      return { kind: "element", target: resolveTarget(els.avatar) };
    case "inherited":
      // The ring has no `data-src` of its own: the source comes from the Avatar component, shown with ↳.
      return { kind: "element", target: resolveTarget(els.ring) };
    case "multi":
      return { kind: "multi", targets: [els.avatar, els.text, els.share].map(resolveTarget) };
    case "box":
      return {
        kind: "box",
        targets: [els.avatar, els.text].map(resolveTarget),
        rect: unionBox([screenRect(els.avatar), screenRect(els.text)]) as Rect,
      };
    case "text":
      return {
        kind: "text",
        quote: "Clutched a 1v4 in the final round",
        target: resolveTarget(els.text),
        rect: screenRect(els.text),
      };
    default:
      return { kind: "note" };
  }
}

function Harness({ kind, plugins }: { kind: Case; plugins?: readonly ProompterPlugin[] }) {
  const [commit, setCommit] = useState<PickCommit | null>(null);
  const handle = useRef<ComposerHandle>(null);
  const [result, setResult] = useState<ComposerResult | null>(null);
  const [round, setRound] = useState(0);
  const surface = useMemo(() => createPageSurface(window), []);
  const capture = useMemo(() => createStubCapture(), []);
  const store = useMemo(() => createMemoryStore({ plugins }), [plugins]);

  useLayoutEffect(() => {
    const page = mountMockPage();
    setCommit(buildCommit(kind, page.els));
    return page.dispose;
  }, [kind, round]);

  // The root owns Esc and the "saved" toast; this harness stands in for it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) handle.current?.discard();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  const onClose = (r: ComposerResult) => {
    if (r.type === "saved") {
      toast(
        <>
          <b style={{ fontWeight: 500 }}>{r.entry.id}</b> saved on {VIEWPORTS[r.entry.viewport].label.toLowerCase()}
        </>,
      );
    }
    setResult(r);
  };

  const size = surface.size();
  return (
    <>
      {commit && !result ? (
        <Composer
          key={round}
          ref={handle}
          commit={commit}
          surface={surface}
          viewport="responsive"
          size={size}
          rotated={false}
          route="/feeds"
          capture={capture}
          store={store}
          plugins={plugins}
          onClose={onClose}
        />
      ) : (
        <div style={{ position: "fixed", left: 16, bottom: 16, display: "flex", gap: 12, alignItems: "center", zIndex: 100 }}>
          <Button
            variant="pri"
            onClick={() => {
              setResult(null);
              setRound((r) => r + 1);
            }}
          >
            Reopen
          </Button>
          <span style={{ font: "12px var(--sans)", color: "var(--fg-3)" }}>
            {result?.type === "saved" ? `Saved ${result.entry.id}: ${result.entry.title}` : "Discarded"}
          </span>
        </div>
      )}
      <Toaster />
    </>
  );
}

export const Element: Story = { render: () => <Harness kind="element" /> };

/** The ring has no source of its own: the chip reads `↳ avatar.tsx:9:3`, and "Context attached" says "nearest component". */
export const InheritedSource: Story = { render: () => <Harness kind="inherited" /> };

export const MultiSelect: Story = { render: () => <Harness kind="multi" /> };

export const BoxSelect: Story = { render: () => <Harness kind="box" /> };

/** A text selection: the quote sits above the title. */
export const TextQuote: Story = { render: () => <Harness kind="text" /> };

/** No target: centred, 16% down. */
export const PageNote: Story = { render: () => <Harness kind="note" /> };

const plugins = [samplePlugin];

/** A plugin supplies the read-only Task chip (coral outline) and the Test plan menu. */
export const WithPlugin: Story = { render: () => <Harness kind="element" plugins={plugins} /> };

export const TitleRequired: Story = {
  render: () => <Harness kind="element" />,
  play: async ({ canvasElement }) => {
    const shadow = await shadowOf(canvasElement);
    const s = within(shadow as unknown as HTMLElement);
    await userEvent.click(await s.findByRole("button", { name: /create entry/i }));
    await waitFor(() => expect(s.getByText(/Add a title/)).toBeVisible());
    // Typing a title clears the message.
    await userEvent.type(s.getByLabelText("Title"), "x");
    await waitFor(() => expect(s.getByText(/Add a title/)).not.toBeVisible());
  },
};

export const FilesAnEntry: Story = {
  render: () => <Harness kind="element" plugins={plugins} />,
  play: async ({ canvasElement }) => {
    const shadow = await shadowOf(canvasElement);
    const s = within(shadow as unknown as HTMLElement);
    await userEvent.type(await s.findByLabelText("Title"), "Avatar is cropped on mobile");
    await userEvent.keyboard("{Meta>}{Enter}{/Meta}");
    await waitFor(() => expect(s.getByText(/saved on responsive/)).toBeVisible());
  },
};
