import { act, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PickEngine, type PickCommit } from "../../core/pick";
import { boxAll, html, setRect } from "../../core/test-dom";
import { createPageSurface, type PickSurface, type ViewportId } from "../../core/surface";
import { mountInShadow, type Mounted } from "../test-utils";
import { Overlay } from "./overlay";
import { anchorFor, layoutPins, PIN_STACK_STEP, type PinModel } from "./pin-layout";
import { placeSubbar } from "./multi-bar";
import { Pins, type PulseRequest } from "./pins";

const PAGE = `
  <main data-src="app/feed.tsx:10:5">
    <article data-src="app/post-card.tsx:20:5" id="card">
      <div data-src="app/avatar.tsx:5:5" data-comp="Avatar" id="avatar-box">
        <img data-src="app/avatar.tsx:6:7" class="avatar" alt="" src="x.png" id="avatar">
      </div>
      <p id="body">Clutched a 1v4 against the whole lobby</p>
      <button data-src="app/post-card.tsx:28:7" id="share">Share</button>
    </article>
  </main>`;

const $ = (sel: string) => document.querySelector(sel) as HTMLElement;

let m: Mounted | null = null;
let engine: PickEngine | null = null;

afterEach(async () => {
  await m?.unmount();
  m = null;
  engine?.dispose();
  engine = null;
  document.body.innerHTML = "";
});

function page() {
  boxAll(html(PAGE));
  setRect($("#card"), 20, 100, 300, 200); // right 320, top 100
  setRect($("#avatar"), 30, 110, 40, 40);
  setRect($("#share"), 30, 250, 80, 30);
  return createPageSurface(window);
}

const pin = (over: Partial<PinModel> & Pick<PinModel, "id">): PinModel => ({
  title: "Avatar is cropped",
  priority: "important",
  status: "open",
  viewport: "responsive",
  selector: '[data-src="app/post-card.tsx:20:5"]',
  ...over,
});

describe("pin layout", () => {
  it("sits 4px inside the element's top-right corner", () => {
    const s = page();
    expect(anchorFor(pin({ id: 1 }), s, "responsive")).toEqual({ x: 316, y: 104 });
  });

  it("maps through the surface's scale and origin", () => {
    const s = page();
    const scaled: PickSurface = {
      ...s,
      toScreen: (r) => ({ left: 100 + r.left * 0.5, top: 50 + r.top * 0.5, width: r.width * 0.5, height: r.height * 0.5 }),
      bounds: () => ({ left: 100, top: 50, width: 400, height: 500 }),
    };
    // card: left 20, top 100, 300x200 -> screen left 110, top 100, right 260 -> pin at (256, 104)
    expect(anchorFor(pin({ id: 1 }), scaled, "responsive")).toEqual({ x: 256, y: 104 });
  });

  it("only shows on the viewport the entry was filed on", () => {
    const s = page();
    const p = pin({ id: 1, viewport: "mobile" });
    expect(anchorFor(p, s, "responsive")).toBeNull();
    expect(anchorFor(p, s, "desktop")).toBeNull();
    expect(anchorFor(p, s, "mobile")).not.toBeNull();
  });

  it("only shows on the route the entry was filed on (no route: everywhere)", () => {
    const s = page();
    const p = pin({ id: 1, route: "/feeds" });
    expect(anchorFor(p, s, "responsive", "/feeds")).not.toBeNull();
    expect(anchorFor(p, s, "responsive", "/tournaments")).toBeNull();
    expect(anchorFor(p, s, "responsive")).not.toBeNull(); // caller doesn't track routes
    expect(anchorFor(pin({ id: 2 }), s, "responsive", "/tournaments")).not.toBeNull();
    expect(layoutPins([p, pin({ id: 3, route: "/other" })], s, "responsive", "/feeds").map((x) => x.pin.id)).toEqual([1]);
  });

  it("hides pins whose element is gone, empty, or scrolled out of the surface", () => {
    const s = page();
    expect(anchorFor(pin({ id: 1, selector: '[data-src="nope"]' }), s, "responsive")).toBeNull();
    setRect($("#card"), 20, 100, 0, 0);
    expect(anchorFor(pin({ id: 1 }), s, "responsive")).toBeNull();
    setRect($("#card"), 20, -500, 300, 200); // above the viewport
    expect(anchorFor(pin({ id: 1 }), s, "responsive")).toBeNull();
    setRect($("#card"), 20, window.innerHeight + 50, 300, 200); // below it
    expect(anchorFor(pin({ id: 1 }), s, "responsive")).toBeNull();
  });

  it("page notes sit in the surface's top-right corner", () => {
    const s = page();
    const b = s.bounds();
    expect(anchorFor(pin({ id: 9, selector: null }), s, "responsive")).toEqual({ x: b.left + b.width - 16, y: 16 });
  });

  it("offsets pins that land on the same spot by 28px each, leftwards", () => {
    const s = page();
    const placed = layoutPins(
      [pin({ id: 1 }), pin({ id: 2 }), pin({ id: 3 }), pin({ id: 4, selector: '[data-src="app/post-card.tsx:28:7"]' })],
      s,
      "responsive",
    );
    expect(placed.map((p) => [p.pin.id, p.x, p.y])).toEqual([
      [1, 316, 104],
      [2, 316 - PIN_STACK_STEP, 104],
      [3, 316 - 2 * PIN_STACK_STEP, 104],
      [4, 106, 254],
    ]);
    expect(PIN_STACK_STEP).toBe(28);
  });
});

