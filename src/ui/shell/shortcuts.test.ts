import { afterEach, describe, expect, it, vi } from "vitest";
import { isToggleChord } from "./chord";
import { escapeStep, handleKeydown, type KeyActions, type KeyState } from "./shortcuts";

const idle: KeyState = {
  menuOpen: false,
  composerOpen: false,
  commandOpen: false,
  mode: "idle",
  sheetOpen: false,
  ticketOpen: false,
};

function actions() {
  return {
    closeMenu: vi.fn(),
    closeComposer: vi.fn(),
    closeCommand: vi.fn(),
    exitMode: vi.fn(),
    backToList: vi.fn(),
    closeSheet: vi.fn(),
    toggleCommand: vi.fn(),
    toggleTool: vi.fn(),
    toggleFreeze: vi.fn(),
    rotate: vi.fn(),
    setViewport: vi.fn(),
    toggleSheet: vi.fn(),
  } satisfies KeyActions;
}

const cleanup: Array<() => void> = [];
afterEach(() => {
  while (cleanup.length) cleanup.pop()?.();
});

/** Dispatch a real keydown on `target`, as the root's document listener would see it. */
function press(
  k: string,
  opts: { init?: KeyboardEventInit; target?: Element; state?: Partial<KeyState>; preventFirst?: boolean } = {},
) {
  const a = actions();
  const target = opts.target ?? document.body;
  const res = { used: false };
  const early = (e: Event) => e.preventDefault();
  const on = (e: Event) => {
    res.used = handleKeydown(e as KeyboardEvent, { ...idle, ...opts.state }, a);
  };
  if (opts.preventFirst) document.addEventListener("keydown", early);
  document.addEventListener("keydown", on);
  const ev = new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, composed: true, ...opts.init });
  try {
    target.dispatchEvent(ev);
  } finally {
    document.removeEventListener("keydown", early);
    document.removeEventListener("keydown", on);
  }
  return { a, used: res.used, ev };
}

function field(tag: "input" | "textarea" | "div") {
  const el = document.createElement(tag);
  if (tag === "div") el.setAttribute("contenteditable", "true");
  document.body.appendChild(el);
  cleanup.push(() => el.remove());
  return el;
}

describe("Esc order", () => {
  it("closes one thing at a time: menu, composer, command menu, mode, ticket, sheet", () => {
    const state: KeyState = {
      menuOpen: true,
      composerOpen: true,
      commandOpen: true,
      mode: "pick",
      sheetOpen: true,
      ticketOpen: true,
    };
    expect(escapeStep(state)).toBe("menu");
    expect(escapeStep({ ...state, menuOpen: false })).toBe("composer");
    expect(escapeStep({ ...state, menuOpen: false, composerOpen: false })).toBe("command");
    expect(escapeStep({ ...state, menuOpen: false, composerOpen: false, commandOpen: false })).toBe("mode");
    expect(escapeStep({ ...state, menuOpen: false, composerOpen: false, commandOpen: false, mode: "idle" })).toBe("ticket");
    expect(
      escapeStep({ ...state, menuOpen: false, composerOpen: false, commandOpen: false, mode: "idle", ticketOpen: false }),
    ).toBe("sheet");
    expect(escapeStep(idle)).toBeNull();
  });

  it("calls the matching action only, and prevents the default when it used the key", () => {
    const cases: Array<[Partial<KeyState>, keyof ReturnType<typeof actions>]> = [
      [{ menuOpen: true, composerOpen: true }, "closeMenu"],
      [{ composerOpen: true, commandOpen: true }, "closeComposer"],
      [{ commandOpen: true, mode: "box" }, "closeCommand"],
      [{ mode: "multi", sheetOpen: true, ticketOpen: true }, "exitMode"],
      [{ sheetOpen: true, ticketOpen: true }, "backToList"],
      [{ sheetOpen: true }, "closeSheet"],
    ];
    for (const [state, expected] of cases) {
      const { a, used, ev } = press("Escape", { state });
      expect(used).toBe(true);
      expect(ev.defaultPrevented).toBe(true);
      for (const [name, fn] of Object.entries(a)) expect(fn).toHaveBeenCalledTimes(name === expected ? 1 : 0);
    }
  });

  it("does nothing, and leaves the key alone, when nothing is open", () => {
    const { a, used, ev } = press("Escape");
    expect(used).toBe(false);
    expect(ev.defaultPrevented).toBe(false);
    for (const fn of Object.values(a)) expect(fn).not.toHaveBeenCalled();
  });

  it("works from inside a text field", () => {
    const { a } = press("Escape", { target: field("input"), state: { composerOpen: true } });
    expect(a.closeComposer).toHaveBeenCalledOnce();
  });
});

