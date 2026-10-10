import { afterEach, describe, expect, it, vi } from "vitest";
import { boxTargets, dragRect, PickEngine, type PickCommit, type PickEngineOptions } from "./pick";
import { findBySelector, resolveTarget } from "./resolve";
import { createFrameSurface, createPageSurface, type FrameLike } from "./surface";
import { boxAll, html, setRect } from "./test-dom";

const PAGE = `
  <main data-src="app/feed.tsx:10:5" data-comp="FeedPage">
    <article data-src="app/post-card.tsx:20:5" data-comp="PostCard" id="card">
      <header data-src="app/post-card.tsx:22:7" id="header">
        <div data-src="app/avatar.tsx:5:5" data-comp="Avatar" id="avatar-box">
          <img data-src="app/avatar.tsx:6:7" class="avatar" alt="" src="x.png" id="avatar">
        </div>
        <span data-src="app/post-card.tsx:24:9" id="name">Rachit</span>
      </header>
      <p data-src="app/post-card.tsx:26:7" id="body">Clutched a 1v4 against the whole lobby</p>
      <button data-src="app/post-card.tsx:28:7" id="share">Share</button>
      <input id="field" type="text">
    </article>
  </main>
  <proompter-root></proompter-root>`;

const $ = (sel: string) => document.querySelector(sel) as HTMLElement;

let engine: PickEngine | null = null;

function setup(opts: Partial<PickEngineOptions> = {}, markup = PAGE) {
  boxAll(html(markup));
  const commits: PickCommit[] = [];
  engine = new PickEngine({ onCommit: (c) => commits.push(c), ...opts });
  const surface = createPageSurface(window);
  engine.attach(surface);
  return { engine, commits, surface };
}

afterEach(() => {
  engine?.dispose();
  engine = null;
  document.body.innerHTML = "";
  document.head.querySelectorAll("style[data-proompter-pick]").forEach((s) => s.remove());
  delete (document as { getSelection?: unknown }).getSelection;
});

const move = (el: Element) => el.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
const click = (el: Element) => {
  const e = new MouseEvent("click", { bubbles: true, cancelable: true });
  el.dispatchEvent(e);
  return e;
};
const key = (el: Element, k: string, init: KeyboardEventInit = {}) => {
  const e = new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init });
  el.dispatchEvent(e);
  return e;
};
const wheel = (el: Element, deltaY: number, altKey: boolean) => {
  const e = new WheelEvent("wheel", { deltaY, altKey, bubbles: true, cancelable: true });
  // happy-dom's WheelEvent doesn't always carry the init fields through.
  if (e.altKey !== altKey) Object.defineProperty(e, "altKey", { value: altKey });
  if (e.deltaY !== deltaY) Object.defineProperty(e, "deltaY", { value: deltaY });
  el.dispatchEvent(e);
  return e;
};
const hoverEl = () => engine!.getSnapshot().hover?.target.el ?? null;

