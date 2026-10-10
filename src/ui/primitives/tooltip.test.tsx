import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mountInShadow, type Mounted } from "../test-utils";
import { Tooltip, TooltipProvider } from "./tooltip";

let m: Mounted;

function enter(el: Element) {
  el.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse" }));
}
function leave(el: Element) {
  el.dispatchEvent(new PointerEvent("pointerout", { bubbles: true, pointerType: "mouse" }));
}
/** A pointer event with `relatedTarget` guaranteed, even if the DOM implementation drops it from the init. */
function pointer(type: "pointerover" | "pointerout", target: Element, related: Element | null) {
  const ev = new PointerEvent(type, { bubbles: true, pointerType: "mouse", relatedTarget: related });
  if (ev.relatedTarget !== related) Object.defineProperty(ev, "relatedTarget", { value: related });
  expect(ev.relatedTarget).toBe(related); // makes a dropped relatedTarget visible instead of silent
  target.dispatchEvent(ev);
}
/** What a browser sends when the pointer moves from one element to another. */
function move(from: Element, to: Element) {
  pointer("pointerout", from, to);
  pointer("pointerover", to, from);
}
const tips = () => Array.from(m.shadow().querySelectorAll('[role="tooltip"]'));
/** The newest tooltip (a cold one may still be fading out behind it). */
const tip = () => tips().at(-1) ?? null;
const advance = (ms: number) => act(async () => void vi.advanceTimersByTime(ms));

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(async () => {
  await m.unmount();
  vi.useRealTimers();
});

async function setup() {
  m = await mountInShadow(
    <TooltipProvider>
      <Tooltip content="First">
        <button id="a">a</button>
      </Tooltip>
      <Tooltip content="Second">
        <button id="b">b</button>
      </Tooltip>
      <span id="gap">gap</span>
    </TooltipProvider>,
    { css: "" },
  );
  return {
    a: m.shadow().querySelector<HTMLElement>("#a")!,
    b: m.shadow().querySelector<HTMLElement>("#b")!,
    gap: m.shadow().querySelector("#gap")!,
  };
}

describe("Tooltip", () => {
  it("waits 350ms before the first tooltip", async () => {
    const { a } = await setup();
    await act(async () => enter(a));
    await advance(349);
    expect(tip()).toBeNull();
    await advance(2);
    expect(tip()?.textContent).toBe("First");
    expect(a.getAttribute("aria-describedby")).toBe(tip()?.id);
  });

  it("does not open on touch", async () => {
    const { a } = await setup();
    await act(async () =>
      a.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, pointerType: "touch" })),
    );
    await advance(1000);
    expect(tip()).toBeNull();
  });

  it("shows neighbours instantly while warm, and hides the old one instantly", async () => {
    const { a, b } = await setup();
    await act(async () => enter(a));
    await advance(350 + 70); // shown, then warm (the prototype's 420ms)
    expect(tip()?.textContent).toBe("First");
    await act(async () => leave(a));
    expect(tips()).toHaveLength(0); // warm hide is instant
    await act(async () => enter(b));
    expect(tip()?.textContent).toBe("Second"); // no timers advanced
    expect(tip()?.hasAttribute("data-instant")).toBe(true);
  });

  it("goes cold again 250ms after the last tooltip closed", async () => {
    const { a, b } = await setup();
    await act(async () => enter(a));
    await advance(420);
    await act(async () => leave(a));
    await advance(251);
    await act(async () => enter(b));
    expect(tip()).toBeNull();
    await advance(350);
    expect(tip()?.textContent).toBe("Second");
    expect(tip()?.hasAttribute("data-instant")).toBe(false);
  });

  it("stays warm for as long as the pointer is inside the group, however long a tooltip was closed", async () => {
    const { a, b, gap } = await setup();
    await act(async () => enter(a));
    await advance(420);
    expect(tips().map((t) => t.textContent)).toEqual(["First"]);
    // Full browser sequence: out of a, over a non-trigger spot inside the group. The group is not left.
    await act(async () => move(a, gap));
    expect(tips()).toHaveLength(0); // a closed (warm hide is instant)
    await advance(5000); // far longer than the 250ms cool-down
    await act(async () => move(gap, b));
    expect(tips().map((t) => t.textContent)).toEqual(["Second"]);
    expect(tips()[0]?.hasAttribute("data-instant")).toBe(true);
  });

  it("keyboard focus never warms the group", async () => {
    const { a, b } = await setup();
    await act(async () => a.focus());
    await advance(2000);
    await act(async () => a.blur());
    await act(async () => enter(b));
    expect(tips().map((t) => t.textContent)).not.toContain("Second"); // cold: still waits the 350ms
    await advance(350);
    expect(tip()?.textContent).toBe("Second");
  });

  it("a cold hide lingers for the prototype's 350ms delay plus the 120ms fade", async () => {
    const { a } = await setup();
    await act(async () => enter(a));
    await advance(350 + 10); // shown, but not yet warm
    await act(async () => leave(a));
    expect(tip()?.getAttribute("data-state")).toBe("closing");
    await advance(469);
    expect(tip()).not.toBeNull();
    await advance(2);
    expect(tip()).toBeNull();
  });

  it("closes on Escape", async () => {
    const { a } = await setup();
    await act(async () => enter(a));
    await advance(350);
    expect(tip()).not.toBeNull();
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    await advance(500);
    expect(tip()).toBeNull();
  });
});