describe("shortcuts", () => {
  it("P M B T N toggle the pick tools", () => {
    const tools: Array<[string, string]> = [
      ["p", "pick"],
      ["m", "multi"],
      ["b", "box"],
      ["t", "text"],
      ["n", "note"],
    ];
    for (const [k, tool] of tools) {
      const { a, used } = press(k);
      expect(used).toBe(true);
      expect(a.toggleTool).toHaveBeenCalledWith(tool);
    }
    expect(press("P").a.toggleTool).toHaveBeenCalledWith("pick"); // Shift is fine
  });

  it("F freezes, R rotates, E toggles the sheet", () => {
    expect(press("f").a.toggleFreeze).toHaveBeenCalledOnce();
    expect(press("r").a.rotate).toHaveBeenCalledOnce();
    expect(press("e").a.toggleSheet).toHaveBeenCalledOnce();
  });

  it("1-4 pick Responsive, Desktop, Tablet, Mobile", () => {
    expect(press("1").a.setViewport).toHaveBeenCalledWith("responsive");
    expect(press("2").a.setViewport).toHaveBeenCalledWith("desktop");
    expect(press("3").a.setViewport).toHaveBeenCalledWith("tablet");
    expect(press("4").a.setViewport).toHaveBeenCalledWith("mobile");
    expect(press("5").used).toBe(false);
    expect(press("0").used).toBe(false);
  });

  it("⌘K / Ctrl+K toggles the command menu, even while typing", () => {
    expect(press("k", { init: { metaKey: true } }).a.toggleCommand).toHaveBeenCalledOnce();
    expect(press("K", { init: { ctrlKey: true } }).a.toggleCommand).toHaveBeenCalledOnce();
    expect(press("k", { init: { metaKey: true }, target: field("input") }).a.toggleCommand).toHaveBeenCalledOnce();
  });

  it("ignores letters typed into inputs, textareas and contenteditable", () => {
    for (const tag of ["input", "textarea", "div"] as const) {
      const { a, used } = press("p", { target: field(tag) });
      expect(used).toBe(false);
      expect(a.toggleTool).not.toHaveBeenCalled();
      expect(press("1", { target: field(tag) }).a.setViewport).not.toHaveBeenCalled();
    }
  });

  it("ignores letters with ⌘, Ctrl or Alt held (the browser's own shortcuts)", () => {
    for (const init of [{ metaKey: true }, { ctrlKey: true }, { altKey: true }]) {
      expect(press("p", { init }).used).toBe(false);
      expect(press("e", { init }).used).toBe(false);
    }
  });

  it("ignores key repeat", () => {
    expect(press("p", { init: { repeat: true } }).used).toBe(false);
  });

  it("skips events something else already handled (the dock grip's arrows, a Radix menu on Esc)", () => {
    const grip = press("p", { preventFirst: true });
    expect(grip.used).toBe(false);
    expect(grip.a.toggleTool).not.toHaveBeenCalled();
    const esc = press("Escape", { preventFirst: true, state: { sheetOpen: true } });
    expect(esc.a.closeSheet).not.toHaveBeenCalled();
    const cmdk = press("k", { preventFirst: true, init: { metaKey: true } });
    expect(cmdk.a.toggleCommand).not.toHaveBeenCalled();
  });

  it("leaves the keyboard to the command menu while it is open (but Esc and ⌘K still work)", () => {
    expect(press("p", { state: { commandOpen: true } }).used).toBe(false);
    expect(press("2", { state: { commandOpen: true } }).used).toBe(false);
    expect(press("k", { init: { metaKey: true }, state: { commandOpen: true } }).a.toggleCommand).toHaveBeenCalledOnce();
    expect(press("Escape", { state: { commandOpen: true } }).a.closeCommand).toHaveBeenCalledOnce();
  });

  it("works for keys forwarded from the viewport iframe", () => {
    // A separate document stands in for the frame's: the handler only reads the event.
    const doc = document.implementation.createHTMLDocument("frame");
    const a = actions();
    let used = false;
    doc.addEventListener("keydown", (e) => {
      used = handleKeydown(e, { ...idle, mode: "pick" }, a);
    });
    doc.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(used).toBe(true);
    expect(a.exitMode).toHaveBeenCalledOnce();
    // A letter typed into a field inside the frame is left alone as well.
    const input = doc.createElement("input");
    doc.body.appendChild(input);
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "p", bubbles: true, cancelable: true }));
    expect(a.toggleTool).not.toHaveBeenCalled();
  });
});

