import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mountInShadow, type Mounted } from "../test-utils";
import { toast, Toaster } from "./toast";

let m: Mounted;
const all = () => Array.from(m.shadow().querySelectorAll(".toast"));
const shown = () => all().map((t) => t.textContent);
const staying = () => all().filter((t) => !t.classList.contains("out")).map((t) => t.textContent);
const advance = (ms: number) => act(async () => void vi.advanceTimersByTime(ms));

beforeEach(async () => {
  vi.useFakeTimers();
  toast.clear();
  m = await mountInShadow(<Toaster />);
});
afterEach(async () => {
  toast.clear();
  await m.unmount();
  vi.useRealTimers();
});

describe("Toast", () => {
  it("shows a toast", async () => {
    await act(async () => void toast("Copied"));
    expect(shown()).toEqual(["Copied"]);
  });

  it("keeps at most 3; the oldest leaves with the exit animation", async () => {
    await act(async () => {
      for (let i = 1; i <= 4; i++) toast(`T${i}`);
    });
    expect(staying()).toEqual(["T2", "T3", "T4"]);
    expect(m.shadow().querySelectorAll(".toast.out")).toHaveLength(1); // T1, animating out
    await advance(250);
    expect(shown()).toEqual(["T2", "T3", "T4"]);
  });

  it("auto-dismisses after 2.8s plus the exit animation", async () => {
    await act(async () => void toast("Bye"));
    await advance(2799);
    expect(shown()).toEqual(["Bye"]);
    await advance(2);
    expect(m.shadow().querySelector(".toast.out")).not.toBeNull();
    await advance(250);
    expect(shown()).toEqual([]);
  });

  it("hovering any toast pauses every timer, and they resume with the time left", async () => {
    await act(async () => {
      toast("one");
      toast("two");
    });
    await advance(2000);
    const first = all()[0]!;
    await act(async () => {
      first.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse" }));
    });
    await advance(10_000);
    expect(staying()).toEqual(["one", "two"]); // both paused, not just the hovered one
    await act(async () => {
      first.dispatchEvent(
        new PointerEvent("pointerout", { bubbles: true, pointerType: "mouse", relatedTarget: document.body }),
      );
    });
    await advance(700); // 800ms were left
    expect(staying()).toEqual(["one", "two"]);
    await advance(150);
    expect(staying()).toEqual([]);
  });

  it("does not stay paused when the hovered toast is removed under the cursor", async () => {
    await act(async () => {
      toast("one", { id: "a" });
      toast("two", { id: "b" });
    });
    await act(async () => {
      all()[0]!.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse" }));
    });
    await act(async () => void toast.dismiss("a")); // no pointerout will ever fire
    await advance(400);
    await advance(3000); // "two" resumes and runs out
    expect(staying()).toEqual([]);
  });

  it("resets the pause when the list empties", async () => {
    await act(async () => void toast("one"));
    await act(async () => {
      all()[0]!.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse" }));
    });
    await act(async () => void toast.dismiss());
    await advance(300);
    expect(shown()).toEqual([]);
    await act(async () => void toast("fresh"));
    await advance(2900);
    expect(staying()).toEqual([]); // not stuck paused: it timed out
  });

  it("reusing an id starts a fresh toast: full duration, and the old exit never removes it", async () => {
    await act(async () => void toast("old", { id: "x" }));
    await act(async () => void toast.dismiss("x")); // old starts leaving; its removal timer is pending
    await act(async () => void toast("new", { id: "x" }));
    await advance(250);
    expect(shown()).toEqual(["new"]); // survived the old toast's removal timer
    await advance(2000);
    await act(async () => void toast("newer", { id: "x" }));
    await advance(2000); // the replacement must not inherit the 2.25s already spent
    expect(staying()).toEqual(["newer"]);
  });

  it("replaces a toast that reuses an id", async () => {
    await act(async () => {
      toast("one", { id: "x" });
      toast("two", { id: "x" });
    });
    expect(shown()).toEqual(["two"]);
  });
});