// Regression: the UI is a portal into a shadow root inside the host app's React tree, so the pointer
// usually arrives from another element React manages. React's onPointerEnter is skipped in that case, which
// left tooltips dead after the first visit.
describe("Tooltip re-entry from outside the group", () => {
  async function setupWithOutsiders() {
    m = await mountInShadow(
      <>
        <button id="managed">host-managed neighbour</button>
        <TooltipProvider>
          <Tooltip content="First">
            <button id="a">a</button>
          </Tooltip>
          <Tooltip content="Second">
            <button id="b">b</button>
          </Tooltip>
        </TooltipProvider>
      </>,
      { css: "" },
    );
    const plain = document.createElement("div");
    document.body.appendChild(plain);
    return {
      a: m.shadow().querySelector<HTMLElement>("#a")!,
      b: m.shadow().querySelector<HTMLElement>("#b")!,
      managed: m.shadow().querySelector<HTMLElement>("#managed")!,
      plain,
    };
  }

  it("shows after the pointer comes back from a React-managed element", async () => {
    const { a, managed } = await setupWithOutsiders();
    await act(async () => move(managed, a));
    await advance(350);
    expect(tip()?.textContent).toBe("First");
    await act(async () => move(a, managed));
    await advance(600);
    expect(tip()).toBeNull();
    await act(async () => move(managed, a));
    await advance(350);
    expect(tip()?.textContent).toBe("First");
  });

  it("shows after the pointer comes back from a plain DOM node outside the portal tree", async () => {
    const { a, plain } = await setupWithOutsiders();
    await act(async () => move(plain, a));
    await advance(350);
    expect(tip()).not.toBeNull();
    await act(async () => move(a, plain));
    await advance(600);
    expect(tip()).toBeNull();
    await act(async () => move(plain, a));
    await advance(350);
    expect(tip()?.textContent).toBe("First");
    plain.remove();
  });

  it("goes cold after leaving to a managed element for more than 250ms, and stays warm for less", async () => {
    const { a, b, managed } = await setupWithOutsiders();
    await act(async () => move(managed, a));
    await advance(350 + 100); // shown
    await advance(100); // warm (420ms after the pointer went over)
    await act(async () => move(a, managed));
    await advance(100);
    await act(async () => move(managed, b));
    expect(tip()?.textContent).toBe("Second"); // instant: still warm
    await act(async () => move(b, managed));
    await advance(300);
    await act(async () => move(managed, a));
    expect(tip()).toBeNull(); // cold again: waits the full delay
    await advance(350);
    expect(tip()?.textContent).toBe("First");
  });
});
