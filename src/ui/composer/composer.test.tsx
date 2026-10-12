import { act, createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Entry, EntryEvent, ProompterPlugin } from "../../core/entry";
import type { PickCommit } from "../../core/pick";
import { resolveTarget } from "../../core/resolve";
import { createPageSurface, type PickSurface } from "../../core/surface";
import { setRect } from "../../core/test-dom";
import { Toaster, toast } from "../primitives/toast";
import { mountInShadow, type Mounted } from "../test-utils";
import { Composer, type ComposerHandle, type ComposerProps, type ComposerResult } from "./composer";
import { createMemoryStore, createStubCapture, mountMockPage, samplePlugin } from "./composer-fixtures";

let m: Mounted | null = null;
let page: ReturnType<typeof mountMockPage>;
let surface: PickSurface;

beforeEach(() => {
  page = mountMockPage();
  surface = createPageSurface(window);
  toast.clear();
  vi.stubGlobal("matchMedia", () => ({ matches: true })); // reduced motion: the exit animation takes no time
});
afterEach(async () => {
  await m?.unmount();
  m = null;
  page.dispose();
  toast.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const sleep = (ms: number) => act(async () => void (await new Promise((r) => setTimeout(r, ms))));
const shadow = () => m!.shadow();
const q = <T extends Element = HTMLElement>(sel: string) => shadow().querySelector<T>(sel);
const qa = (sel: string) => Array.from(shadow().querySelectorAll(sel));
const button = (name: RegExp) => qa("button").find((b) => name.test(b.textContent ?? "") || name.test(b.getAttribute("aria-label") ?? "")) as HTMLButtonElement;

const key = (el: Element, k: string, init: KeyboardEventInit = {}) =>
  act(async () => {
    el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, composed: true, ...init }));
  });

/** Set a React-controlled field's value the way a user's typing would. */
const type = (el: Element, value: string) =>
  act(async () => {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });

const click = (el: Element) => act(async () => void el.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true })));

interface Setup {
  commit?: PickCommit;
  plugins?: readonly ProompterPlugin[];
  props?: Partial<ComposerProps>;
  capture?: ReturnType<typeof createStubCapture>;
}

async function open(setup: Setup = {}) {
  const store = createMemoryStore({ plugins: setup.plugins });
  const capture = setup.capture ?? createStubCapture();
  const results: ComposerResult[] = [];
  const events: EntryEvent[] = [];
  store.on((e) => events.push(e));
  const commit: PickCommit = setup.commit ?? { kind: "element", target: resolveTarget(page.els.avatar) };
  m = await mountInShadow(
    <>
      <Composer
        commit={commit}
        surface={surface}
        viewport="mobile"
        size={{ width: 390, height: 844 }}
        rotated={false}
        route="/feeds"
        capture={capture}
        store={store}
        plugins={setup.plugins}
        onClose={(r) => results.push(r)}
        {...setup.props}
      />
      <Toaster />
    </>,
    { css: "" },
  );
  await store.ready;
  await sleep(50); // past the outside-click listener (a tick) and the title autofocus (30ms)
  return { store, capture, results, events };
}

const fileEntry = async (title = "Avatar is cropped on mobile") => {
  await type(q("input")!, title);
  await key(q("input")!, "Enter", { metaKey: true });
  await sleep(20);
};

