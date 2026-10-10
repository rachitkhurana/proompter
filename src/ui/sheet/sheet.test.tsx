import { act, useState, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Entry } from "../../core/entry";
import { Toaster, toast } from "../primitives/toast";
import { createFakeDeps, fakeEntryPath, fakeSerialize, SEED_SESSION, seedEntries } from "../shell/fake";
import { mountInShadow, type Mounted } from "../test-utils";
import { Sheet, type SheetProps } from "./sheet";

let m: Mounted;
afterEach(async () => {
  await m?.unmount();
  toast.clear();
});

const mount = async (ui: ReactNode) => {
  m = await mountInShadow(ui, { css: "" });
};
const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 30))));
const q = <T extends Element = HTMLElement>(sel: string) => m.shadow().querySelector<T>(sel);
const qa = (sel: string) => Array.from(m.shadow().querySelectorAll<HTMLElement>(sel));
const key = (el: Element, k: string) =>
  act(async () => {
    el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, composed: true }));
  });

function props(over: Partial<SheetProps> = {}): SheetProps {
  return {
    open: true,
    side: "right",
    session: SEED_SESSION,
    entries: seedEntries(),
    pending: [],
    tab: "entries",
    onTabChange: vi.fn(),
    selectedId: null,
    onSelect: vi.fn(),
    onClose: vi.fn(),
    ticket: {
      serialize: (e: Entry) => fakeSerialize(e, SEED_SESSION),
      entryPath: (e: Entry) => fakeEntryPath(e, SEED_SESSION),
      tagOptions: ["ui", "data"],
      planOptions: ["§2 Feed and posts", "§7 Voice"],
      onShow: vi.fn(),
      onUpdate: vi.fn(),
      onResolve: vi.fn(),
    },
    ...over,
  };
}

describe("Sheet entries tab", () => {
  it("groups entries Open / In progress / Resolved, newest first, with counts", async () => {
    await mount(<Sheet {...props()} />);
    expect(qa(".grp").map((g) => g.textContent)).toEqual(["Open2", "In progress1", "Resolved1"]);
    expect(qa(".row").map((r) => r.querySelector(".id")?.textContent)).toEqual(["PRO-3", "PRO-1", "PRO-2", "PRO-4"]);
    const first = q(".row")!;
    expect(first.querySelector(".t")?.textContent).toBe("Should the voice chip show who is speaking?");
    expect(first.querySelector(".prio.important")).not.toBeNull();
    expect(first.querySelector(".st.open")).not.toBeNull();
  });

  it("shows the empty state, and the session in the header", async () => {
    await mount(<Sheet {...props({ entries: [] })} />);
    expect(q(".empty")?.textContent).toContain("No entries yet. Press P and click anything on the page.");
    expect(q(".sh-hd b")?.textContent).toBe("Manual test pass");
    expect(q(".sh-hd span:not(.logo)")?.textContent).toBe("migrate/main@611df0b · local · prod data (redacted)");
  });

  it("opens a ticket from a row, and Down/Up move between rows", async () => {
    const p = props();
    await mount(<Sheet {...p} />);
    const rows = qa(".row");
    rows[0]!.focus();
    await key(rows[0]!, "ArrowDown");
    expect(m.shadow().activeElement).toBe(rows[1]);
    await key(rows[1]!, "ArrowUp");
    expect(m.shadow().activeElement).toBe(rows[0]);
    await act(async () => rows[1]!.click());
    expect(p.onSelect).toHaveBeenCalledWith("PRO-1");
  });

  it("is inert and hidden from assistive tech while closed", async () => {
    await mount(<Sheet {...props({ open: false })} />);
    const sheet = q(".pm-sheet")!;
    expect(sheet.hasAttribute("inert")).toBe(true);
    expect(sheet.getAttribute("aria-hidden")).toBe("true");
    expect(sheet.classList.contains("on")).toBe(false);
  });

  it("opens on the left when asked", async () => {
    await mount(<Sheet {...props({ side: "left" })} />);
    expect(q(".pm-sheet")?.classList.contains("left")).toBe(true);
  });

  it("does not stay faded out when the side flips back before the move happens", async () => {
    let setSide!: (s: "left" | "right") => void;
    function SideHarness() {
      const [side, set] = useState<"left" | "right">("right");
      setSide = set;
      return <Sheet {...props({ side })} />;
    }
    await mount(<SideHarness />);
    await act(async () => setSide("left"));
    expect(q(".pm-sheet")!.style.opacity).toBe("0");
    await act(async () => setSide("right")); // quick flip back, inside the 150ms
    expect(q(".pm-sheet")!.style.opacity).toBe("");
    await act(async () => void (await new Promise((r) => setTimeout(r, 220))));
    expect(q(".pm-sheet")!.style.opacity).toBe("");
    expect(q(".pm-sheet")!.classList.contains("left")).toBe(false);
  });

  it("fades out, moves and fades back in when the side changes while open (no slide across)", async () => {
    let setSide!: (s: "left" | "right") => void;
    function SideHarness() {
      const [side, set] = useState<"left" | "right">("right");
      setSide = set;
      return <Sheet {...props({ side })} />;
    }
    await mount(<SideHarness />);
    const sheet = () => q(".pm-sheet")!;
    expect(sheet().classList.contains("left")).toBe(false);
    await act(async () => setSide("left"));
    expect(sheet().style.opacity).toBe("0");
    expect(sheet().classList.contains("left")).toBe(false); // still on the old side while faded out
    await act(async () => void (await new Promise((r) => setTimeout(r, 220))));
    expect(sheet().classList.contains("left")).toBe(true);
    expect(sheet().style.opacity).toBe("");
  });
});

