import { act, useState, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { seedEntries } from "../shell/fake";
import { mountInShadow, type Mounted } from "../test-utils";
import { Command } from "./command";
import { buildCommandItems, filterCommands, type CommandContext } from "./items";

let m: Mounted;
afterEach(async () => {
  await m?.unmount();
  m = undefined as unknown as Mounted; // the pure-function tests mount nothing
});

const ctx = (over: Partial<CommandContext> = {}): CommandContext => ({
  viewport: "responsive",
  frozen: false,
  entries: seedEntries(),
  pendingFiles: 0,
  onTool: vi.fn(),
  onFreeze: vi.fn(),
  onViewport: vi.fn(),
  onOpenEntry: vi.fn(),
  onAllEntries: vi.fn(),
  onPublish: vi.fn(),
  ...over,
});

let openIt: () => void = () => {};
function Harness({
  context,
  onOpenChange,
  initialOpen = true,
}: {
  context: CommandContext;
  onOpenChange?: (o: boolean) => void;
  initialOpen?: boolean;
}) {
  const [open, setOpen] = useState(initialOpen);
  openIt = () => setOpen(true);
  return (
    <Command
      animated={false}
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        onOpenChange?.(o);
      }}
      items={buildCommandItems(context)}
    />
  );
}

// `css: ""`: no CSS animations, so Radix's Presence unmounts without waiting on `animationend`.
const mount = async (ui: ReactNode) => {
  m = await mountInShadow(ui, { css: "" });
};
const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 30))));
const input = () => m.shadow().querySelector<HTMLInputElement>('input[role="combobox"]')!;
const options = () => Array.from(m.shadow().querySelectorAll<HTMLElement>('[role="option"]'));
const labels = () => options().map((o) => o.children[1]?.textContent);
const activeLabel = () => options().find((o) => o.getAttribute("aria-selected") === "true")?.children[1]?.textContent;
const sections = () => Array.from(m.shadow().querySelectorAll('[role="group"] > .cmd-sec')).map((s) => s.textContent);

const key = (k: string, el: Element = input()) =>
  act(async () => {
    el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, composed: true }));
  });
const type = (value: string) =>
  act(async () => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    set.call(input(), value);
    input().dispatchEvent(new Event("input", { bubbles: true }));
  });

describe("filterCommands", () => {
  const items = buildCommandItems(ctx());
  it("matches the label or the sub-label, ignoring case", () => {
    expect(filterCommands(items, "TABLET").map((i) => i.label)).toEqual(["Tablet"]);
    expect(filterCommands(items, "834").map((i) => i.label)).toEqual(["Tablet"]);
    expect(filterCommands(items, "").length).toBe(items.length);
    expect(filterCommands(items, "zzz")).toEqual([]);
  });
});

describe("buildCommandItems", () => {
  it("lists tools, viewports, open entries (not resolved), then the session actions", () => {
    const items = buildCommandItems(ctx({ viewport: "mobile", frozen: true }));
    const sec = (s: string) => items.filter((i) => i.section === s).map((i) => i.label);
    expect(sec("Review")).toEqual([
      "Pick element",
      "Select several elements",
      "Box select",
      "Quote text",
      "Page note",
      "Resume motion",
    ]);
    expect(sec("Viewport")).toEqual(["Responsive", "Desktop", "Tablet", "Mobile"]);
    // Newest first, and the resolved PRO-4 is left out.
    expect(sec("Entries")).toEqual([
      "Should the voice chip show who is speaking?",
      "Like counts twice on a double-tap",
      "Standings show the squad ID instead of its name after finalize",
    ]);
    expect(sec("Session")).toEqual(["All entries", "Publish session"]);
    expect(items.find((i) => i.id === "tool-pick")?.sub).toBe("on mobile");
  });
});