describe("<Composer> header", () => {
  it("names the target, shows the source chip and the viewport size", async () => {
    await open();
    expect(q(".pm-nm")?.textContent).toBe("Avatar");
    expect(q(".pm-target .chip.mono")?.textContent).toBe("avatar.tsx:9:3");
    expect(q(".pm-comp-hd .chip.ghost")?.textContent).toBe("390×844");
    expect(q(".pm-comp")?.getAttribute("role")).toBe("dialog");
    expect(q(".pm-comp")?.classList.contains("on")).toBe(true);
  });

  it("marks an inherited source with the arrow and says so in the title", async () => {
    await open({ commit: { kind: "element", target: resolveTarget(page.els.ring) } });
    const chip = q(".pm-target .chip.mono")!;
    expect(chip.textContent).toBe("↳ avatar.tsx:9:3");
    expect(chip.getAttribute("title")).toMatch(/^Nearest component source/);
  });

  it("copies the full source from the chip", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    await open();
    await click(q(".pm-target .chip.mono")!);
    expect(writeText).toHaveBeenCalledWith("src/components/gamorite/avatar.tsx:9:3");
    await sleep(0);
    expect(shadow().querySelector(".toast")?.textContent).toBe("Copied avatar.tsx:9:3");
  });

  it.each([
    ["multi", { kind: "multi" } as const, "3 elements"],
    ["box", { kind: "box" } as const, "2 elements in a box"],
    ["text", { kind: "text" } as const, "Quoted text"],
    ["note", { kind: "note" } as const, "Page note"],
  ])("%s: header name", async (_n, base, name) => {
    const els = page.els;
    const commit: PickCommit =
      base.kind === "multi"
        ? { kind: "multi", targets: [els.avatar, els.text, els.share].map(resolveTarget) }
        : base.kind === "box"
          ? { kind: "box", targets: [els.avatar, els.text].map(resolveTarget), rect: { left: 10, top: 10, width: 100, height: 50 } }
          : base.kind === "text"
            ? { kind: "text", quote: "Clutched a 1v4", target: resolveTarget(els.text), rect: { left: 10, top: 10, width: 100, height: 20 } }
            : { kind: "note" };
    await open({ commit });
    expect(q(".pm-nm")?.textContent).toBe(name);
    if (base.kind === "note") expect(q(".pm-target .chip.mono")).toBeNull();
    if (base.kind === "text") expect(q(".pm-quote")?.textContent).toBe("“Clutched a 1v4”");
  });

  it("shows no source chip when nothing is stamped, and says so in the context block", async () => {
    document.body.insertAdjacentHTML("beforeend", '<div id="loose" style="width:20px;height:20px"></div>');
    try {
      const el = document.getElementById("loose")!;
      await open({ commit: { kind: "element", target: resolveTarget(el) } });
      expect(q(".pm-target .chip.mono")).toBeNull();
      expect(q(".pm-ctx-in .pm-log")?.textContent).toContain("no source");
    } finally {
      document.getElementById("loose")?.remove();
    }
  });
});

describe("<Composer> title validation", () => {
  it("an empty title shows the error, focuses the title, and files nothing", async () => {
    const { store, results } = await open();
    const err = q(".pm-err")!;
    expect(err.hasAttribute("hidden")).toBe(true);
    await click(button(/create entry/i));
    await sleep(10);
    expect(err.hasAttribute("hidden")).toBe(false);
    expect(err.textContent).toBe("Add a title. It becomes the file name and the GitHub issue title.");
    expect(q("input")?.getAttribute("aria-invalid")).toBe("true");
    expect(shadow().activeElement).toBe(q("input"));
    expect(store.getState().entries).toHaveLength(0);
    expect(results).toEqual([]);
  });

  it("a whitespace-only title is empty too", async () => {
    const { store } = await open();
    await type(q("input")!, "   ");
    await key(q("input")!, "Enter", { metaKey: true });
    await sleep(10);
    expect(q(".pm-err")?.hasAttribute("hidden")).toBe(false);
    expect(store.getState().entries).toHaveLength(0);
  });

  it("typing a title clears the error", async () => {
    await open();
    await click(button(/create entry/i));
    await type(q("input")!, "x");
    expect(q(".pm-err")?.hasAttribute("hidden")).toBe(true);
    expect(q("input")?.hasAttribute("aria-invalid")).toBe(false);
  });

  it("Enter in the title moves to the description instead of submitting", async () => {
    const { store } = await open();
    await type(q("input")!, "Title");
    await key(q("input")!, "Enter");
    expect(shadow().activeElement).toBe(q("textarea"));
    expect(store.getState().entries).toHaveLength(0);
  });
});