describe("Sheet publish tab", () => {
  it("lists the pending files and writes them", async () => {
    const onWrite = vi.fn(() => Promise.resolve());
    const { store } = createFakeDeps({ written: false });
    const snap = store.getSnapshot();
    await mount(<Sheet {...props({ tab: "publish", entries: [...snap.entries], pending: snap.pending, onWrite })} />);
    const tree = qa(".tree > div").map((d) => d.textContent);
    expect(tree[0]).toBe("~ session.md");
    expect(tree).toContain("+ entries/001-standings-show-the-squad-id-instead-of-its.md");
    expect(tree).toContain("+ assets/004-mobile.png");
    expect(tree).toHaveLength(1 + 4 * 2);
    const write = qa("button").find((b) => b.textContent?.startsWith("Write"))!;
    expect(write.textContent).toBe("Write 9 files");
    await act(async () => write.click());
    expect(onWrite).toHaveBeenCalledOnce();
  });

  it("says when everything is written, and disables the button", async () => {
    await mount(<Sheet {...props({ tab: "publish", pending: [] })} />);
    expect(q(".tree")?.textContent).toBe("Everything is written. Nothing new to commit.");
    expect(qa("button").find((b) => b.textContent?.startsWith("Write"))?.getAttribute("aria-disabled")).toBe("true");
  });

  it("marks the GitHub section as v2 and keeps its button disabled", async () => {
    await mount(<Sheet {...props({ tab: "publish" })} />);
    expect(q("#pm-pub-issues")?.textContent).toContain("v2");
    const open = qa("button").find((b) => b.textContent?.startsWith("Open "))!;
    expect(open.getAttribute("aria-disabled")).toBe("true");
    // Open fix/change entries without an issue: PRO-2 (change). PRO-1 already has one; PRO-3 is a question.
    expect(qa(".irow").map((r) => r.children[1]?.textContent)).toEqual(["Like counts twice on a double-tap"]);
  });
});