describe("pick mode", () => {
  it("does nothing while idle", () => {
    setup();
    move($("#avatar"));
    expect(engine!.getSnapshot().hover).toBeNull();
    const e = click($("#avatar"));
    expect(e.defaultPrevented).toBe(false);
  });

  it("hovers the deepest element and describes it", () => {
    setup();
    engine!.setMode("pick");
    move($("#avatar"));
    const h = engine!.getSnapshot().hover!;
    expect(h.target.el).toBe($("#avatar"));
    expect(h.target.label).toBe("img · avatar");
    expect(h.target.source).toBe("app/avatar.tsx:6:7");
    expect(h.target.inherited).toBe(false);
    expect(h.walked).toBe(0);
  });

  it("skips elements under 6px", () => {
    setup();
    setRect($("#name"), 0, 0, 4, 4);
    engine!.setMode("pick");
    move($("#name"));
    expect(hoverEl()).toBe($("#header"));
  });

  it("clears the hover over the kit's own UI, and never picks it", () => {
    setup();
    setRect($("proompter-root"), 0, 0, 100, 100);
    engine!.setMode("pick");
    move($("#avatar"));
    expect(hoverEl()).not.toBeNull();
    move($("proompter-root"));
    expect(hoverEl()).toBeNull();
    const e = click($("proompter-root"));
    expect(e.defaultPrevented).toBe(false); // the kit keeps its clicks
  });

  it("clicking commits the resolved element and swallows the click", () => {
    const { commits } = setup();
    const reached = vi.fn();
    document.body.addEventListener("click", reached);
    engine!.setMode("pick");
    move($("#avatar"));
    const e = click($("#avatar"));
    expect(e.defaultPrevented).toBe(true);
    expect(reached).not.toHaveBeenCalled(); // the host app never sees it
    expect(commits).toHaveLength(1);
    const c = commits[0]!;
    expect(c.kind).toBe("element");
    if (c.kind !== "element") return;
    expect(c.target.el).toBe($("#avatar"));
    expect(c.target.selector).toBe('[data-src="app/avatar.tsx:6:7"]');
    expect(findBySelector(document, c.target.selector)).toBe($("#avatar"));
    expect(c.target.crumb).toBe("FeedPage › PostCard › Avatar › img · avatar");
    document.body.removeEventListener("click", reached);
  });

  it("ignores clicks on html/body (nothing to pick) without swallowing them", () => {
    setup();
    setRect(document.body, 0, 0, 800, 600);
    engine!.setMode("pick");
    const e = click(document.body);
    expect(e.defaultPrevented).toBe(false);
  });

  it("while busy (composer open): no hover updates, no commits, but the click is still swallowed", () => {
    const { commits } = setup();
    engine!.setMode("pick");
    move($("#avatar"));
    engine!.setBusy(true);
    move($("#share"));
    expect(hoverEl()).toBe($("#avatar"));
    const e = click($("#share"));
    expect(e.defaultPrevented).toBe(true);
    expect(commits).toHaveLength(0);
    engine!.setBusy(false);
    move($("#share"));
    expect(hoverEl()).toBe($("#share"));
  });

  it("an unstamped child reports an inherited source", () => {
    setup({}, `<section data-src="a/b.tsx:3:3"><div><span id="x">hi</span></div></section>`);
    engine!.setMode("pick");
    move($("#x"));
    expect(engine!.getSnapshot().hover!.target.inherited).toBe(true);
    expect(engine!.getSnapshot().hover!.target.source).toBe("a/b.tsx:3:3");
  });
});

describe("tree walk", () => {
  it("↑ and [ go to the parent, ↓ and ] come back down the walked path", () => {
    setup();
    engine!.setMode("pick");
    move($("#avatar"));
    key(document.body, "ArrowUp");
    expect(hoverEl()).toBe($("#avatar-box"));
    expect(engine!.getSnapshot().hover!.walked).toBe(1);
    key(document.body, "[");
    expect(hoverEl()).toBe($("#header"));
    expect(engine!.getSnapshot().hover!.walked).toBe(2);
    key(document.body, "ArrowDown");
    expect(hoverEl()).toBe($("#avatar-box"));
    key(document.body, "]");
    expect(hoverEl()).toBe($("#avatar"));
    expect(engine!.getSnapshot().hover!.walked).toBe(0);
    key(document.body, "]"); // nothing left to walk down to
    expect(hoverEl()).toBe($("#avatar"));
  });

  it("stops at the top of the page (never html/body)", () => {
    setup();
    engine!.setMode("pick");
    move($("#card"));
    key(document.body, "ArrowUp");
    expect(hoverEl()).toBe($("main"));
    key(document.body, "ArrowUp");
    expect(hoverEl()).toBe($("main"));
    expect(engine!.getSnapshot().hover!.walked).toBe(1);
  });

  it("Alt + wheel does the same, and only with Alt", () => {
    setup();
    engine!.setMode("pick");
    move($("#avatar"));
    const plain = wheel($("#avatar"), -100, false);
    expect(plain.defaultPrevented).toBe(false);
    expect(hoverEl()).toBe($("#avatar"));
    const up = wheel($("#avatar"), -100, true);
    expect(up.defaultPrevented).toBe(true);
    expect(hoverEl()).toBe($("#avatar-box"));
    wheel($("#avatar"), 100, true);
    expect(hoverEl()).toBe($("#avatar"));
  });

  it("a new pointer target resets the walk", () => {
    setup();
    engine!.setMode("pick");
    move($("#avatar"));
    key(document.body, "ArrowUp");
    move($("#share"));
    expect(engine!.getSnapshot().hover!.walked).toBe(0);
    key(document.body, "ArrowDown");
    expect(hoverEl()).toBe($("#share"));
  });

  it("a click inside the walked-to element picks that element", () => {
    const { commits } = setup();
    engine!.setMode("pick");
    move($("#avatar"));
    key(document.body, "ArrowUp");
    click($("#avatar"));
    const c = commits[0]!;
    expect(c.kind === "element" && c.target.el).toBe($("#avatar-box"));
    expect(c.kind === "element" && c.target.label).toBe("Avatar");
  });

  it("is off while typing in a field, with modifiers held, or outside pick modes", () => {
    setup();
    engine!.setMode("pick");
    move($("#avatar"));
    key($("#field"), "ArrowUp");
    expect(hoverEl()).toBe($("#avatar"));
    key(document.body, "ArrowUp", { metaKey: true });
    expect(hoverEl()).toBe($("#avatar"));
    engine!.setMode("text");
    key(document.body, "ArrowUp");
    expect(engine!.getSnapshot().hover).toBeNull();
  });
});