describe("placeSubbar", () => {
  const screen = { width: 1280, height: 720 };
  const bar = { width: 220, height: 42 };
  it("sits 10px above a dock in the lower half, centred", () => {
    const dock = { left: 500, top: 640, width: 280, height: 46 };
    expect(placeSubbar(dock, bar, screen)).toEqual({ left: 530, top: 640 - 42 - 10 });
  });
  it("sits below a dock in the upper half", () => {
    const dock = { left: 500, top: 20, width: 280, height: 46 };
    expect(placeSubbar(dock, bar, screen)).toEqual({ left: 530, top: 20 + 46 + 10 });
  });
  it("sits beside an edge-docked bar", () => {
    expect(placeSubbar({ left: 12, top: 200, width: 46, height: 300 }, bar, screen, "l")).toEqual({ left: 68, top: 200 });
    expect(placeSubbar({ left: 1222, top: 200, width: 46, height: 300 }, bar, screen, "r")).toEqual({
      left: 1222 - 220 - 10,
      top: 200,
    });
  });
  it("stays 8px inside the screen", () => {
    expect(placeSubbar({ left: -100, top: 640, width: 100, height: 46 }, bar, screen).left).toBe(8);
  });
});

describe("<Pins>", () => {
  const pins: PinModel[] = [pin({ id: 1 }), pin({ id: 2, priority: "blocking", status: "resolved" })];
  const q = () => Array.from(m!.shadow().querySelectorAll<HTMLElement>(".pm-pin"));

  function Harness({ surface, pulse, onOpen }: { surface: PickSurface; pulse?: PulseRequest | null; onOpen?: (id: PinModel["id"]) => void }) {
    const [vp, setVp] = useState<ViewportId>("responsive");
    (globalThis as { __setVp?: (v: ViewportId) => void }).__setVp = setVp;
    return <Pins pins={pins} surface={surface} viewport={vp} pulse={pulse} onOpen={onOpen} />;
  }
  const setVp = (v: ViewportId) => act(async () => (globalThis as unknown as { __setVp: (v: ViewportId) => void }).__setVp(v));

  it("renders numbered pins coloured by priority, grey when resolved, with a hover card", async () => {
    const s = page();
    m = await mountInShadow(<Harness surface={s} />, { css: "" });
    const [a, b] = q();
    expect(a!.textContent).toContain("1");
    expect(a!.classList.contains("important")).toBe(true);
    expect(b!.classList.contains("done")).toBe(true);
    expect(b!.classList.contains("blocking")).toBe(false);
    expect(a!.getAttribute("aria-label")).toBe("Pin PRO-1: Avatar is cropped");
    expect(a!.querySelector(".pm-pin-card b")!.textContent).toBe("Avatar is cropped");
    expect(a!.querySelector(".pm-pin-card")!.textContent).toContain("Important");
    expect(a!.querySelector(".pm-pin-card")!.textContent).toContain("PRO-1");
    expect([a!.style.left, a!.style.top]).toEqual(["316px", "104px"]);
    expect(b!.style.left).toBe(`${316 - PIN_STACK_STEP}px`);
  });

  it("pops in once: not again after the viewport changes and comes back", async () => {
    const s = page();
    m = await mountInShadow(<Harness surface={s} />, { css: "" });
    expect(q().every((p) => p.classList.contains("fresh"))).toBe(true);
    await setVp("mobile");
    expect(q()).toHaveLength(0); // filed on Responsive: gone on Mobile
    await setVp("responsive");
    expect(q()).toHaveLength(2);
    expect(q().some((p) => p.classList.contains("fresh"))).toBe(false);
  });

  it("pulse plays a ring on that pin, and a new nonce restarts it", async () => {
    const s = page();
    const ring = () => m!.shadow().querySelector(".pm-pin-ring");
    m = await mountInShadow(<Harness surface={s} pulse={null} />, { css: "" });
    expect(ring()).toBeNull();
    await m.unmount();

    function Pulsing() {
      const [pulse, setPulse] = useState<PulseRequest | null>({ id: 1, nonce: 1 });
      (globalThis as { __pulse?: (p: PulseRequest) => void }).__pulse = setPulse;
      return <Pins pins={pins} surface={s} viewport="responsive" pulse={pulse} />;
    }
    m = await mountInShadow(<Pulsing />, { css: "" });
    const first = ring();
    expect(first).not.toBeNull();
    expect(q()[0]!.contains(first)).toBe(true);
    expect(q()[1]!.querySelector(".pm-pin-ring")).toBeNull();
    await act(async () => (globalThis as unknown as { __pulse: (p: PulseRequest) => void }).__pulse({ id: 1, nonce: 2 }));
    expect(ring()).not.toBeNull();
    expect(ring()).not.toBe(first); // a fresh element: the CSS animation starts over
  });

  it("a pulse request plays once: remounting the pin (route or viewport switch) doesn't replay it", async () => {
    const s = page();
    const ring = () => m!.shadow().querySelector(".pm-pin-ring");
    function Flow() {
      const [vp, setVp] = useState<ViewportId>("responsive");
      const [pulse, setPulse] = useState<PulseRequest | null>({ id: 1, nonce: 1 });
      (globalThis as { __flow?: { setVp: typeof setVp; setPulse: typeof setPulse } }).__flow = { setVp, setPulse };
      return <Pins pins={pins} surface={s} viewport={vp} pulse={pulse} />;
    }
    const flow = () =>
      (globalThis as unknown as { __flow: { setVp: (v: ViewportId) => void; setPulse: (p: PulseRequest) => void } }).__flow;
    m = await mountInShadow(<Flow />, { css: "" });
    expect(ring()).not.toBeNull(); // played on first show
    await act(async () => flow().setVp("mobile")); // pin leaves
    await act(async () => flow().setVp("responsive")); // and comes back
    expect(ring()).toBeNull();
    await act(async () => flow().setPulse({ id: 1, nonce: 2 })); // "Show on page" again
    expect(ring()).not.toBeNull();
  });

  it("clicking a pin opens its entry", async () => {
    const s = page();
    const onOpen = vi.fn();
    m = await mountInShadow(<Harness surface={s} onOpen={onOpen} />, { css: "" });
    await act(async () => q()[1]!.click());
    expect(onOpen).toHaveBeenCalledWith(2);
  });
});

