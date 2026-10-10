import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState, useSyncExternalStore } from "react";
import type { Entry } from "../../core/entry";
import { DEFAULT_TAGS } from "../labels";
import { toast } from "../primitives/toast";
import { DockedToaster } from "../dock/placement";
import { createFakeDeps, seedEntries } from "../shell/fake";
import { Sheet, type SheetTab } from "./sheet";

/**
 * The sheet is `position: fixed`, so it fills the right of the story canvas. Everything is wired to an
 * in-memory store: change a property, press Resolve, open the Publish tab and write the files.
 */
const meta: Meta = {
  title: "Shell/Sheet",
  parameters: { layout: "fullscreen" },
};
export default meta;
type Story = StoryObj;

interface HarnessProps {
  entries?: Entry[];
  tab?: SheetTab;
  selected?: string | null;
  side?: "left" | "right";
  /** Start with every entry waiting to be written. */
  unwritten?: boolean;
}

function Harness({ entries, tab = "entries", selected = null, side = "right", unwritten }: HarnessProps) {
  const [deps] = useState(() => createFakeDeps({ entries, written: unwritten ? false : undefined }));
  const { store } = deps;
  const { session, entries: list, pending } = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const [view, setView] = useState({ tab, selected });
  const [open, setOpen] = useState(true);
  return (
    <>
      <Sheet
        open={open}
        side={side}
        session={session}
        entries={list}
        pending={pending}
        tab={view.tab}
        onTabChange={(t) => setView((v) => ({ ...v, tab: t }))}
        selectedId={view.selected}
        onSelect={(id) => setView((v) => ({ ...v, selected: id }))}
        onClose={() => setOpen(false)}
        onWrite={() => store.write?.() ?? Promise.resolve()}
        ticket={{
          serialize: (e) => deps.serialize(e, session),
          entryPath: (e) => deps.entryPath(e, session),
          tagOptions: DEFAULT_TAGS,
          planOptions: ["§2 Feed and posts", "§5 Tournaments, player", "§6 Tournaments, organiser", "§7 Voice", "§11 Cross-cutting"],
          onShow: (e) => toast(`Show on page: ${e.id}`),
          onUpdate: (e, patch) => store.update(e.id, patch, "rachit"),
          onResolve: (e) => store.resolve(e.id, "rachit"),
        }}
      />
      {open ? null : (
        <button type="button" style={{ position: "fixed", right: 16, top: 16 }} onClick={() => setOpen(true)}>
          Reopen the sheet
        </button>
      )}
      <DockedToaster />
    </>
  );
}

const seeds = seedEntries();
const pickEntry = (n: number, patch: Partial<Entry> = {}): Entry => {
  const e = seeds.find((x) => x.n === n);
  if (!e) throw new Error(`no seed ${n}`);
  return { ...e, ...patch };
};

export const EmptyList: Story = { render: () => <Harness entries={[]} /> };

/** One group per status, newest first, with the priority, ID, status, title, viewport and time of each. */
export const PopulatedList: Story = { render: () => <Harness /> };

/** The sheet opens on the left when the dock is docked to the right edge. */
export const LeftSide: Story = { render: () => <Harness side="left" /> };

export const PublishTab: Story = {
  render: () => <Harness tab="publish" unwritten />,
};

export const PublishTabNothingToWrite: Story = {
  render: () => <Harness tab="publish" />,
};

export const TicketOpen: Story = {
  render: () => <Harness selected="PRO-3" />,
};

export const TicketInProgress: Story = {
  render: () => <Harness selected="PRO-2" />,
};

export const TicketResolved: Story = {
  render: () => (
    <Harness
      selected="PRO-1"
      entries={[
        pickEntry(1, {
          status: "resolved",
          activity: [
            { at: "2026-10-10T12:41:00Z", who: "rachit", text: "created" },
            { at: "2026-10-10T13:20:00Z", who: "rachit", text: "status: open → resolved" },
          ],
        }),
        pickEntry(2),
      ]}
    />
  ),
};

/** No snapshot was captured (or it was filed on another size): the ticket offers "Show on mobile". */
export const TicketWithoutSnapshot: Story = {
  render: () => <Harness selected="PRO-4" entries={[pickEntry(4, { status: "open", activity: [{ at: "2026-10-10T12:44:00Z", who: "rachit", text: "created" }] })]} />,
};