describe("keyboard picking (D8)", () => {
  const start = (opts: Partial<PickEngineOptions> = {}, markup = PAGE) => {
    const s = setup(opts, markup);
    s.engine.setMode("pick", true);
    return s;
  };

  it("starts on main when entered by key, and waits for the pointer when entered otherwise", () => {
    setup();
    engine!.setMode("pick");
    expect(hoverEl()).toBeNull();
    engine!.setMode("idle");
    engine!.setMode("pick", true);
    expect(hoverEl()).toBe($("main"));
    expect(engine!.getSnapshot().hover!.walked).toBe(0);
  });

  it("falls back to [role=main], then the first eligible child of body, never the kit", () => {
    start({}, `<proompter-root></proompter-root><div id="a" role="main"><b id="b">x</b></div>`);
    expect(hoverEl()).toBe($("#a"));
    engine!.dispose();
    start({}, `<proompter-root></proompter-root><script></script><div id="c"><b>x</b></div>`);
    setRect(document.querySelector("script")!, 0, 0, 0, 0);
    engine!.setMode("idle");
    engine!.setMode("pick", true);
    expect(hoverEl()).toBe($("#c"));
  });

  it("with no target yet, the first navigation key lands on the start target", () => {
    setup();
    engine!.setMode("pick");
    const e = key(document.body, "ArrowDown");
    expect(e.defaultPrevented).toBe(true);
    expect(hoverEl()).toBe($("main"));
  });

  it("→ ← move between element siblings; ↓ goes to the first child", () => {
    start();
    key(document.body, "ArrowDown");
    expect(hoverEl()).toBe($("#card"));
    key(document.body, "ArrowDown");
    expect(hoverEl()).toBe($("#header"));
    key(document.body, "ArrowRight");
    expect(hoverEl()).toBe($("#body"));
    key(document.body, "ArrowRight");
    expect(hoverEl()).toBe($("#share"));
    key(document.body, "ArrowRight");
    expect(hoverEl()).toBe($("#field"));
    key(document.body, "ArrowRight"); // last sibling: stays
    expect(hoverEl()).toBe($("#field"));
    key(document.body, "ArrowLeft");
    key(document.body, "ArrowLeft");
    key(document.body, "ArrowLeft");
    expect(hoverEl()).toBe($("#header"));
    key(document.body, "ArrowLeft"); // first sibling: stays
    expect(hoverEl()).toBe($("#header"));
  });

  it("↑ and ↓ walk back along the path; a sibling move forgets it", () => {
    start();
    key(document.body, "ArrowDown");
    key(document.body, "ArrowDown");
    key(document.body, "ArrowDown");
    expect(hoverEl()).toBe($("#avatar-box"));
    key(document.body, "ArrowUp");
    expect(hoverEl()).toBe($("#header"));
    expect(engine!.getSnapshot().hover!.walked).toBe(1);
    key(document.body, "ArrowDown");
    expect(hoverEl()).toBe($("#avatar-box"));
    key(document.body, "ArrowRight");
    expect(hoverEl()).toBe($("#name"));
    key(document.body, "ArrowUp");
    key(document.body, "ArrowRight");
    expect(engine!.getSnapshot().hover!.walked).toBe(0);
  });

  it("skips siblings and children under 6x6, and never lands on the kit", () => {
    start();
    key(document.body, "ArrowDown");
    key(document.body, "ArrowDown"); // header
    setRect($("#body"), 0, 0, 5, 40);
    key(document.body, "ArrowRight");
    expect(hoverEl()).toBe($("#share"));
    key(document.body, "ArrowLeft");
    expect(hoverEl()).toBe($("#header"));
    setRect($("#avatar-box"), 0, 0, 40, 5);
    key(document.body, "ArrowDown");
    expect(hoverEl()).toBe($("#name"));
    engine!.setMode("idle");
    engine!.setMode("pick", true);
    key(document.body, "ArrowRight"); // main's next sibling is the kit
    expect(hoverEl()).toBe($("main"));
  });

  it("Tab and Shift+Tab move through focusable elements in DOM order without moving focus", () => {
    start();
    key(document.body, "Tab");
    expect(hoverEl()).toBe($("#share"));
    key(document.body, "Tab");
    expect(hoverEl()).toBe($("#field"));
    key(document.body, "Tab");
    expect(hoverEl()).toBe($("#field"));
    key(document.body, "Tab", { shiftKey: true });
    expect(hoverEl()).toBe($("#share"));
    key(document.body, "Tab", { shiftKey: true });
    expect(hoverEl()).toBe($("#share"));
    expect(document.activeElement).toBe(document.body);
  });

  it("[ and ] still walk, and the target is scrolled into view (nearest)", () => {
    start();
    const scroll = vi.fn();
    $("#card").scrollIntoView = scroll;
    key(document.body, "ArrowDown");
    expect(scroll).toHaveBeenCalledWith({ block: "nearest", inline: "nearest" });
    key(document.body, "]");
    expect(hoverEl()).toBe($("#header"));
    key(document.body, "[");
    expect(hoverEl()).toBe($("#card"));
  });

  it("consumes the keys so the page and the host never see them", () => {
    start();
    const seen = vi.fn();
    document.addEventListener("keydown", seen);
    for (const k of ["Tab", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "[", "]", "Enter", " "]) {
      expect(key(document.body, k).defaultPrevented, k).toBe(true);
    }
    expect(seen).not.toHaveBeenCalled();
    document.removeEventListener("keydown", seen);
  });

  it("Enter and Space commit the target exactly as a click would", () => {
    const { commits } = start();
    key(document.body, "ArrowDown");
    key(document.body, "ArrowDown");
    key(document.body, "Enter");
    key(document.body, " ");
    expect(commits).toHaveLength(2);
    const c = commits[0]!;
    expect(c.kind === "element" && c.target.el).toBe($("#header"));
    expect(c.kind === "element" && c.target.selector).toBe(resolveTarget($("#header")).selector);
  });

  it("in multi mode Enter toggles the target in the selection", () => {
    setup();
    engine!.setMode("multi", true);
    key(document.body, "Enter");
    expect(engine!.getSnapshot().multi.map((t) => t.el)).toEqual([$("main")]);
    key(document.body, "Enter");
    expect(engine!.getSnapshot().multi).toHaveLength(0);
  });

  it("is inert while busy, when typing, composing, or with modifiers", () => {
    const { commits } = start();
    key(document.body, "ArrowDown");
    key($("#field"), "Enter");
    key($("#field"), "ArrowDown");
    expect(key($("#field"), "Enter").defaultPrevented).toBe(false);
    key(document.body, "Enter", { metaKey: true });
    key(document.body, "ArrowRight", { altKey: true });
    key(document.body, "ArrowRight", { isComposing: true });
    expect(commits).toHaveLength(0);
    expect(hoverEl()).toBe($("#card"));
    engine!.setBusy(true);
    key(document.body, "ArrowDown");
    expect(hoverEl()).toBe($("#card"));
  });

  it("leaves the keys alone outside pick and multi mode, and Esc still exits", () => {
    setup();
    expect(key(document.body, "Enter").defaultPrevented).toBe(false);
    engine!.setMode("text");
    expect(key(document.body, "Tab").defaultPrevented).toBe(false);
    engine!.setMode("pick", true);
    expect(key(document.body, "Escape").defaultPrevented).toBe(true);
    expect(engine!.mode).toBe("idle");
  });

  it("seeds on a frame surface that attaches after the shortcut, and not after a non-key entry", () => {
    const frameLike = {
      contentDocument: document,
      contentWindow: window,
      ownerDocument: document,
      offsetWidth: 390,
      offsetHeight: 844,
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 390, height: 844 }) as DOMRect,
    } as unknown as FrameLike;
    setup();
    engine!.attach(null);
    engine!.setMode("pick", true); // P pressed while the device frame is still loading
    expect(hoverEl()).toBeNull();
    engine!.attach(createFrameSurface(frameLike, "mobile")!);
    expect(hoverEl()).toBe($("main"));
    engine!.setMode("idle");
    engine!.setMode("pick");
    engine!.attach(createFrameSurface(frameLike, "tablet")!);
    expect(hoverEl()).toBeNull();
  });

  it("works from a device frame: keys in the host document move and commit the target", () => {
    const hostDoc = document.implementation.createHTMLDocument("host");
    hostDoc.body.innerHTML = `<button id="host-btn"></button>`;
    const { commits } = setup();
    const frame = {
      contentDocument: document,
      contentWindow: window,
      ownerDocument: hostDoc,
      offsetWidth: 390,
      offsetHeight: 844,
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 390, height: 844 }) as DOMRect,
    } as unknown as FrameLike;
    engine!.attach(createFrameSurface(frame, "mobile")!);
    engine!.setMode("pick", true);
    expect(hoverEl()).toBe($("main"));
    const hostKey = (k: string) => {
      const e = new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true });
      hostDoc.getElementById("host-btn")!.dispatchEvent(e);
      return e;
    };
    expect(hostKey("ArrowDown").defaultPrevented).toBe(true);
    expect(hoverEl()).toBe($("#card"));
    hostKey("Enter");
    expect(commits).toHaveLength(1);
  });
});

