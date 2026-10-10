import { afterEach, describe, expect, it } from "vitest";
import { returnFocusFromFrame } from "./focus";
import { handleKeydown, type KeyActions, type KeyState } from "./shortcuts";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("returnFocusFromFrame", () => {
  it("blurs a focused device frame", () => {
    const frame = document.createElement("iframe");
    document.body.append(frame);
    frame.focus();
    expect(document.activeElement).toBe(frame);
    returnFocusFromFrame();
    expect(document.activeElement).not.toBe(frame);
  });

  it("leaves focus alone when it is anywhere else", () => {
    const btn = document.createElement("button");
    document.body.append(btn);
    btn.focus();
    returnFocusFromFrame();
    expect(document.activeElement).toBe(btn);
  });
});

// Keys the engine forwards from a device frame go through the same handler as keys on the host page.
describe("global shortcuts on a forwarded key", () => {
  const state: KeyState = { menuOpen: false, composerOpen: false, commandOpen: false, mode: "idle", sheetOpen: false, ticketOpen: false };
  const recorder = () => {
    const calls: string[] = [];
    const actions = new Proxy({} as KeyActions, {
      get:
        (_t, name: string) =>
        (...args: unknown[]) =>
          void calls.push(args.length ? `${name}:${String(args[0])}` : name),
    });
    return { actions, calls };
  };
  const press = (target: Element, init: KeyboardEventInit) => {
    const ev = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, composed: true, ...init });
    target.dispatchEvent(ev);
    return ev;
  };

  it("handles every shortcut", () => {
    const target = document.createElement("div");
    document.body.append(target);
    const cases: Array<[KeyboardEventInit, string]> = [
      [{ key: "1" }, "setViewport:responsive"],
      [{ key: "3" }, "setViewport:tablet"],
      [{ key: "p" }, "toggleTool:pick"],
      [{ key: "n" }, "toggleTool:note"],
      [{ key: "f" }, "toggleFreeze"],
      [{ key: "r" }, "rotate"],
      [{ key: "e" }, "toggleSheet"],
      [{ key: "K", metaKey: true, shiftKey: true }, "toggleCommand"],
    ];
    for (const [init, expected] of cases) {
      const { actions, calls } = recorder();
      expect(handleKeydown(press(target, init), state, actions), String(init.key)).toBe(true);
      expect(calls).toEqual([expected]);
    }
  });

  it("stays out of the way of typing and IME", () => {
    const input = document.createElement("input");
    document.body.append(input);
    const { actions, calls } = recorder();
    expect(handleKeydown(press(input, { key: "p" }), state, actions)).toBe(false);
    expect(handleKeydown(press(document.body, { key: "1", isComposing: true }), state, actions)).toBe(false);
    expect(calls).toEqual([]);
  });
});