describe("<Composer> saving with ⌘↵", () => {
  it("files the entry with everything the composer knows", async () => {
    const { store, results, events } = await open();
    await type(q("textarea")!, "  The crop cuts the top of the face.  ");
    await fileEntry();
    expect(store.getState().entries).toHaveLength(1);
    const e = store.getState().entries[0] as Entry;
    expect(e).toMatchObject({
      id: "PRO-1",
      n: 1,
      status: "open",
      intent: "fix",
      priority: "important",
      kind: "element",
      title: "Avatar is cropped on mobile",
      description: "  The crop cuts the top of the face.", // leading indentation is kept, trailing space dropped
      viewport: "mobile",
      size: { width: 390, height: 844 },
      rotated: false,
      route: "/feeds",
      tags: [],
      issue: null,
    });
    expect(e.testPlan).toBeUndefined();
    expect(e.task).toBeUndefined();
    expect(e.target).toMatchObject({ source: "src/components/gamorite/avatar.tsx:9:3", sourceInherited: false, label: "Avatar" });
    expect(e.target?.selector).toContain("avatar.tsx:9:3");
    expect(e.target?.component).toBe("FeedPage › PostCard › PostHeader › Avatar");
    expect(e.context.console).toHaveLength(2);
    expect(e.context.network).toHaveLength(4);
    expect(e.context.build).toBe("migrate/main@611df0b");
    expect(e.snapshot).toMatchObject({ fontsEmbedded: true, assets: { element: "001-mobile.png", viewport: "001-mobile-full.png" } });
    expect(e.snapshot?.element).toMatch(/^data:image\/png/);
    expect(e.activity[0]).toMatchObject({ who: "rachit", text: "created" });

    expect(events).toEqual([{ type: "entry:created", entry: e }]);
    expect(results).toEqual([{ type: "saved", entry: e }]);
    expect(shadow().querySelector(".toast")).toBeNull(); // the root toasts, not the composer
  });

  it("Ctrl+Enter works too, and from the description", async () => {
    const { store } = await open();
    await type(q("input")!, "T");
    await key(q("textarea")!, "Enter", { ctrlKey: true });
    await sleep(20);
    expect(store.getState().entries).toHaveLength(1);
  });

  it("the button files it as well", async () => {
    const { store } = await open();
    await type(q("input")!, "T");
    await click(button(/create entry/i));
    await sleep(20);
    expect(store.getState().entries).toHaveLength(1);
  });

  it("takes the snapshot of the primary element on the surface", async () => {
    const capture = createStubCapture();
    const spy = vi.spyOn(capture, "snapshot");
    await open({ capture });
    await fileEntry();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[0]).toBe(surface);
    expect(spy.mock.calls[0]?.[1]).toBe(page.els.avatar);
  });

  it("a pressed-twice shortcut files one entry", async () => {
    const { store } = await open({ capture: createStubCapture({ snapshot: () => new Promise((r) => setTimeout(() => r({ fontsEmbedded: true }), 15)) }) });
    await type(q("input")!, "Once");
    await key(q("input")!, "Enter", { metaKey: true });
    await key(q("input")!, "Enter", { metaKey: true });
    await sleep(60);
    expect(store.getState().entries).toHaveLength(1);
    expect(store.getState().entries[0]?.snapshot).toBeUndefined(); // no images came back, so no snapshot record
  });

  it("a failing snapshot still files the entry, without a picture", async () => {
    const capture = createStubCapture();
    capture.snapshot = () => Promise.reject(new Error("canvas tainted"));
    const { store } = await open({ capture });
    await fileEntry();
    expect(store.getState().entries).toHaveLength(1);
    expect(store.getState().entries[0]?.snapshot).toBeUndefined();
  });

  it("says so when the capture yields no picture, with a short reason", async () => {
    const capture = createStubCapture({ snapshot: () => Promise.resolve({ fontsEmbedded: true, error: `SecurityError ${"x".repeat(200)}` }) });
    await open({ capture });
    await fileEntry();
    const t = qa(".toast").map((x) => x.textContent ?? "")[0] ?? "";
    expect(t).toMatch(/^Saved without a screenshot: SecurityError x+\.\.\.$/);
    expect(t.length).toBeLessThan(120);
  });

  it("says which picture is missing when only the element crop failed", async () => {
    const snapshot = () => Promise.resolve({ fontsEmbedded: true, viewport: "data:image/png;base64,V", elementError: "crop broke", error: "other" });
    await open({ capture: createStubCapture({ snapshot }) });
    await fileEntry();
    expect(qa(".toast").map((x) => x.textContent)).toEqual(["Saved without the element screenshot: crop broke"]);
  });

  it("a picture, or a redaction failure, gets no 'Saved without a screenshot' toast", async () => {
    await open({ capture: createStubCapture({ snapshot: () => Promise.resolve({ fontsEmbedded: true, redactFailed: true }) }) });
    await fileEntry();
    expect(qa(".toast").map((x) => x.textContent)).toEqual(["Snapshot hidden: it couldn't be redacted."]);
  });

  it("a text selection files its quote; a page note files no target", async () => {
    const text = await open({
      commit: { kind: "text", quote: "Clutched a 1v4", target: resolveTarget(page.els.text), rect: { left: 1, top: 1, width: 10, height: 10 } },
    });
    await fileEntry("Quote");
    expect(text.store.getState().entries[0]).toMatchObject({ kind: "text", quote: "Clutched a 1v4" });
    await m!.unmount();
    m = null;

    const note = await open({ commit: { kind: "note" } });
    await fileEntry("Note");
    const e = note.store.getState().entries[0]!;
    expect(e.kind).toBe("note");
    expect(e.target).toBeUndefined();
    expect(e.targets).toEqual([]);
  });

  it("multi and box file every target", async () => {
    const els = page.els;
    const { store } = await open({ commit: { kind: "multi", targets: [els.avatar, els.text, els.share].map(resolveTarget) } });
    await fileEntry("Three");
    const e = store.getState().entries[0]!;
    expect(e.targets.map((t) => t.source)).toEqual([
      "src/components/gamorite/avatar.tsx:9:3",
      "src/app/(app)/feeds/_components/post-card.tsx:61:9",
      "src/app/(app)/feeds/_components/post-actions.tsx:21:7",
    ]);
    expect(e.target).toEqual(e.targets[0]);
  });
});