describe("multi mode", () => {
  it("numbers selections in click order; clicking again removes", () => {
    setup();
    engine!.setMode("multi");
    click($("#avatar"));
    click($("#share"));
    click($("#name"));
    expect(engine!.getSnapshot().multi.map((t) => t.el.id)).toEqual(["avatar", "share", "name"]);
    click($("#share"));
    expect(engine!.getSnapshot().multi.map((t) => t.el.id)).toEqual(["avatar", "name"]);
  });

  it("Add entry commits all of them, Clear empties", () => {
    const { commits } = setup();
    engine!.setMode("multi");
    click($("#avatar"));
    click($("#share"));
    engine!.commitMulti();
    const c = commits[0]!;
    expect(c.kind).toBe("multi");
    expect(c.kind === "multi" && c.targets.map((t) => t.el.id)).toEqual(["avatar", "share"]);
    engine!.clearMulti();
    expect(engine!.getSnapshot().multi).toHaveLength(0);
    engine!.commitMulti();
    expect(commits).toHaveLength(1);
  });

  it("leaving multi mode drops the selection", () => {
    setup();
    engine!.setMode("multi");
    click($("#avatar"));
    engine!.setMode("pick");
    expect(engine!.getSnapshot().multi).toHaveLength(0);
  });
});

describe("box mode", () => {
  const BOX = `
    <section data-src="s.tsx:1:1" id="s"><div data-src="a.tsx:1:1" id="a"></div><div data-src="b.tsx:1:1" id="b"></div></section>
    <div data-src="o.tsx:1:1" id="o"></div><div data-src="z.tsx:1:1" id="z"></div>`;
  function boxSetup() {
    const ctx = setup({}, BOX);
    setRect($("#s"), 10, 10, 300, 200);
    setRect($("#a"), 20, 20, 100, 50);
    setRect($("#b"), 150, 20, 100, 50);
    setRect($("#o"), 400, 300, 50, 50);
    setRect($("#z"), 20, 300, 0, 0);
    return ctx;
  }

  it("keeps only the topmost matches", () => {
    const { surface } = boxSetup();
    const ids = (r: { left: number; top: number; width: number; height: number }) =>
      boxTargets(surface, r).map((e) => e.id);
    expect(ids({ left: 0, top: 0, width: 320, height: 220 })).toEqual(["s"]); // a and b are inside s
    expect(ids({ left: 15, top: 15, width: 260, height: 100 })).toEqual(["a", "b"]); // s is not fully inside
    expect(ids({ left: 0, top: 0, width: 600, height: 400 })).toEqual(["s", "o"]);
    expect(ids({ left: 15, top: 15, width: 50, height: 30 })).toEqual([]); // nothing fully inside
  });

  it("commits only in box mode and ignores tiny drags", () => {
    const { commits } = boxSetup();
    expect(engine!.commitBox({ left: 0, top: 0, width: 320, height: 220 })).toBe(false); // idle
    engine!.setMode("box");
    expect(engine!.commitBox({ left: 0, top: 0, width: 7, height: 300 })).toBe(false);
    expect(engine!.commitBox({ left: 0, top: 0, width: 300, height: 7 })).toBe(false);
    expect(commits).toHaveLength(0);
    expect(engine!.commitBox({ left: 0, top: 0, width: 320, height: 220 })).toBe(true);
    const c = commits[0]!;
    expect(c.kind).toBe("box");
    expect(c.kind === "box" && c.targets.map((t) => t.el.id)).toEqual(["s"]);
    expect(c.kind === "box" && c.rect).toEqual({ left: 0, top: 0, width: 320, height: 220 });
  });

  it("dragRect normalises any drag direction", () => {
    expect(dragRect({ x: 50, y: 60 }, { x: 10, y: 20 })).toEqual({ left: 10, top: 20, width: 40, height: 40 });
  });
});

