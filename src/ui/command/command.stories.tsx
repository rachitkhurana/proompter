import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { toast } from "../primitives/toast";
import { DockedToaster } from "../dock/placement";
import { seedEntries } from "../shell/fake";
import { Command } from "./command";
import { buildCommandItems } from "./items";

/**
 * The command menu (`⌘K`). Type to filter, Up/Down to move, Enter to run, Esc to close. Running a command
 * toasts it here; in the kit it does what the dock button does.
 */
const meta: Meta = {
  title: "Shell/Command menu",
  parameters: { layout: "fullscreen" },
};
export default meta;
type Story = StoryObj;

function Harness({ query = "", frozen = false }: { query?: string; frozen?: boolean }) {
  const [open, setOpen] = useState(true);
  const say = (m: string) => () => {
    setOpen(false);
    toast(m);
  };
  const items = buildCommandItems({
    viewport: "mobile",
    frozen,
    entries: seedEntries(),
    pendingFiles: 5,
    onTool: (t) => say(`Tool: ${t}`)(),
    onFreeze: say("Freeze"),
    onViewport: (v) => say(`Viewport: ${v}`)(),
    onOpenEntry: (id) => say(`Open ${id}`)(),
    onAllEntries: say("All entries"),
    onPublish: say("Publish"),
  });
  return (
    <>
      <Command open={open} onOpenChange={setOpen} items={items} defaultQuery={query} />
      {open ? null : (
        <button type="button" style={{ position: "fixed", left: 16, top: 16 }} onClick={() => setOpen(true)}>
          Open the command menu
        </button>
      )}
      <DockedToaster />
    </>
  );
}

export const Default: Story = { render: () => <Harness /> };

/** Typing "ta" keeps what contains it, across sections: the Tablet viewport, and the entries "Standings…" and "…double-tap". */
export const Filtered: Story = { render: () => <Harness query="ta" /> };

export const NothingMatches: Story = { render: () => <Harness query="zzz" /> };

export const FrozenMotion: Story = { render: () => <Harness frozen /> };
