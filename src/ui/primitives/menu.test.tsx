import { act, useState, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mountInShadow, type Mounted } from "../test-utils";
import { Chip } from "./chip";
import { Menu } from "./menu";

let m: Mounted;
afterEach(async () => {
  await m.unmount();
});

const mount = async (ui: ReactNode) => {
  // `css: ""`: no CSS animations, so the menu unmounts at once instead of waiting on `animationend`.
  m = await mountInShadow(ui, { css: "" });
};
const key = (el: Element, k: string) =>
  act(async () => {
    // `composed`, like real key events (the shell listens on `document`, outside the shadow root).
    el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, composed: true }));
  });
const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 30))));
const items = () => Array.from(m.shadow().querySelectorAll('[role^="menuitem"]'));
const menu = () => m.shadow().querySelector('[role="menu"]');
/** Keyboard events go to whatever has focus, as in a browser. */
const focused = () => m.shadow().activeElement ?? menu()!;
const focusedIndex = () => items().indexOf(focused());

function Single({ onPick }: { onPick: (k: string) => void }) {
  return (
    <Menu
      trigger={<Chip as="button">Open</Chip>}
      selection="single"
      items={[
        { key: "a", label: "Alpha", checked: true },
        { key: "b", label: "Beta" },
        { key: "c", label: "Gamma" },
      ]}
      onSelect={onPick}
    />
  );
}

function Multi({ onChange }: { onChange: (tags: string[]) => void }) {
  const [tags, setTags] = useState<string[]>([]);
  return (
    <Menu
      trigger={<Chip as="button">Tags</Chip>}
      selection="multiple"
      items={["ui", "data", "copy"].map((t) => ({ key: t, label: t, checked: tags.includes(t) }))}
      onSelect={(t) => {
        const next = tags.includes(t) ? tags.filter((x) => x !== t) : [...tags, t];
        setTags(next);
        onChange(next);
      }}
    />
  );
}

async function openWithKeyboard() {
  const trigger = m.shadow().querySelector("button")!;
  trigger.focus();
  await key(trigger, "ArrowDown");
  await settle();
}

describe("Menu", () => {
  it("opens from the keyboard and portals into the shadow root", async () => {
    await mount(<Single onPick={() => {}} />);
    await openWithKeyboard();
    expect(menu()).not.toBeNull();
    expect(document.querySelector('[role="menu"]')).toBeNull(); // not in the light DOM
    expect(items().map((i) => i.textContent)).toEqual(["Alpha", "Beta", "Gamma"]);
    expect(items()[0]?.getAttribute("aria-checked")).toBe("true");
  });

  it("focuses the first item when opened from the keyboard", async () => {
    await mount(<Single onPick={() => {}} />);
    await openWithKeyboard();
    expect(focusedIndex()).toBe(0);
  });

  it("focuses the first item when opened with the pointer too", async () => {
    await mount(<Single onPick={() => {}} />);
    const trigger = m.shadow().querySelector("button")!;
    await act(async () => {
      trigger.dispatchEvent(
        new PointerEvent("pointerdown", { button: 0, bubbles: true, composed: true, pointerType: "mouse" }),
      );
    });
    await settle();
    expect(menu()).not.toBeNull();
    expect(focusedIndex()).toBe(0);
  });

  it("moves with arrow keys, wraps, and selects with Enter", async () => {
    const pick = vi.fn();
    await mount(<Single onPick={pick} />);
    await openWithKeyboard();
    await key(focused(), "ArrowDown");
    expect(focusedIndex()).toBe(1);
    await key(focused(), "ArrowUp");
    expect(focusedIndex()).toBe(0);
    await key(focused(), "ArrowUp"); // wraps to the last
    expect(focusedIndex()).toBe(2);
    await key(focused(), "ArrowDown"); // and back to the first
    expect(focusedIndex()).toBe(0);
    await key(focused(), "End");
    expect(focusedIndex()).toBe(2);
    await key(focused(), "Enter");
    expect(pick).toHaveBeenCalledWith("c");
  });

  it("closes on Escape", async () => {
    await mount(<Single onPick={() => {}} />);
    await openWithKeyboard();
    expect(menu()).not.toBeNull();
    await key(focused(), "Escape");
    await settle();
    expect(menu()).toBeNull();
  });

  it("multi-select stays open and toggles several items", async () => {
    const onChange = vi.fn();
    await mount(<Multi onChange={onChange} />);
    await openWithKeyboard();
    await key(focused(), "Enter"); // first item
    await key(focused(), "ArrowDown");
    await key(focused(), "Enter");
    expect(onChange).toHaveBeenLastCalledWith(["ui", "data"]);
    expect(menu()).not.toBeNull(); // still open
    expect(items()[0]?.getAttribute("aria-checked")).toBe("true");
    await key(items()[0]!, "Enter");
    expect(onChange).toHaveBeenLastCalledWith(["data"]);
  });
});