/** A text-selection gesture: press on the page, release (the selection itself is stubbed). */
function gesture(upOn: EventTarget = document) {
  $("#body").dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
  upOn.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
}

describe("text mode", () => {
  function select(text: string, anchor: Node) {
    Object.defineProperty(document, "getSelection", {
      configurable: true,
      value: () => ({
        isCollapsed: text === "",
        rangeCount: 1,
        anchorNode: anchor,
        toString: () => text,
        getRangeAt: () => ({ getBoundingClientRect: () => ({ left: 5, top: 6, width: 70, height: 16 }) }),
      }),
    });
  }

  it("quotes the selection with its element and rect", () => {
    const { commits } = setup();
    engine!.setMode("text");
    select("  Clutched a 1v4  ", $("#body").firstChild!);
    gesture();
    const c = commits[0]!;
    expect(c.kind).toBe("text");
    if (c.kind !== "text") return;
    expect(c.quote).toBe("Clutched a 1v4");
    expect(c.target?.el).toBe($("#body"));
    expect(c.target?.source).toBe("app/post-card.tsx:26:7");
    expect(c.rect).toEqual({ left: 5, top: 6, width: 70, height: 16 });
  });

  it("caps the quote at 200 characters", () => {
    const { commits } = setup();
    engine!.setMode("text");
    select("x".repeat(500), $("#body").firstChild!);
    gesture();
    const c = commits[0]!;
    expect(c.kind === "text" && c.quote.length).toBe(200);
  });

  it("ignores a mouseup over the kit, and a release whose press didn't start on the page", () => {
    const { commits } = setup();
    engine!.setMode("text");
    select("Clutched", $("#body").firstChild!);
    gesture($("proompter-root")); // released over kit UI: a stale selection must not re-commit
    expect(commits).toHaveLength(0);
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true })); // no mousedown on the page first
    expect(commits).toHaveLength(0);
    $("proompter-root").dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); // press began on the kit
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    expect(commits).toHaveLength(0);
    gesture();
    expect(commits).toHaveLength(1);
  });

  it("ignores empty selections and other modes", () => {
    const { commits } = setup();
    engine!.setMode("text");
    select("", $("#body").firstChild!);
    gesture();
    engine!.setMode("pick");
    select("hello", $("#body").firstChild!);
    gesture();
    expect(commits).toHaveLength(0);
  });
});