describe("Command", () => {
  it("renders in the shadow root, in sections, with the first item active and the search focused", async () => {
    await mount(<Harness context={ctx()} />);
    await settle();
    expect(m.shadow().querySelector('[role="dialog"]')).not.toBeNull();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(sections()).toEqual(["Review", "Viewport", "Entries", "Session"]);
    expect(activeLabel()).toBe("Pick element");
    expect(m.shadow().activeElement).toBe(input());
  });

  it("filters as you type and starts again from the top", async () => {
    await mount(<Harness context={ctx()} />);
    await key("ArrowDown");
    await key("ArrowDown");
    expect(activeLabel()).toBe("Box select");
    await type("ta");
    expect(labels()).toEqual([
      "Tablet",
      "Like counts twice on a double-tap",
      "Standings show the squad ID instead of its name after finalize",
    ]);
    expect(activeLabel()).toBe("Tablet");
    await type("nothing like this");
    expect(options()).toHaveLength(0);
    expect(m.shadow().textContent).toContain("Nothing matches “nothing like this”.");
  });

  it("moves with ArrowDown and ArrowUp, wrapping at both ends", async () => {
    await mount(<Harness context={ctx()} />);
    const n = options().length;
    await key("ArrowUp");
    expect(options().findIndex((o) => o.getAttribute("aria-selected") === "true")).toBe(n - 1);
    expect(activeLabel()).toBe("Publish session");
    await key("ArrowDown");
    expect(activeLabel()).toBe("Pick element");
    await key("ArrowDown");
    expect(activeLabel()).toBe("Select several elements");
    expect(input().getAttribute("aria-activedescendant")).toBe(options()[1]?.id);
  });

  it("Home and End jump to the ends", async () => {
    await mount(<Harness context={ctx()} />);
    await key("End");
    expect(activeLabel()).toBe("Publish session");
    await key("Home");
    expect(activeLabel()).toBe("Pick element");
  });

  it("Enter runs the active command", async () => {
    const c = ctx();
    await mount(<Harness context={c} />);
    await type("tablet");
    await key("Enter");
    expect(c.onViewport).toHaveBeenCalledWith("tablet");
    await type("all entries");
    await key("Enter");
    expect(c.onAllEntries).toHaveBeenCalledOnce();
  });

  it("runs the right tool, and an entry opens by its ID", async () => {
    const c = ctx();
    await mount(<Harness context={c} />);
    await key("ArrowDown");
    await key("ArrowDown");
    await key("Enter");
    expect(c.onTool).toHaveBeenCalledWith("box");
    await type("PRO-3");
    await key("Enter");
    expect(c.onOpenEntry).toHaveBeenCalledWith("PRO-3");
  });

  it("a click runs a command, and hovering moves the highlight", async () => {
    const c = ctx();
    await mount(<Harness context={c} />);
    const third = options()[2]!;
    await act(async () => {
      third.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, composed: true }));
    });
    expect(activeLabel()).toBe("Box select");
    await act(async () => third.click());
    expect(c.onTool).toHaveBeenCalledWith("box");
  });

  it("ignores IME composition keys", async () => {
    const c = ctx();
    await mount(<Harness context={c} />);
    const composing = (k: string) =>
      act(async () => {
        input().dispatchEvent(
          new KeyboardEvent("keydown", { key: k, isComposing: true, bubbles: true, cancelable: true, composed: true }),
        );
      });
    await composing("ArrowDown");
    expect(activeLabel()).toBe("Pick element");
    await composing("Enter");
    expect(c.onTool).not.toHaveBeenCalled();
    const legacy = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true, composed: true });
    Object.defineProperty(legacy, "keyCode", { value: 229 });
    await act(async () => void input().dispatchEvent(legacy));
    expect(c.onTool).not.toHaveBeenCalled();
  });

  it("traps Tab and Shift+Tab on the search field", async () => {
    await mount(<Harness context={ctx()} />);
    for (const shiftKey of [false, true]) {
      const ev = new KeyboardEvent("keydown", { key: "Tab", shiftKey, bubbles: true, cancelable: true, composed: true });
      await act(async () => void input().dispatchEvent(ev));
      expect(ev.defaultPrevented).toBe(true);
      expect(m.shadow().activeElement).toBe(input());
    }
  });

  it("closes on a click outside (the scrim)", async () => {
    const onOpenChange = vi.fn();
    await mount(<Harness context={ctx()} onOpenChange={onOpenChange} />);
    await act(async () => {
      m.shadow().querySelector(".pm-scrim")!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, composed: true }));
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(m.shadow().querySelector('[role="dialog"]')).toBeNull();
  });

  it("leaves the host document alone: no styles, body attributes, scroll lock, pointer-events or aria-hidden", async () => {
    const sibling = document.createElement("main");
    document.body.appendChild(sibling);
    const snap = () => ({
      head: document.head.innerHTML,
      bodyAttrs: Array.from(document.body.attributes).map((a) => `${a.name}=${a.value}`),
      bodyStyle: document.body.style.cssText,
      htmlStyle: document.documentElement.style.cssText,
      siblings: Array.from(document.body.children)
        .filter((c) => c.localName !== "proompter-root")
        .map((c) => c.outerHTML),
    });
    await mount(<Harness context={ctx()} initialOpen={false} />);
    const before = snap(); // after the shadow root (and its fonts tag) exist; only opening the menu is measured
    await act(async () => openIt());
    await settle();
    expect(m.shadow().querySelector('[role="dialog"]')).not.toBeNull();
    const after = snap();
    expect(after.head).toBe(before.head);
    expect(after.bodyAttrs).toEqual(before.bodyAttrs);
    expect(after.bodyStyle).toBe(before.bodyStyle);
    expect(after.htmlStyle).toBe(before.htmlStyle);
    expect(sibling.hasAttribute("aria-hidden")).toBe(false);
    expect(document.body.querySelectorAll("[aria-hidden],[data-scroll-locked],[inert]")).toHaveLength(0);
    expect(after.siblings).toEqual(before.siblings);
    sibling.remove();
  });

  it("when animated, the scrim and the dialog both stay through the 200ms closing phase, then go together", async () => {
    let setOpen!: (o: boolean) => void;
    function Animated() {
      const [open, set] = useState(true);
      setOpen = set;
      return <Command open={open} onOpenChange={set} items={buildCommandItems(ctx())} />;
    }
    await mount(<Animated />);
    const state = (sel: string) => m.shadow().querySelector(sel)?.getAttribute("data-state");
    expect(state(".pm-scrim")).toBe("open");
    expect(state(".pm-cmd")).toBe("open");
    await act(async () => setOpen(false));
    expect(state(".pm-scrim")).toBe("closed");
    expect(state(".pm-cmd")).toBe("closed");
    await act(async () => void (await new Promise((r) => setTimeout(r, 260))));
    expect(m.shadow().querySelector(".pm-scrim")).toBeNull();
    expect(m.shadow().querySelector(".pm-cmd")).toBeNull();
  });

  it("Escape closes it", async () => {
    const onOpenChange = vi.fn();
    await mount(<Harness context={ctx()} onOpenChange={onOpenChange} />);
    await key("Escape");
    await settle();
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(m.shadow().querySelector('[role="dialog"]')).toBeNull();
  });
});