describe("<Composer> discarding", () => {
  it("the root discards through the ref; Esc alone is the root's, not the composer's", async () => {
    const ref = createRef<ComposerHandle>();
    const { store, results } = await open({ props: { ref } });
    await type(q("input")!, "Half written");
    await key(q("input")!, "Escape");
    await sleep(10);
    expect(results).toEqual([]);
    await act(async () => void ref.current!.discard());
    await sleep(10);
    expect(results).toEqual([{ type: "discarded" }]);
    expect(store.getState().entries).toHaveLength(0);
    expect(q(".pm-comp")?.classList.contains("on")).toBe(false); // leaving
  });

  it("a click outside discards; a click inside does not", async () => {
    const { results } = await open();
    await act(async () => void q(".pm-comp-bd")!.dispatchEvent(new Event("pointerdown", { bubbles: true, composed: true })));
    await sleep(10);
    expect(results).toEqual([]);
    await act(async () => void document.body.dispatchEvent(new Event("pointerdown", { bubbles: true, composed: true })));
    await sleep(10);
    expect(results).toEqual([{ type: "discarded" }]);
  });

  it("the X and Cancel discard", async () => {
    const a = await open();
    await click(button(/^discard$/i));
    await sleep(10);
    expect(a.results).toEqual([{ type: "discarded" }]);
    await m!.unmount();
    m = null;
    const b = await open();
    await click(button(/^cancel$/i));
    await sleep(10);
    expect(b.results).toEqual([{ type: "discarded" }]);
  });

  it("closes once, however many ways are used", async () => {
    const ref = createRef<ComposerHandle>();
    const { results } = await open({ props: { ref } });
    await act(async () => void ref.current!.discard());
    await click(button(/^cancel$/i));
    await sleep(10);
    expect(results).toHaveLength(1);
  });

  it("onClose waits for the exit animation", async () => {
    vi.unstubAllGlobals(); // motion is reduced for every other test here
    const ref = createRef<ComposerHandle>();
    const { results } = await open({ props: { ref } });
    await act(async () => void ref.current!.discard());
    expect(results).toEqual([]);
    await sleep(60);
    expect(results).toEqual([]);
    await sleep(200);
    expect(results).toEqual([{ type: "discarded" }]);
  });
});