describe("note mode and mode switching", () => {
  it("a page note commits straight away and leaves the engine idle", () => {
    const onModeChange = vi.fn();
    const { commits } = setup({ onModeChange });
    engine!.setMode("pick");
    engine!.setMode("note");
    expect(commits).toEqual([{ kind: "note" }]);
    expect(engine!.mode).toBe("idle");
    expect(onModeChange).toHaveBeenLastCalledWith("idle");
  });

  it("toggleMode: pressing the active mode again leaves it", () => {
    setup();
    engine!.toggleMode("pick");
    expect(engine!.mode).toBe("pick");
    engine!.toggleMode("pick");
    expect(engine!.mode).toBe("idle");
    engine!.toggleMode("box");
    engine!.toggleMode("multi");
    expect(engine!.mode).toBe("multi");
  });

  it("switching modes clears the hover", () => {
    setup();
    engine!.setMode("pick");
    move($("#avatar"));
    engine!.setMode("multi");
    expect(engine!.getSnapshot().hover).toBeNull();
  });

  it("notifies subscribers with a new snapshot object per change", () => {
    setup();
    const cb = vi.fn();
    const off = engine!.subscribe(cb);
    const before = engine!.getSnapshot();
    engine!.setMode("pick");
    expect(cb).toHaveBeenCalled();
    expect(engine!.getSnapshot()).not.toBe(before);
    expect(before.mode).toBe("idle"); // snapshots are immutable
    off();
  });
});

describe("Escape", () => {
  it("leaves the current mode", () => {
    setup();
    engine!.setMode("pick");
    key(document.body, "Escape");
    expect(engine!.mode).toBe("idle");
  });

  it("works from every pick mode", () => {
    setup();
    for (const m of ["multi", "box", "text"] as const) {
      engine!.setMode(m);
      key(document.body, "Escape");
      expect(engine!.mode).toBe("idle");
    }
  });

  it("leaves it to the kit's UI when it came from there", () => {
    setup();
    engine!.setMode("pick");
    key($("proompter-root"), "Escape");
    expect(engine!.mode).toBe("pick");
  });

  it("while busy (composer open or exiting) goes to the ladder, never to the app", () => {
    const forwardKey = vi.fn();
    const host = vi.fn();
    setup({ escapeExits: false, forwardKey });
    window.addEventListener("keydown", host);
    engine!.setMode("pick");
    engine!.setBusy(true);
    key(document.body, "Escape");
    expect(forwardKey).toHaveBeenCalledOnce();
    expect(host).not.toHaveBeenCalled();
    window.removeEventListener("keydown", host);
  });

  it("can be turned off for a central Esc handler", () => {
    setup({ escapeExits: false });
    engine!.setMode("pick");
    key(document.body, "Escape");
    expect(engine!.mode).toBe("pick");
  });
});