describe("Ticket in the sheet", () => {
  it("shows title, description, properties, where, context, activity and the footer", async () => {
    await mount(<Sheet {...props({ selectedId: "PRO-1" })} />);
    expect(q(".tk-title")?.textContent).toContain("Standings show the squad ID");
    expect(q(".tk-crumb")?.textContent).toContain("Manual test pass");
    expect(q(".tk-crumb")?.textContent).toContain("PRO-1");
    const text = q(".tk")!.textContent!;
    for (const s of ["Status", "Priority", "Intent", "Viewport", "Tags", "Test plan", "GitHub", "#481"]) expect(text).toContain(s);
    // Where: crumb chain, inherited-source arrow absent here (own source), element, task, route.
    expect(qa(".crumbs > span").map((s) => s.textContent)).toEqual(["TournamentDetail", "StandingsPanel", "StandingsRow"]);
    expect(q('[aria-label^="Copy source"]')?.textContent).toContain("standings-panel.tsx:87:5");
    expect(q('[aria-label^="Copy source"]')?.textContent).not.toContain("↳");
    expect(text).toContain("T-tournament-standings-edit");
    expect(text).toContain("/feeds");
    // Captured context: console first, then the network tab with the failed count.
    expect(qa(".log > div").map((d) => d.children[1]?.textContent)).toEqual(["error", "warn"]);
    expect(q('[role="tab"][aria-selected="false"]')?.textContent).toBe("Network 1");
    // Footer.
    expect(qa(".sh-ft button").map((b) => b.textContent)).toEqual(["Show on page", "Copy for agent", "Resolve"]);
    expect(qa(".act > div")).toHaveLength(2);
  });

  it("marks an inherited source with ↳", async () => {
    await mount(<Sheet {...props({ selectedId: "PRO-4" })} />);
    expect(q('[aria-label^="Copy source"]')?.textContent).toContain("↳ feed-tabs.tsx:18:5");
  });

  it("switches the Captured context tabs", async () => {
    await mount(<Sheet {...props({ selectedId: "PRO-1" })} />);
    const network = qa('[role="tab"]').find((t) => t.textContent?.startsWith("Network"))!;
    await act(async () => network.click());
    expect(qa(".log > div")).toHaveLength(4);
    expect(qa(".log > div .e").map((s) => s.textContent)).toEqual(["500"]);
  });

  it("Snapshot: Element/Viewport toggle when both PNGs exist, 'Show on mobile' when there is none", async () => {
    await mount(<Sheet {...props({ selectedId: "PRO-1" })} />);
    expect(qa(".snap .mode button").map((b) => b.textContent)).toEqual(["Element", "Viewport"]);
    expect(q(".snap img")?.getAttribute("src")).toContain("data:image/svg+xml");
    expect(q(".snap .cap")?.textContent).toContain("001-responsive.png");
    await act(async () => qa(".snap .mode button")[1]!.click());
    expect(q(".snap .cap")?.textContent).toContain("001-responsive-full.png");
    await m.unmount();

    const onShow = vi.fn();
    const p = props({ selectedId: "PRO-4" });
    await mount(<Sheet {...p} ticket={{ ...p.ticket, onShow }} />);
    expect(q(".snap")).not.toBeNull();
    expect(q(".snap img")).toBeNull();
    const show = qa(".snap-empty button")[0]!;
    expect(show.textContent).toBe("Show on mobile");
    await act(async () => show.click());
    expect(onShow).toHaveBeenCalledWith(expect.objectContaining({ id: "PRO-4" }));
  });

  it("Resolve and Reopen", async () => {
    const p = props({ selectedId: "PRO-1" });
    await mount(
      <>
        <Sheet {...p} />
        <Toaster />
      </>,
    );
    await act(async () => qa(".sh-ft button")[2]!.click());
    expect(p.ticket.onResolve).toHaveBeenCalledWith(expect.objectContaining({ id: "PRO-1" }));
    // PRO-1 has an issue (#481), but nothing closes issues in v1, so the toast does not say so.
    expect(q(".toast")?.textContent).toBe("PRO-1 resolved");
    await m.unmount();

    const q4 = props({ selectedId: "PRO-4" });
    await mount(<Sheet {...q4} />);
    const reopen = qa(".sh-ft button")[2]!;
    expect(reopen.textContent).toBe("Reopen");
    await act(async () => reopen.click());
    expect(q4.ticket.onUpdate).toHaveBeenCalledWith(expect.objectContaining({ id: "PRO-4" }), { status: "open" });
  });

  it("edits a property from a menu, with the keyboard", async () => {
    const p = props({ selectedId: "PRO-1" });
    await mount(<Sheet {...p} />);
    const status = q<HTMLButtonElement>('[aria-label^="Status:"]')!;
    status.focus();
    await key(status, "ArrowDown"); // opens the menu with item 0 (Open, checked) focused
    await settle();
    const items = () => qa('[role^="menuitem"]');
    expect(items().map((i) => i.textContent)).toEqual(["Open", "In progress", "Resolved"]);
    const active = () => m.shadow().activeElement;
    await key(active()!, "ArrowDown");
    expect(active()).toBe(items()[1]);
    await key(active()!, "Enter");
    expect(p.ticket.onUpdate).toHaveBeenCalledWith(expect.objectContaining({ id: "PRO-1" }), { status: "progress" });
  });

  it("toggles tags in a menu that stays open, and unlinks the test plan with null", async () => {
    const p = props({ selectedId: "PRO-1" });
    await mount(<Sheet {...p} />);
    const tags = q<HTMLButtonElement>('[aria-label^="Tags:"]')!;
    tags.focus();
    await key(tags, "ArrowDown");
    await settle();
    // PRO-1 has data + regression; the menu offers the options plus what it already has.
    expect(qa('[role^="menuitem"]').map((i) => i.textContent)).toEqual(["ui", "data", "regression"]);
    await key(m.shadow().activeElement!, "Enter"); // ui on
    expect(p.ticket.onUpdate).toHaveBeenLastCalledWith(expect.objectContaining({ id: "PRO-1" }), { tags: ["data", "regression", "ui"] });
    expect(q('[role="menu"]')).not.toBeNull();
    await key(m.shadow().activeElement!, "Escape");
    await settle();

    const plan = q<HTMLButtonElement>('[aria-label^="Test plan:"]')!;
    plan.focus();
    await key(plan, "ArrowDown");
    await settle();
    expect(qa('[role^="menuitem"]').map((i) => i.textContent)).toEqual(["Not linked", "§2 Feed and posts", "§7 Voice", "§6 Tournaments, organiser"]);
    await key(m.shadow().activeElement!, "Enter");
    expect(p.ticket.onUpdate).toHaveBeenLastCalledWith(expect.objectContaining({ id: "PRO-1" }), { testPlan: null });
  });

  it("the back button returns to the list", async () => {
    const p = props({ selectedId: "PRO-1" });
    await mount(<Sheet {...p} />);
    await act(async () => q<HTMLElement>('[aria-label="Back to entries"]')!.click());
    expect(p.onSelect).toHaveBeenCalledWith(null);
  });

  it("shows the markdown from the serializer on demand", async () => {
    await mount(<Sheet {...props({ selectedId: "PRO-1" })} />);
    expect(q(".md")).toBeNull();
    expect(q(".tk-sec .hint")?.textContent).toBe(
      "reviews/2026-10-10_manual-test-pass/entries/001-standings-show-the-squad-id-instead-of-its.md",
    );
    const toggle = qa(".tk-sec button").find((b) => b.textContent === "Show markdown")!;
    await act(async () => toggle.click());
    expect(q(".md")?.textContent).toContain("id: PRO-1");
    expect(q(".md")?.textContent).toContain("# Standings show the squad ID");
  });
});