describe("<Composer> property menus", () => {
  const settle = () => sleep(30);
  const items = () => qa('[role^="menuitem"]');
  const active = () => shadow().activeElement as Element;
  const chip = (name: RegExp) => qa("button.chip").find((c) => name.test(c.textContent ?? "")) as HTMLButtonElement;

  async function openMenu(name: RegExp) {
    const c = chip(name);
    c.focus();
    await key(c, "ArrowDown");
    await settle();
  }

  it("Intent and Priority: defaults, then pick with the keyboard", async () => {
    const { store } = await open();
    expect(chip(/^Fix$/)).toBeTruthy();
    expect(chip(/^Important$/)).toBeTruthy();
    await openMenu(/^Important$/);
    expect(items().map((i) => i.textContent)).toEqual(["!Blocking", "Important", "Minor"]); // Blocking's icon is a "!"
    expect(items()[1]?.getAttribute("aria-checked")).toBe("true");
    await key(active(), "End");
    await key(active(), "Enter");
    await settle();
    expect(chip(/^Minor$/)).toBeTruthy();

    await openMenu(/^Fix$/);
    expect(items().map((i) => i.textContent)).toEqual(["Fix", "Change", "Question", "Looks good"]);
    await key(active(), "ArrowDown");
    await key(active(), "Enter");
    await settle();
    expect(chip(/^Change$/)).toBeTruthy();

    await fileEntry();
    expect(store.getState().entries[0]).toMatchObject({ intent: "change", priority: "minor" });
  });

  it("Tags is multi-select: the menu stays open and the chip lists the choices", async () => {
    const { store } = await open();
    await openMenu(/^Tags$/);
    expect(items().map((i) => i.textContent)).toEqual(["ui", "data", "copy", "a11y", "perf", "regression", "mobile"]);
    await key(active(), "Enter");
    await key(active(), "ArrowDown");
    await key(active(), "Enter");
    await settle();
    expect(items()).toHaveLength(7); // still open
    expect(chip(/^ui, data$/)).toBeTruthy();
    await key(items()[0]!, "Enter"); // untoggle ui
    await settle();
    expect(chip(/^data$/)).toBeTruthy();
    await key(active(), "Escape");
    await settle();
    await fileEntry();
    expect(store.getState().entries[0]?.tags).toEqual(["data"]);
  });

  it("Esc closes the open menu and leaves the composer open", async () => {
    const { results } = await open();
    await openMenu(/^Fix$/);
    expect(items().length).toBeGreaterThan(0);
    await key(active(), "Escape");
    await settle();
    expect(items()).toHaveLength(0);
    expect(results).toEqual([]);
  });

  it("a click on a menu item is not an outside click", async () => {
    const { results } = await open();
    await openMenu(/^Fix$/);
    await act(async () => void items()[1]!.dispatchEvent(new Event("pointerdown", { bubbles: true, composed: true })));
    await sleep(10);
    expect(results).toEqual([]);
  });

  it("no Test plan chip and no Task chip without plugins", async () => {
    await open();
    expect(chip(/Test plan/)).toBeUndefined();
    expect(q(".chip.acc")).toBeNull();
  });

  it("plugins add the read-only Task chip and the Test plan menu, and extra fields", async () => {
    const withCtx: ProompterPlugin = { name: "ctx", context: () => ({ owner: "dana" }) };
    const { store } = await open({ plugins: [samplePlugin, withCtx] });
    const task = q(".chip.acc")!;
    expect(task.textContent).toBe("T-feed-home");
    expect(task.tagName).toBe("SPAN"); // read-only
    expect(chip(/^Test plan$/)).toBeTruthy();
    await openMenu(/^Test plan$/);
    expect(items().map((i) => i.textContent)).toEqual(["Not linked", ...samplePlugin.testPlan!]);
    expect(items()[0]?.getAttribute("aria-checked")).toBe("true");
    await key(active(), "ArrowDown");
    await key(active(), "Enter");
    await settle();
    expect(chip(/§2 Feed and posts/)).toBeTruthy();
    await fileEntry();
    const e = store.getState().entries[0]!;
    expect(e).toMatchObject({ task: "T-feed-home", testPlan: "§2 Feed and posts", extra: { owner: "dana" } });
  });

  it("Not linked clears the test plan", async () => {
    const { store } = await open({ plugins: [samplePlugin] });
    await openMenu(/^Test plan$/);
    await key(active(), "ArrowDown");
    await key(active(), "Enter");
    await settle();
    await openMenu(/§2 Feed and posts/);
    await key(active(), "Home");
    await key(active(), "Enter");
    await settle();
    expect(chip(/^Test plan$/)).toBeTruthy();
    await fileEntry();
    expect(store.getState().entries[0]?.testPlan).toBeUndefined();
  });
});

describe("<Composer> redaction", () => {
  it("a redact plugin runs on save: the stored entry is the redacted one", async () => {
    const strip: ProompterPlugin = { name: "strip", redact: (e) => ({ ...e, description: e.description.replace(/secret-\w+/g, "[redacted]") }) };
    const { store, events } = await open({ plugins: [strip] });
    await type(q("textarea")!, "token secret-abc");
    await fileEntry();
    expect(store.getState().entries[0]?.description).toBe("token [redacted]");
    expect(events).toHaveLength(1);
    expect(JSON.stringify(events)).not.toContain("secret-abc");
  });

  it("a redact plugin that fails keeps the composer open with the reason, and files nothing", async () => {
    const broken: ProompterPlugin = {
      name: "gamorite-redact",
      redact: () => {
        throw new Error("boom");
      },
    };
    const { store, results, events } = await open({ plugins: [broken] });
    await type(q("textarea")!, "token secret-abc");
    await fileEntry();
    expect(store.getState().entries).toHaveLength(0);
    expect(events).toEqual([]);
    expect(results).toEqual([]);
    const alert = qa('[role="alert"]').find((a) => /failed to redact/.test(a.textContent ?? ""))!;
    expect(alert.textContent).toBe("Plugin gamorite-redact failed to redact this entry. Nothing was saved.");
    expect((q("textarea") as HTMLTextAreaElement).value).toBe("token secret-abc");
    expect(button(/create entry/i).getAttribute("aria-disabled")).toBeNull(); // can try again
  });
});