describe("surfaces", () => {
  it("stops listening when detached, and starts clean on a new surface", () => {
    setup();
    engine!.setMode("multi");
    move($("#avatar"));
    click($("#avatar"));
    expect(engine!.getSnapshot().multi).toHaveLength(1);
    engine!.attach(null);
    expect(engine!.getSnapshot().multi).toHaveLength(0);
    const e = click($("#share"));
    expect(e.defaultPrevented).toBe(false);
    engine!.attach(createPageSurface(window));
    expect(engine!.mode).toBe("multi"); // the mode survives a surface change
    click($("#share"));
    expect(engine!.getSnapshot().multi).toHaveLength(1);
  });

  function frameSurface() {
    const frame = {
      contentDocument: document,
      contentWindow: window,
      ownerDocument: document,
      offsetWidth: 390,
      offsetHeight: 844,
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 390, height: 844 }) as DOMRect,
    } as unknown as FrameLike;
    return createFrameSurface(frame, "mobile")!;
  }

  it("device frames get a crosshair while picking; the live page gets nothing", () => {
    setup();
    engine!.attach(frameSurface());
    engine!.setMode("pick");
    expect(document.head.querySelector("style[data-proompter-pick]")).not.toBeNull();
    engine!.setMode("idle");
    expect(document.head.querySelector("style[data-proompter-pick]")).toBeNull();
    engine!.attach(createPageSurface(window));
    engine!.setMode("pick");
    expect(document.head.querySelector("style[data-proompter-pick]")).toBeNull();
  });

  it("forwards unused keys from a device frame (the host never sees them), not from the live page", () => {
    const forwardKey = vi.fn();
    setup({ forwardKey });
    key(document.body, "p");
    expect(forwardKey).not.toHaveBeenCalled();
    engine!.attach(frameSurface());
    key(document.body, "p");
    expect(forwardKey).toHaveBeenCalledTimes(1);
  });

  it("forwards global shortcut keys from a device frame in every mode, and while an entry is being drafted", () => {
    const forwardKey = vi.fn();
    setup({ forwardKey });
    engine!.attach(frameSurface());
    for (const mode of ["idle", "pick", "multi", "box", "text"] as const) {
      engine!.setMode(mode);
      for (const k of ["1", "3", "p", "n", "f", "r", "e"]) key(document.body, k);
    }
    engine!.setBusy(true);
    key(document.body, "1");
    expect(forwardKey).toHaveBeenCalledTimes(5 * 7 + 1);
    // Typing targets and modified keys are forwarded too; the root's handler decides (it skips fields and IME).
    const input = document.createElement("input");
    document.body.append(input);
    forwardKey.mockClear();
    key(input, "p");
    expect(forwardKey).toHaveBeenCalledTimes(1);
  });

  it("picks inside a scaled frame: rects go through toScreen", () => {
    setup({}, `<div data-src="a.tsx:1:1" id="a"></div>`);
    setRect($("#a"), 100, 100, 200, 100);
    const frame = {
      contentDocument: document,
      contentWindow: window,
      ownerDocument: document,
      offsetWidth: 390,
      offsetHeight: 844,
      getBoundingClientRect: () => ({ left: 300, top: 50, width: 195, height: 422 }) as DOMRect, // scale 0.5
    } as unknown as FrameLike;
    const s = createFrameSurface(frame, "mobile")!;
    engine!.attach(s);
    engine!.setMode("box");
    // In screen space #a is (350, 100, 100x50).
    expect(boxTargets(s, { left: 340, top: 90, width: 120, height: 70 }).map((e) => e.id)).toEqual(["a"]);
    expect(boxTargets(s, { left: 100, top: 100, width: 200, height: 100 })).toEqual([]);
  });
});