describe("Menu and the host document", () => {
  it("adds nothing to the host body while open or after closing", async () => {
    await mount(<Single onPick={() => {}} />);
    const before = Array.from(document.body.children);
    await openWithKeyboard();
    expect(menu()).not.toBeNull();
    expect(Array.from(document.body.children)).toEqual(before);
    await key(focused(), "Escape");
    await settle();
    expect(Array.from(document.body.children)).toEqual(before);
  });
});

describe("Menu behaviour", () => {
  const trigger = () => m.shadow().querySelector("button")!;
  const pointerdown = (el: Element) =>
    act(async () => {
      el.dispatchEvent(
        new PointerEvent("pointerdown", { button: 0, bubbles: true, composed: true, pointerType: "mouse" }),
      );
    });

  it("sets ARIA on the trigger and returns focus to it on Escape", async () => {
    await mount(<Single onPick={() => {}} />);
    expect(trigger().getAttribute("aria-haspopup")).toBe("menu");
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
    await openWithKeyboard();
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
    expect(trigger().getAttribute("aria-controls")).toBe(menu()!.id);
    expect(menu()!.getAttribute("aria-labelledby")).toBe(trigger().id);
    await key(focused(), "Escape");
    await settle();
    expect(m.shadow().activeElement).toBe(trigger());
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
  });

  it("closes on Tab and returns focus to the trigger", async () => {
    await mount(<Single onPick={() => {}} />);
    await openWithKeyboard();
    await key(focused(), "Tab");
    await settle();
    expect(menu()).toBeNull();
    expect(m.shadow().activeElement).toBe(trigger());
  });

  it("selecting closes a single menu and returns focus", async () => {
    const pick = vi.fn();
    await mount(<Single onPick={pick} />);
    await openWithKeyboard();
    await act(async () => (items()[1] as HTMLElement).click());
    await settle();
    expect(pick).toHaveBeenCalledWith("b");
    expect(menu()).toBeNull();
    expect(m.shadow().activeElement).toBe(trigger());
  });

  it("jumps with Home and type-ahead", async () => {
    await mount(<Single onPick={() => {}} />);
    await openWithKeyboard();
    await key(focused(), "End");
    await key(focused(), "Home");
    expect(focusedIndex()).toBe(0);
    await key(focused(), "g");
    expect(focusedIndex()).toBe(2);
    await key(focused(), "b");
    expect(focusedIndex()).toBe(1);
  });

  it("skips disabled items", async () => {
    const pick = vi.fn();
    await mount(
      <Menu
        trigger={<Chip as="button">Open</Chip>}
        items={[
          { key: "a", label: "A" },
          { key: "b", label: "B", disabled: true },
          { key: "c", label: "C" },
        ]}
        onSelect={pick}
      />,
    );
    await openWithKeyboard();
    await key(focused(), "ArrowDown");
    expect(focusedIndex()).toBe(2);
    await act(async () => (items()[1] as HTMLElement).click());
    expect(pick).not.toHaveBeenCalled();
  });

  it("dismisses on a pointerdown outside, in the shadow root and on the host page, and not before open", async () => {
    await mount(<Single onPick={() => {}} />);
    const outsideHost = document.createElement("div");
    document.body.appendChild(outsideHost);
    try {
      const add = vi.spyOn(document, "addEventListener");
      await openWithKeyboard();
      expect(add.mock.calls.some(([t]) => t === "pointerdown")).toBe(true);
      add.mockRestore();

      await pointerdown(menu()!); // inside: stays open
      expect(menu()).not.toBeNull();
      await pointerdown(outsideHost);
      await settle();
      expect(menu()).toBeNull();

      await openWithKeyboard();
      expect(menu()).not.toBeNull();
      await pointerdown(m.shadow().querySelector(".pp, div") ?? trigger()); // shadow content outside the menu
      await settle();
      expect(menu()).toBeNull();
    } finally {
      outsideHost.remove();
    }
  });

  it("removes its document listeners on close", async () => {
    await mount(<Single onPick={() => {}} />);
    await openWithKeyboard();
    const remove = vi.spyOn(document, "removeEventListener");
    await key(focused(), "Escape");
    await settle();
    expect(remove.mock.calls.some(([t]) => t === "pointerdown")).toBe(true);
    remove.mockRestore();
  });

  it("a trigger pointerdown toggles it", async () => {
    await mount(<Single onPick={() => {}} />);
    await pointerdown(trigger());
    await settle();
    expect(menu()).not.toBeNull();
    await pointerdown(trigger());
    await settle();
    expect(menu()).toBeNull();
  });
});