describe("<Composer> context block", () => {
  it("summarises the attached context and lists it when opened", async () => {
    await open();
    const summary = q(".pm-ctx summary")!;
    expect(summary.textContent).toBe("Context attached: 2 console lines, 4 requests, 1 failed");
    const rows = qa(".pm-ctx-in .pm-log div").map((d) => d.textContent);
    expect(rows).toContain("filesrc/components/gamorite/avatar.tsx:9:3");
    expect(rows).toContain("treeFeedPage › PostCard › PostHeader › Avatar");
    expect(rows.some((r) => r?.includes("error") && r.includes("GET /api/v1/feeds/trending 500"))).toBe(true);
    expect(rows).toContain("500911msGET /api/v1/feeds/trending");
    expect(q("details")?.hasAttribute("open")).toBe(false);
  });

  it("an empty capture says none", async () => {
    await open({ capture: createStubCapture({ context: { console: [], network: [] } }) });
    expect(q(".pm-ctx summary")?.textContent).toBe("Context attached: 0 console lines, 0 requests, 0 failed");
    expect(qa(".pm-ctx-in .pm-log div").filter((d) => d.textContent === "none")).toHaveLength(2);
  });

  it("uses singular for one", async () => {
    await open({ capture: createStubCapture({ context: { console: [createStubCapture().context().console[0]!], network: [] } }) });
    expect(q(".pm-ctx summary")?.textContent).toBe("Context attached: 1 console line, 0 requests, 0 failed");
  });
});

describe("<Composer> robustness and polish", () => {
  it("re-places itself when the panel grows (ResizeObserver)", async () => {
    const callbacks: Array<() => void> = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(cb: () => void) {
          callbacks.push(cb);
        }
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    try {
      const anchorTop = window.innerHeight - 140;
      setRect(page.els.avatar, 40, anchorTop, 44, 20);
      await open();
      const panel = q(".pm-comp")!;
      expect(panel.style.top).toBe(`${anchorTop + 20 + 10}px`); // below the target while the panel is still short
      Object.defineProperty(panel, "offsetHeight", { value: 300, configurable: true });
      await act(async () => void callbacks.forEach((cb) => cb()));
      expect(panel.style.top).toBe(`${anchorTop - 300 - 10}px`); // now it doesn't fit below: flips above
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("the title error stays for a whitespace-only title and goes for a real one", async () => {
    await open();
    await click(button(/create entry/i));
    await type(q("input")!, "   ");
    expect(q(".pm-err")?.hasAttribute("hidden")).toBe(false);
    await type(q("input")!, " x ");
    expect(q(".pm-err")?.hasAttribute("hidden")).toBe(true);
  });

  it("a throwing capture.context() still files the entry, without context", async () => {
    const capture = createStubCapture();
    capture.context = () => {
      throw new Error("capture broke");
    };
    const { store } = await open({ capture });
    expect(q(".pm-ctx summary")?.textContent).toBe("Context attached: 0 console lines, 0 requests, 0 failed");
    await fileEntry();
    const e = store.getState().entries[0]!;
    expect(e.context).toMatchObject({ console: [], network: [], queries: [] });
  });

  it("shows Ctrl ↵ off the Mac and ⌘↵ on it", async () => {
    Object.defineProperty(navigator, "platform", { value: "Linux x86_64", configurable: true });
    await open();
    expect(q(".pm-comp-ft kbd")?.textContent).toBe("Ctrl ↵");
    await m!.unmount();
    m = null;
    Object.defineProperty(navigator, "platform", { value: "MacIntel", configurable: true });
    await open();
    expect(q(".pm-comp-ft kbd")?.textContent).toBe("⌘↵");
  });

  it("keeps a description's leading indentation but not its trailing whitespace", async () => {
    const { store } = await open();
    await type(q("textarea")!, "\n    indented\nline   \n\n");
    await fileEntry();
    expect(store.getState().entries[0]?.description).toBe("    indented\nline");
  });
});
