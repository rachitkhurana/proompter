import { act, StrictMode, useState, type ReactNode } from "react";
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

interface Snap {
  head: string[];
  html: string;
  body: string;
  kids: Element[];
}
const attrsOf = (el: HTMLElement) =>
  JSON.stringify([Array.from(el.attributes).map((a) => [a.name, a.value]), el.style.cssText]);
const snap = (): Snap => ({
  head: Array.from(document.head.children).map((c) => c.outerHTML),
  html: attrsOf(document.documentElement),
  body: attrsOf(document.body),
  kids: Array.from(document.body.children),
});
function expectSame(a: Snap, b: Snap) {
  expect(a.head).toEqual(b.head);
  expect(a.html).toBe(b.html);
  expect(a.body).toBe(b.body);
  expect(a.kids).toHaveLength(b.kids.length);
  a.kids.forEach((k, i) => expect(k === b.kids[i]).toBe(true));
}

interface Rec {
  target: string;
  type: string;
  fn: unknown;
  cap: boolean;
}
const capOf = (o: unknown) => (typeof o === "boolean" ? o : !!(o as { capture?: boolean } | undefined)?.capture);

/** Records every add/removeEventListener on `document` and `window` (and any extra targets), passing through. */
function spyListeners(extra: Array<[string, EventTarget]> = []) {
  const adds: Rec[] = [];
  const removes: Rec[] = [];
  const spies: Array<{ mockRestore: () => void }> = [];
  const targets: Array<[string, EventTarget]> = [["document", document], ["window", window], ...extra];
  for (const [name, t] of targets) {
    const add = t.addEventListener.bind(t);
    const remove = t.removeEventListener.bind(t);
    spies.push(
      vi.spyOn(t, "addEventListener").mockImplementation(((type: string, fn: unknown, o?: unknown) => {
        adds.push({ target: name, type, fn, cap: capOf(o) });
        return add(type, fn as EventListener, o as boolean);
      }) as never),
      vi.spyOn(t, "removeEventListener").mockImplementation(((type: string, fn: unknown, o?: unknown) => {
        removes.push({ target: name, type, fn, cap: capOf(o) });
        return remove(type, fn as EventListener, o as boolean);
      }) as never),
    );
  }
  const ours = (r: Rec) => r.type !== "selectionchange"; // React adds this one to the document once, never removes it
  return {
    adds: () => adds.filter(ours),
    removes: () => removes.filter(ours),
    /** Added with no matching remove (same target, type, handler and capture flag). */
    leaked: () => {
      const pool = removes.filter(ours).slice();
      return adds.filter(ours).filter((a) => {
        const i = pool.findIndex((r) => r.target === a.target && r.type === a.type && r.fn === a.fn && r.cap === a.cap);
        if (i < 0) return true;
        pool.splice(i, 1);
        return false;
      });
    },
    restore: () => spies.forEach((s) => s.mockRestore()),
  };
}