describe("while a menu or the composer owns the keyboard", () => {
  const item = () => {
    const el = document.createElement("div");
    el.setAttribute("role", "menuitem");
    el.tabIndex = -1;
    document.body.appendChild(el);
    cleanup.push(() => el.remove());
    return el;
  };
  const chip = () => {
    const el = document.createElement("button");
    document.body.appendChild(el);
    cleanup.push(() => el.remove());
    return el;
  };

  it("letters, digits and tools do nothing with focus on a menu item", () => {
    for (const k of ["e", "p", "m", "b", "t", "n", "f", "r", "1", "2", "3", "4"]) {
      const { a, used } = press(k, { target: item(), state: { menuOpen: true } });
      expect(used).toBe(false);
      for (const fn of Object.values(a)) expect(fn).not.toHaveBeenCalled();
    }
  });

  it("p, m, b, t, e and 2 do nothing with focus on a composer chip (the draft is not discarded)", () => {
    for (const k of ["p", "m", "b", "t", "n", "e", "2"]) {
      const { a, used } = press(k, { target: chip(), state: { composerOpen: true } });
      expect(used).toBe(false);
      for (const fn of Object.values(a)) expect(fn).not.toHaveBeenCalled();
    }
  });

  it("Esc and ⌘K still act", () => {
    expect(press("Escape", { target: item(), state: { menuOpen: true } }).a.closeMenu).toHaveBeenCalledOnce();
    expect(press("Escape", { target: chip(), state: { composerOpen: true } }).a.closeComposer).toHaveBeenCalledOnce();
    expect(
      press("k", { init: { metaKey: true }, target: chip(), state: { composerOpen: true } }).a.toggleCommand,
    ).toHaveBeenCalledOnce();
    expect(
      press("k", { init: { ctrlKey: true }, target: item(), state: { menuOpen: true } }).a.toggleCommand,
    ).toHaveBeenCalledOnce();
  });
});

describe("input method editors", () => {
  it("ignores keys typed while composing, Esc and ⌘K included", () => {
    for (const k of ["p", "e", "Escape", "1"]) {
      const { a, used } = press(k, { init: { isComposing: true }, state: { sheetOpen: true } });
      expect(used).toBe(false);
      for (const fn of Object.values(a)) expect(fn).not.toHaveBeenCalled();
    }
    expect(press("k", { init: { metaKey: true, isComposing: true } }).used).toBe(false);
  });

  it("ignores keyCode 229 (what some browsers report for IME keys)", () => {
    const a = actions();
    const ev = new KeyboardEvent("keydown", { key: "p", bubbles: true, cancelable: true });
    Object.defineProperty(ev, "keyCode", { value: 229 });
    expect(handleKeydown(ev, idle, a)).toBe(false);
    expect(a.toggleTool).not.toHaveBeenCalled();
  });
});

describe("isToggleChord", () => {
  const chord = (init: KeyboardEventInit) => isToggleChord(new KeyboardEvent("keydown", init));
  it("is ⌘⇧. / Ctrl+Shift+., however the layout reports the key", () => {
    expect(chord({ key: ">", code: "Period", metaKey: true, shiftKey: true })).toBe(true);
    expect(chord({ key: ".", code: "Period", ctrlKey: true, shiftKey: true })).toBe(true);
    expect(chord({ key: ">", metaKey: true, shiftKey: true })).toBe(true);
  });
  it("needs both modifiers", () => {
    expect(chord({ key: ".", code: "Period", metaKey: true })).toBe(false);
    expect(chord({ key: ">", code: "Period", shiftKey: true })).toBe(false);
    expect(chord({ key: ">", code: "Period", metaKey: true, shiftKey: true, altKey: true })).toBe(false);
  });
});