describe("the page does not react while picking", () => {
  const seen = (type: string) => {
    const fn = vi.fn();
    document.addEventListener(type, fn); // a host handler, bubbling
    return fn;
  };
  const TYPES = ["pointerdown", "mousedown", "pointerup", "mouseup", "dblclick", "auxclick", "contextmenu"];

  it("swallows press, release, double-click and context-menu events in pick and multi mode", () => {
    setup();
    for (const mode of ["pick", "multi"] as const) {
      engine!.setMode(mode);
      for (const type of TYPES) {
        const fn = seen(type);
        const e = new MouseEvent(type, { bubbles: true, cancelable: true });
        $("#avatar").dispatchEvent(e);
        expect(fn, `${mode} ${type}`).not.toHaveBeenCalled();
        expect(e.defaultPrevented, `${mode} ${type}`).toBe(true);
        document.removeEventListener(type, fn);
      }
    }
  });

  it("lets everything through while idle, in text mode, and for the kit's own UI", () => {
    setup();
    for (const type of TYPES) {
      const fn = seen(type);
      $("#avatar").dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
      expect(fn, `idle ${type}`).toHaveBeenCalledTimes(1);
      document.removeEventListener(type, fn);
    }
    engine!.setMode("text");
    const down = seen("mousedown");
    $("#body").dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    expect(down).toHaveBeenCalledTimes(1); // selecting text needs it
    document.removeEventListener("mousedown", down);
    engine!.setMode("pick");
    const kit = seen("mousedown");
    const e = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    $("proompter-root").dispatchEvent(e);
    expect(kit).toHaveBeenCalledTimes(1);
    expect(e.defaultPrevented).toBe(false);
    document.removeEventListener("mousedown", kit);
  });

  it("stops a touch from reaching the page but leaves the tap-to-click alone", () => {
    setup();
    engine!.setMode("pick");
    const fn = seen("touchstart");
    const e = new Event("touchstart", { bubbles: true, cancelable: true });
    $("#avatar").dispatchEvent(e);
    expect(fn).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(false);
    document.removeEventListener("touchstart", fn);
  });

  it("keeps the engine's keys from the host, including Esc", () => {
    setup();
    const host = vi.fn();
    window.addEventListener("keydown", host);
    document.addEventListener("keydown", host);
    engine!.setMode("pick");
    move($("#avatar"));
    expect(key(document.body, "ArrowUp").defaultPrevented).toBe(true);
    expect(key(document.body, "]").defaultPrevented).toBe(true);
    expect(key(document.body, "Escape").defaultPrevented).toBe(true);
    expect(engine!.mode).toBe("idle");
    expect(host).not.toHaveBeenCalled();
    // Idle again: Esc and arrows belong to the host.
    const idleEsc = key(document.body, "Escape");
    expect(idleEsc.defaultPrevented).toBe(false);
    expect(host).toHaveBeenCalled();
    window.removeEventListener("keydown", host);
    document.removeEventListener("keydown", host);
  });

  it("does not take arrows or brackets from the kit's own UI", () => {
    setup();
    engine!.setMode("pick");
    move($("#avatar"));
    const e = key($("proompter-root"), "ArrowUp");
    expect(e.defaultPrevented).toBe(false);
    expect(hoverEl()).toBe($("#avatar"));
    expect(key($("proompter-root"), "[").defaultPrevented).toBe(false);
  });
});

describe("device frames: keys pressed in the host document", () => {
  it("↑ ↓ [ ] and Esc reach the engine while picking, except from inputs and the kit", () => {
    setup();
    const hostDoc = document.implementation.createHTMLDocument("host");
    hostDoc.body.innerHTML = `<input id="host-input"><proompter-root id="host-kit"></proompter-root><button id="host-btn"></button>`;
    const frame = {
      contentDocument: document,
      contentWindow: window,
      ownerDocument: hostDoc,
      offsetWidth: 390,
      offsetHeight: 844,
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 390, height: 844 }) as DOMRect,
    } as unknown as FrameLike;
    engine!.attach(createFrameSurface(frame, "mobile")!);
    engine!.setMode("pick");
    move($("#avatar"));
    const hostKey = (target: string, k: string) => {
      const e = new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true });
      hostDoc.getElementById(target)!.dispatchEvent(e);
      return e;
    };
    expect(hostKey("host-btn", "ArrowUp").defaultPrevented).toBe(true);
    expect(hoverEl()).toBe($("#avatar-box"));
    hostKey("host-btn", "]");
    expect(hoverEl()).toBe($("#avatar"));
    hostKey("host-btn", "[");
    expect(hoverEl()).toBe($("#avatar-box"));
    hostKey("host-input", "ArrowUp"); // typing in a host field
    hostKey("host-kit", "ArrowUp"); // the kit's own UI
    expect(hoverEl()).toBe($("#avatar-box"));
    expect(hostKey("host-kit", "Escape").defaultPrevented).toBe(false);
    expect(engine!.mode).toBe("pick");
    expect(hostKey("host-btn", "Escape").defaultPrevented).toBe(true);
    expect(engine!.mode).toBe("idle");
  });
});