describe("Menu and the host document", () => {
  /** Mount, run, then check the host page and its listeners are as they were. */
  async function scenario(ui: ReactNode, run: () => Promise<"unmounted" | void>) {
    const before = snap();
    m = await mountInShadow(ui, { css: "" });
    const mounted = snap();
    const spies = spyListeners();
    let result: "unmounted" | void;
    try {
      result = await run();
      expectSame(snap(), result === "unmounted" ? before : mounted);
      expect(spies.leaked()).toEqual([]);
    } finally {
      spies.restore();
    }
    if (result === "unmounted") m = await mountInShadow(<span />, { css: "" }); // for afterEach
  }
  const openClose = async () => {
    await openWithKeyboard();
    expect(menu()).not.toBeNull();
    await key(focused(), "Escape");
    await settle();
    expect(menu()).toBeNull();
  };

  it("open then close leaves the page and its listeners untouched", async () => {
    await scenario(<Single onPick={() => {}} />, openClose);
  });

  it("open then unmount leaves the page and its listeners untouched", async () => {
    await scenario(<Single onPick={() => {}} />, async () => {
      await openWithKeyboard();
      expect(menu()).not.toBeNull();
      await m.unmount();
      return "unmounted";
    });
  });

  it("unmounting mid-exit leaves the page and its listeners untouched", async () => {
    const cs = vi.spyOn(window, "getComputedStyle").mockImplementation((() => ({ animationName: "menu-out" })) as never);
    try {
      await scenario(<Single onPick={() => {}} />, async () => {
        await openWithKeyboard();
        await key(focused(), "Escape");
        await settle();
        expect(menu()?.getAttribute("data-state")).toBe("closed"); // still exiting
        await m.unmount();
        return "unmounted";
      });
    } finally {
      cs.mockRestore();
    }
  });

  it("is clean under StrictMode too", async () => {
    await scenario(
      <StrictMode>
        <Single onPick={() => {}} />
      </StrictMode>,
      openClose,
    );
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

  it("closes on Tab without preventing it: focus goes to the trigger and the default Tab moves on from there", async () => {
    await mount(<Single onPick={() => {}} />);
    await openWithKeyboard();
    const ev = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true, composed: true });
    await act(async () => void focused().dispatchEvent(ev));
    await settle();
    expect(ev.defaultPrevented).toBe(false); // the browser's Tab still runs (APG: no focus trap)
    expect(menu()).toBeNull();
    expect(m.shadow().activeElement).toBe(trigger()); // so the default Tab goes to the element after the trigger
    expect(items()).toHaveLength(0);
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

  it("adds pointerdown, resize and scroll listeners only while open, and removes the same handlers with the same capture flag", async () => {
    await mount(<Single onPick={() => {}} />);
    const spies = spyListeners([["shadow", m.shadow()]]);
    try {
      expect(spies.adds()).toHaveLength(0); // nothing before it opens
      await openWithKeyboard();
      const want: Array<[string, string, boolean]> = [
        ["document", "pointerdown", true],
        ["window", "resize", false],
        ["window", "scroll", true],
        ["shadow", "scroll", true], // scrolls inside the shadow root do not reach the window
      ];
      for (const [target, type, cap] of want) {
        expect(spies.adds().some((a) => a.target === target && a.type === type && a.cap === cap)).toBe(true);
      }
      await key(focused(), "Escape");
      await settle();
      for (const a of spies.adds()) {
        expect(
          spies.removes().some((r) => r.target === a.target && r.type === a.type && r.fn === a.fn && r.cap === a.cap),
        ).toBe(true);
      }
      expect(spies.leaked()).toEqual([]);
    } finally {
      spies.restore();
    }
  });

  it("observes the menu's size while open and disconnects on close", async () => {
    const seen = { observe: 0, disconnect: 0 };
    const Original = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class {
      observe() {
        seen.observe++;
      }
      unobserve() {}
      disconnect() {
        seen.disconnect++;
      }
    } as unknown as typeof ResizeObserver;
    try {
      await mount(<Single onPick={() => {}} />);
      await openWithKeyboard();
      expect(seen.observe).toBeGreaterThan(0);
      await key(focused(), "Escape");
      await settle();
      expect(seen.disconnect).toBeGreaterThan(0);
    } finally {
      globalThis.ResizeObserver = Original;
    }
  });

  // React's act() thenable doesn't chain `.then` return values, so await it and return the event.
  const rawKey = async (el: Element, k: string, init: KeyboardEventInit = {}) => {
    const ev = new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, composed: true, ...init });
    await act(async () => void el.dispatchEvent(ev));
    return ev;
  };

  it("Escape is handled: defaultPrevented and not propagated to the page", async () => {
    await mount(<Single onPick={() => {}} />);
    await openWithKeyboard();
    const seen = vi.fn();
    document.addEventListener("keydown", seen);
    try {
      const ev = await rawKey(focused(), "Escape");
      expect(ev.defaultPrevented).toBe(true);
      expect(seen).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener("keydown", seen);
    }
  });

  it("ignores a held Enter on an item, and a held key on the trigger", async () => {
    const pick = vi.fn();
    await mount(<Single onPick={pick} />);
    await openWithKeyboard();
    await rawKey(focused(), "Enter", { repeat: true });
    expect(pick).not.toHaveBeenCalled();
    expect(menu()).not.toBeNull();
    await rawKey(focused(), "Escape");
    await settle();
    await rawKey(trigger(), "Enter", { repeat: true });
    await settle();
    expect(menu()).toBeNull();
  });

  it("Space joins a type-ahead run (and does not select) until the buffer times out", async () => {
    const pick = vi.fn();
    await mount(<Single onPick={pick} />);
    await openWithKeyboard();
    await key(focused(), "b");
    const ev = await rawKey(focused(), " ");
    expect(ev.defaultPrevented).toBe(true);
    expect(pick).not.toHaveBeenCalled();
    await act(async () => void (await new Promise((r) => setTimeout(r, 600)))); // buffer reset
    await rawKey(focused(), " ");
    expect(pick).toHaveBeenCalledWith("b");
  });

  it("repeating a letter cycles through the items that start with it", async () => {
    await mount(
      <Menu
        trigger={<Chip as="button">Open</Chip>}
        selection="single"
        items={["Beta", "Bravo", "Blue", "Cat"].map((l) => ({ key: l, label: l }))}
        onSelect={() => {}}
      />,
    );
    await openWithKeyboard();
    expect(focusedIndex()).toBe(0);
    await key(focused(), "b");
    expect(focusedIndex()).toBe(1);
    await key(focused(), "b");
    expect(focusedIndex()).toBe(2);
    await key(focused(), "b");
    expect(focusedIndex()).toBe(0); // wraps, skipping "Cat"
  });

  it("gives the header role=presentation", async () => {
    await mount(
      <Menu
        trigger={<Chip as="button">Open</Chip>}
        header="Tags"
        selection="single"
        items={[{ key: "a", label: "A" }]}
        onSelect={() => {}}
      />,
    );
    await openWithKeyboard();
    expect(menu()!.querySelector(".mh")?.getAttribute("role")).toBe("presentation");
  });

  it("gives each menu its own ids when two open in sequence", async () => {
    await mount(
      <>
        <Menu trigger={<Chip as="button">One</Chip>} selection="single" items={[{ key: "a", label: "A" }]} onSelect={() => {}} />
        <Menu trigger={<Chip as="button">Two</Chip>} selection="single" items={[{ key: "b", label: "B" }]} onSelect={() => {}} />
      </>,
    );
    const [one, two] = Array.from(m.shadow().querySelectorAll("button")) as HTMLButtonElement[];
    one!.focus();
    await key(one!, "ArrowDown");
    await settle();
    const firstId = menu()!.id;
    await key(focused(), "Escape");
    await settle();
    two!.focus();
    await key(two!, "ArrowDown");
    await settle();
    expect(menu()!.id).not.toBe(firstId);
    expect(one!.id).not.toBe(two!.id);
    expect(two!.getAttribute("aria-controls")).toBe(menu()!.id);
  });

  describe("exit animation", () => {
    const animating = () =>
      vi.spyOn(window, "getComputedStyle").mockImplementation((() => ({ animationName: "menu-out" })) as never);

    it("stays mounted while closing and unmounts on animationend", async () => {
      const cs = animating();
      try {
        await mount(<Single onPick={() => {}} />);
        await openWithKeyboard();
        await key(focused(), "Escape");
        await settle();
        expect(menu()?.getAttribute("data-state")).toBe("closed");
        await act(async () => void menu()!.dispatchEvent(new Event("animationend")));
        expect(menu()).toBeNull();
      } finally {
        cs.mockRestore();
      }
    });

    it("unmounts after the fallback timeout when animationend never fires", async () => {
      const cs = animating();
      try {
        await mount(<Single onPick={() => {}} />);
        await openWithKeyboard();
        await key(focused(), "Escape");
        await settle();
        expect(menu()).not.toBeNull();
        await act(async () => void (await new Promise((r) => setTimeout(r, 300))));
        expect(menu()).toBeNull();
      } finally {
        cs.mockRestore();
      }
    });
  });

  describe("placement", () => {
    const size = (rect: { left: number; top: number; width?: number; height?: number }, vw: number, vh: number) => {
      const width = rect.width ?? 60;
      const height = rect.height ?? 24;
      const r = {
        ...rect,
        width,
        height,
        right: rect.left + width,
        bottom: rect.top + height,
        x: rect.left,
        y: rect.top,
        toJSON: () => ({}),
      };
      const html = document.documentElement;
      Object.defineProperty(html, "clientWidth", { configurable: true, value: vw });
      Object.defineProperty(html, "clientHeight", { configurable: true, value: vh });
      const spies = [
        vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(200),
        vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(100),
        vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue(r as DOMRect),
      ];
      return () => {
        spies.forEach((s) => s.mockRestore());
        delete (html as { clientWidth?: number }).clientWidth;
        delete (html as { clientHeight?: number }).clientHeight;
      };
    };
    const style = () => menu() as HTMLElement;

    it("opens below the trigger when it fits", async () => {
      const undo = size({ left: 100, top: 100 }, 1000, 600);
      try {
        await mount(<Single onPick={() => {}} />);
        await openWithKeyboard();
        expect(style().style.left).toBe("100px");
        expect(style().style.top).toBe("130px"); // bottom 124 + 6
        expect(style().style.getPropertyValue("--menu-origin")).toBe("12px 0");
      } finally {
        undo();
      }
    });

    it("flips above when below overflows and above fits, growing upward", async () => {
      const undo = size({ left: 100, top: 550 }, 1000, 600);
      try {
        await mount(<Single onPick={() => {}} />);
        await openWithKeyboard();
        expect(style().style.top).toBe("444px"); // 550 - 6 - 100
        expect(style().style.getPropertyValue("--menu-origin")).toBe("12px 100%");
      } finally {
        undo();
      }
    });

    it("clamps to the viewport edge and keeps the origin on the trigger", async () => {
      const undo = size({ left: 950, top: 100 }, 1000, 600);
      try {
        await mount(<Single onPick={() => {}} />);
        await openWithKeyboard();
        expect(style().style.left).toBe("792px"); // 1000 - 200 - 8
        expect(style().style.getPropertyValue("--menu-origin")).toBe("170px 0"); // 950 + 12 - 792
      } finally {
        undo();
      }
    });

    it("when neither side fits, takes the roomier side and caps the height", async () => {
      const undo = size({ left: 100, top: 60 }, 1000, 150);
      try {
        await mount(<Single onPick={() => {}} />);
        await openWithKeyboard();
        expect(style().style.top).toBe("90px"); // below: 84 + 6
        expect(style().style.maxHeight).toBe("52px"); // 150 - 84 - 6 - 8
        expect(style().style.overflowY).toBe("auto");
      } finally {
        undo();
      }
    });
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