describe("<Overlay>", () => {
  const mountOverlay = async (opts: { onCommit?: (c: PickCommit) => void } = {}) => {
    const surface = page();
    const commits: PickCommit[] = [];
    engine = new PickEngine({ onCommit: (c) => (opts.onCommit ?? commits.push.bind(commits))(c) });
    engine.attach(surface);
    m = await mountInShadow(<Overlay surface={surface} engine={engine} viewport="responsive" />, { css: "" });
    return { surface, commits };
  };
  const sh = () => m!.shadow();
  const hover = (el: Element) => act(async () => void el.dispatchEvent(new MouseEvent("mousemove", { bubbles: true })));
  const click = (el: Element) => act(async () => void el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));

  it("draws the hover box and label for the element under the cursor", async () => {
    await mountOverlay();
    await act(async () => engine!.setMode("pick"));
    await hover($("#avatar"));
    const box = sh().querySelector<HTMLElement>(".pm-hov")!;
    expect(box.classList.contains("on")).toBe(true);
    expect([box.style.left, box.style.top, box.style.width, box.style.height]).toEqual(["30px", "110px", "40px", "40px"]);
    const label = sh().querySelector<HTMLElement>(".pm-hlab")!;
    expect(label.classList.contains("on")).toBe(true);
    expect(label.textContent).toBe("img · avatar" + "avatar.tsx:6:7");
    expect(label.style.top).toBe("82px"); // 28px above the box
  });

  it("puts the label below the box near the top edge", async () => {
    await mountOverlay();
    setRect($("#avatar"), 30, 10, 40, 40);
    await act(async () => engine!.setMode("pick"));
    await hover($("#avatar"));
    expect(sh().querySelector<HTMLElement>(".pm-hlab")!.style.top).toBe("56px"); // bottom 50 + 6
  });

  it("prefixes an inherited source with ↳ and shows how far the tree was walked", async () => {
    await mountOverlay();
    await act(async () => engine!.setMode("pick"));
    await hover($("#body")); // unstamped <p>: inherits the article's source
    expect(sh().querySelector(".pm-hlab")!.textContent).toContain("↳ post-card.tsx:20:5");
    await act(async () => void engine!.walkUp());
    expect(sh().querySelector(".pm-hlab")!.textContent).toContain("↓1");
  });

  it("fades the box out where it was when the mode ends", async () => {
    await mountOverlay();
    await act(async () => engine!.setMode("pick"));
    await hover($("#avatar"));
    await act(async () => engine!.setMode("idle"));
    const box = sh().querySelector<HTMLElement>(".pm-hov")!;
    expect(box.classList.contains("on")).toBe(false);
    expect(box.style.left).toBe("30px");
  });

  it("multi mode: numbered selection boxes and the 'N selected · Add entry' bar", async () => {
    const { commits } = await mountOverlay();
    const bar = () => sh().querySelector<HTMLElement>(".pm-subbar")!;
    expect(bar().classList.contains("on")).toBe(false);
    await act(async () => engine!.setMode("multi"));
    await click($("#avatar"));
    await click($("#share"));
    expect(Array.from(sh().querySelectorAll(".pm-selb b")).map((b) => b.textContent)).toEqual(["1", "2"]);
    expect(bar().classList.contains("on")).toBe(true);
    expect(bar().textContent).toContain("2 selected");
    const [clear, add] = Array.from(bar().querySelectorAll("button"));
    expect(add!.textContent).toBe("Add entry");
    await act(async () => add!.click());
    expect(commits[0]!.kind).toBe("multi");
    await act(async () => clear!.click());
    expect(sh().querySelectorAll(".pm-selb")).toHaveLength(0);
    expect(bar().classList.contains("on")).toBe(false);
  });

  it("box mode: a catcher over the surface; dragging commits the topmost matches", async () => {
    const { commits } = await mountOverlay();
    await act(async () => engine!.setMode("box"));
    const catcher = sh().querySelector<HTMLElement>(".pm-catch")!;
    expect(catcher).not.toBeNull();
    expect([catcher.style.left, catcher.style.width]).toEqual(["0px", `${window.innerWidth}px`]);
    const ptr = (type: string, x: number, y: number) =>
      act(async () => void catcher.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y })));
    await ptr("pointerdown", 0, 90);
    await ptr("pointermove", 400, 320);
    expect(sh().querySelector(".pm-drag")).not.toBeNull();
    await ptr("pointerup", 400, 320);
    expect(sh().querySelector(".pm-drag")).toBeNull();
    const c = commits[0]!;
    expect(c.kind).toBe("box");
    // #card (20,100)-(320,300) is inside the drag and is the topmost stamped element in it.
    expect(c.kind === "box" && c.targets.map((t) => t.el.id)).toEqual(["card"]);
  });

  it("renders nothing pickable of its own: everything is in the shadow tree", async () => {
    await mountOverlay();
    expect(document.body.querySelector(".pm-hov")).toBeNull();
    expect(sh().querySelector(".pm-ovl")).not.toBeNull();
  });
});
