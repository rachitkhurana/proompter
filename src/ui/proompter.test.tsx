import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "./primitives/toast";
import { Proompter } from "./proompter";
import type { ProompterProps } from "./proompter-deps";
import { createFakeDeps, type FakeDeps } from "./shell/fake";
import "./test-utils"; // act environment and the layout APIs happy-dom lacks

// The first open loads the whole UI chunk (and compiles the CSS), which takes a while.
vi.setConfig({ testTimeout: 30_000 });

let root: Root | undefined;
let host: HTMLElement | undefined;
const path0 = window.location.pathname;

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "development"); // the default mode; the preview tests below stub "production"
  localStorage.clear();
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  host?.remove();
  root = host = undefined;
  window.history.replaceState(null, "", path0);
  localStorage.clear();
  toast.clear();
  vi.unstubAllEnvs();
});

async function mount(props: ProompterProps = {}) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  // `shadowCss: ""` and `animated`: no CSS animations, so Radix's Presence unmounts without waiting on
  // `animationend`. `frameSrc`: device viewports frame a blank page instead of loading the test URL.
  await act(async () => root?.render(<Proompter shadowCss="" frameSrc="about:blank" {...props} />));
}

const wait = (ms: number) => act(async () => void (await new Promise((r) => setTimeout(r, ms))));
async function until(cond: () => unknown, what: string) {
  for (let i = 0; i < 400; i++) {
    if (cond()) return;
    await wait(20);
  }
  throw new Error(`timed out waiting for ${what}`);
}

const kit = () => document.querySelector("proompter-root");
const shadow = () => kit()?.shadowRoot ?? null;
const sq = <T extends Element = HTMLElement>(sel: string) => shadow()?.querySelector<T>(sel) ?? null;
const sheetOpen = () => !!sq(".pm-sheet.on");
/** The command menu (the fake composer is also a dialog, labelled "New entry"). */
const dialog = () => sq('[role="dialog"]:not([aria-label="New entry"])');

/** Keys go to `document`, as they do when the focus is on the page. */
const press = (k: string, init: KeyboardEventInit = {}, target: EventTarget = document.body) =>
  act(async () => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, composed: true, ...init }));
  });
const chord = () => press(">", { code: "Period", metaKey: true, shiftKey: true });

async function openKit(props: ProompterProps = {}) {
  const deps: FakeDeps = createFakeDeps();
  await mount({ deps, ...props });
  await act(async () => window.__proompter?.open());
  await until(() => sq(".dock"), "the kit to open");
  return deps;
}

describe("window.__proompter", () => {
  it("is installed on mount, draws nothing until opened, and is removed on unmount", async () => {
    expect(window.__proompter).toBeUndefined();
    await mount({ deps: createFakeDeps() });
    expect(window.__proompter).toBeDefined();
    expect(Object.keys(window.__proompter ?? {}).sort()).toEqual(["close", "disable", "enable", "enabled", "entries", "open", "toggle"]);
    expect(kit()).toBeNull();
    expect(document.querySelector("style[data-proompter-fonts]")).toBeNull();
    await act(async () => root?.unmount());
    root = undefined;
    expect(window.__proompter).toBeUndefined();
  });

  it("open, close and toggle show and hide the kit", async () => {
    await mount({ deps: createFakeDeps() });
    await act(async () => window.__proompter?.open());
    await until(() => sq(".dock"), "open()");
    expect(sq('[role="toolbar"]')).not.toBeNull();
    await act(async () => window.__proompter?.close());
    expect(kit()).toBeNull();
    await act(async () => window.__proompter?.toggle());
    await until(() => sq(".dock"), "toggle() to show");
    await act(async () => window.__proompter?.toggle());
    expect(kit()).toBeNull();
  });

  it("entries() returns the session's entries once the kit has loaded, and keeps them across hide and show", async () => {
    const deps = createFakeDeps();
    await mount({ deps });
    expect(window.__proompter?.entries()).toEqual([]); // the store loads with the UI chunk
    await act(async () => window.__proompter?.open());
    await until(() => sq(".dock"), "open()");
    expect(window.__proompter?.entries().map((e) => e.id)).toEqual(["PRO-1", "PRO-2", "PRO-3", "PRO-4"]);
    deps.store.update("PRO-3", { status: "resolved" }, "rachit");
    await act(async () => window.__proompter?.close());
    expect(window.__proompter?.entries().find((e) => e.id === "PRO-3")?.status).toBe("resolved");
    await act(async () => window.__proompter?.open());
    await until(() => sq(".dock"), "reopen");
    expect(window.__proompter?.entries()).toHaveLength(4);
  });

  it("defaultOpen opens it without a call", async () => {
    await mount({ deps: createFakeDeps(), defaultOpen: true });
    await until(() => sq(".dock"), "defaultOpen");
  });

  it("⌘⇧. toggles the kit", async () => {
    await mount({ deps: createFakeDeps() });
    await chord();
    await until(() => sq(".dock"), "the chord to open it");
    await chord();
    expect(kit()).toBeNull();
  });

  it("frame mode (?__proompter_frame=1) draws nothing and has no API, but exposes a capture", async () => {
    window.history.replaceState(null, "", `${path0}?__proompter_frame=1`);
    await mount({ deps: createFakeDeps(), defaultOpen: true });
    await until(() => window.__proompter_capture, "the frame capture");
    expect(window.__proompter).toBeUndefined();
    expect(kit()).toBeNull();
    await chord();
    expect(kit()).toBeNull();
    await act(async () => root?.unmount());
    root = undefined;
    expect(window.__proompter_capture).toBeUndefined();
  });

  it("nothing is added to the host document except the fonts tag, and all of it goes when hidden", async () => {
    await mount({ deps: createFakeDeps() });
    const before = document.body.innerHTML;
    await act(async () => window.__proompter?.open());
    await until(() => sq(".dock"), "the kit to open");
    expect(Array.from(document.body.children).filter((c) => c.localName === "proompter-root")).toHaveLength(1);
    await act(async () => window.__proompter?.close());
    expect(document.body.innerHTML).toBe(before);
  });

  it("opening the sheet, a ticket, its menus and the command menu changes nothing in the host document", async () => {
    const hostState = () => ({
      head: document.head.innerHTML,
      html: Array.from(document.documentElement.attributes).map((a) => `${a.name}=${a.value}`),
      bodyAttrs: Array.from(document.body.attributes).map((a) => `${a.name}=${a.value}`),
      bodyStyle: document.body.style.cssText,
      others: Array.from(document.body.children)
        .filter((c) => c.localName !== "proompter-root")
        .map((c) => c.outerHTML),
    });
    await openKit();
    const base = hostState(); // the fonts tag, if any, is already in
    const same = () => expect(hostState()).toEqual(base);

    await press("e");
    same();
    await act(async () => sq<HTMLElement>('.row[data-entry="PRO-1"]')!.click());
    same();
    const status = sq<HTMLElement>('[aria-label^="Status:"]')!;
    status.focus();
    await press("ArrowDown", {}, status);
    await wait(30);
    expect(sq('[role="menu"]')).not.toBeNull();
    same();
    await press("Escape", {}, shadow()!.activeElement ?? document.body);
    await wait(30);
    await press("K", { metaKey: true, shiftKey: true });
    await until(() => dialog(), "the command menu");
    same();
    expect(document.querySelectorAll("[aria-hidden],[data-scroll-locked],[inert]")).toHaveLength(0);
    expect(document.body.style.pointerEvents).toBe("");
  });

  it("p, m, e and 2 do nothing while a ticket menu is open", async () => {
    await openKit();
    await press("e");
    await act(async () => sq<HTMLElement>('.row[data-entry="PRO-1"]')!.click());
    const status = sq<HTMLElement>('[aria-label^="Status:"]')!;
    status.focus();
    await press("ArrowDown", {}, status);
    await wait(30);
    const item = shadow()!.activeElement ?? document.body;
    for (const k of ["e", "p", "m", "2"]) await press(k, {}, item);
    expect(sheetOpen()).toBe(true);
    expect(sq('[aria-label="Pick element"]')?.getAttribute("aria-pressed")).toBe("false");
    expect(sq('[role="radio"][aria-label="Responsive"]')?.getAttribute("aria-checked")).toBe("true");
  });

  it("p does not discard a composer draft", async () => {
    await openKit();
    await press("n");
    await until(() => sq('[role="dialog"][aria-label="New entry"]'), "the composer");
    const cancel = Array.from(shadow()!.querySelectorAll("button")).find((b) => b.textContent === "Cancel")!;
    cancel.focus();
    await press("p", {}, cancel);
    expect(sq('[role="dialog"][aria-label="New entry"]')).not.toBeNull();
  });
});

describe("several instances and capture", () => {
  const mountAt = async (props: ProompterProps) => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    const r = createRoot(el);
    await act(async () => r.render(<Proompter shadowCss="" frameSrc="about:blank" {...props} />));
    return {
      r,
      unmount: async () => {
        await act(async () => r.unmount());
        el.remove();
      },
    };
  };

  it("one ⌘⇧. listener drives the newest instance, and window.__proompter always points at a live one", async () => {
    const a = await mountAt({ deps: createFakeDeps() });
    const apiA = window.__proompter;
    const b = await mountAt({ deps: createFakeDeps() });
    const apiB = window.__proompter;
    expect(apiA).toBeDefined();
    expect(apiB).not.toBe(apiA);

    await chord(); // opens B only
    await until(() => document.querySelectorAll("proompter-root").length === 1, "one kit");
    await wait(50);
    expect(document.querySelectorAll("proompter-root")).toHaveLength(1);
    await chord(); // and closes it again
    expect(document.querySelectorAll("proompter-root")).toHaveLength(0);

    await b.unmount();
    expect(window.__proompter).toBe(apiA); // back to the survivor
    await chord();
    await until(() => document.querySelector("proompter-root"), "A to open");
    await a.unmount();
    expect(window.__proompter).toBeUndefined();
    expect(document.querySelector("proompter-root")).toBeNull();
    // No listener is left behind.
    await chord();
    expect(document.querySelector("proompter-root")).toBeNull();
  });

  it("capture starts when the page is idle, before the kit is ever opened, and is restored on unmount", async () => {
    const original = console.error;
    await mount({ deps: createFakeDeps() });
    expect(kit()).toBeNull();
    await until(() => console.error !== original, "capture to patch the console");
    const patched = console.error;
    // Opening the UI reuses that capture: the console is not wrapped a second time.
    await act(async () => window.__proompter?.open());
    await until(() => sq(".dock"), "the kit to open");
    expect(console.error).toBe(patched);
    await act(async () => window.__proompter?.close());
    expect(console.error).toBe(patched); // hiding the kit does not stop capture
    await act(async () => root?.unmount());
    root = undefined;
    expect(console.error).toBe(original);
  });
});

describe("keyboard", () => {
  it("E opens and closes the sheet; the dock's Entries button follows", async () => {
    await openKit();
    expect(sheetOpen()).toBe(false);
    await press("e");
    expect(sheetOpen()).toBe(true);
    expect(sq('[aria-label^="Entries, "]')?.getAttribute("aria-pressed")).toBe("true");
    await press("e");
    expect(sheetOpen()).toBe(false);
  });

  it("P toggles the pick tool, and the digits switch viewport (stage opens for Desktop)", async () => {
    await openKit();
    const pickBtn = () => sq('[aria-label="Pick element"]');
    await press("p");
    expect(pickBtn()?.getAttribute("aria-pressed")).toBe("true");
    await press("p");
    expect(pickBtn()?.getAttribute("aria-pressed")).toBe("false");
    await press("2");
    expect(sq('[role="radio"][aria-label="Desktop"]')?.getAttribute("aria-checked")).toBe("true");
    expect(sq(".pm-devcap")?.textContent).toContain("Desktop");
    await press("1");
    expect(sq('[role="radio"][aria-label="Responsive"]')?.getAttribute("aria-checked")).toBe("true");
    expect(sq(".pm-devcap")).toBeNull();
  });

  it("R rotates only on a device, F freezes", async () => {
    await openKit();
    const rot = () => sq('[aria-label="Rotate device"]');
    expect(rot()?.getAttribute("aria-disabled")).toBe("true");
    await press("r");
    expect(rot()?.getAttribute("aria-pressed")).toBe("false");
    await press("4");
    await press("r");
    expect(rot()?.getAttribute("aria-pressed")).toBe("true");
    await press("f");
    expect(sq('[aria-label="Freeze animations"]')?.getAttribute("aria-pressed")).toBe("true");
  });

  it("skips shortcuts typed into a text field, and events that were already handled", async () => {
    await openKit();
    const input = document.createElement("input");
    document.body.appendChild(input);
    await press("e", {}, input);
    expect(sheetOpen()).toBe(false);
    input.remove();
    // A listener earlier in the chain handles it (the dock grip's arrows do this): the root leaves it alone.
    const early = (e: Event) => e.preventDefault();
    document.addEventListener("keydown", early, true);
    await press("e");
    document.removeEventListener("keydown", early, true);
    expect(sheetOpen()).toBe(false);
    await press("e");
    expect(sheetOpen()).toBe(true);
  });

  it("⌘⇧K opens the command menu in the shadow root, focuses its search, and toggles it", async () => {
    await openKit();
    await press("K", { metaKey: true, shiftKey: true });
    await until(() => dialog(), "the command menu");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(shadow()?.activeElement?.getAttribute("role")).toBe("combobox");
    expect(sq('[aria-label="Command menu"][aria-pressed="true"]')).not.toBeNull();
    await press("K", { metaKey: true, shiftKey: true });
    await wait(30);
    expect(dialog()).toBeNull();
  });

  it("Esc closes one thing at a time: command menu, then mode, then ticket, then sheet", async () => {
    await openKit();
    // sheet -> ticket (via the row), then a mode and the command menu on top
    await press("e");
    const row = sq<HTMLElement>('.row[data-entry="PRO-1"]')!;
    await act(async () => row.click());
    expect(sq(".tk-title")).not.toBeNull();
    await press("p");
    await press("K", { metaKey: true, shiftKey: true });
    await until(() => dialog(), "the command menu");
    const pick = () => sq('[aria-label="Pick element"]')?.getAttribute("aria-pressed");
    expect(pick()).toBe("true");

    await press("Escape"); // command menu
    await wait(30);
    expect(dialog()).toBeNull();
    expect(pick()).toBe("true");
    expect(sq(".tk-title")).not.toBeNull();

    await press("Escape"); // current mode
    expect(pick()).toBe("false");
    expect(sq(".tk-title")).not.toBeNull();

    await press("Escape"); // ticket -> list
    expect(sq(".tk-title")).toBeNull();
    expect(sq(".row")).not.toBeNull();
    expect(sheetOpen()).toBe(true);

    await press("Escape"); // sheet
    expect(sheetOpen()).toBe(false);

    await press("Escape"); // nothing left: harmless
    expect(sheetOpen()).toBe(false);
  });

  it("Esc closes an open property menu before the ticket", async () => {
    await openKit();
    await press("e");
    await act(async () => sq<HTMLElement>('.row[data-entry="PRO-1"]')!.click());
    const status = sq<HTMLElement>('[aria-label^="Status:"]')!;
    status.focus();
    await press("ArrowDown", {}, status);
    await wait(30);
    expect(sq('[role="menu"]')).not.toBeNull();
    await press("Escape", {}, shadow()!.activeElement ?? document.body);
    await wait(30);
    expect(sq('[role="menu"]')).toBeNull();
    expect(sq(".tk-title")).not.toBeNull(); // the ticket is still there
  });

  it("N opens the composer, Esc discards it, and a created entry shows in the list and the toast", async () => {
    const deps = await openKit();
    await press("n");
    await until(() => sq('[role="dialog"][aria-label="New entry"]'), "the composer");
    await press("Escape");
    expect(sq('[role="dialog"][aria-label="New entry"]')).toBeNull();

    await press("n");
    await until(() => sq('[role="dialog"][aria-label="New entry"]'), "the composer");
    const title = sq<HTMLInputElement>('input[aria-label="Title"]')!;
    expect(shadow()?.activeElement).toBe(title);
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(title, "Footer overlaps the CTA");
      title.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await press("Enter", { metaKey: true }, title);
    expect(sq('[role="dialog"][aria-label="New entry"]')).toBeNull();
    const created = deps.store.getSnapshot().entries.at(-1);
    expect(created?.title).toBe("Footer overlaps the CTA");
    expect(created?.id).toBe("PRO-5");
    expect(sq('[aria-label^="Entries, 4 open"]')).not.toBeNull(); // 3 open before, plus the new one
    expect(sq(".toast")?.textContent).toContain("PRO-5 saved on responsive · entries/005-footer-overlaps-the-cta.md");
  });
});

describe("sheet from the keyboard and pins", () => {
  it("opens a ticket from the command menu, and Enter runs the highlighted command", async () => {
    await openKit();
    await press("K", { metaKey: true, shiftKey: true });
    await until(() => dialog(), "the command menu");
    const search = shadow()!.activeElement as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(search, "PRO-2");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await press("Enter", {}, search);
    await wait(30);
    expect(sq(".tk-title")?.textContent).toBe("Like counts twice on a double-tap");
    expect(sheetOpen()).toBe(true);
    expect(dialog()).toBeNull();
  });

  it("moves focus into the sheet when it opens and gives it back when it closes", async () => {
    await openKit();
    const entries = sq<HTMLElement>('[aria-label^="Entries, "]')!;
    entries.focus();
    await act(async () => entries.click());
    expect(shadow()?.activeElement).toBe(sq(".pm-sheet"));
    await press("Escape");
    expect(shadow()?.activeElement).toBe(entries);
  });
});

describe("shortcuts keep working after things close", () => {
  const pickPressed = () => sq('[aria-label="Pick element"]')?.getAttribute("aria-pressed");

  it("Esc typed in the command menu's search closes only the menu; the mode stays, and P still works", async () => {
    await openKit();
    await press("p");
    expect(pickPressed()).toBe("true");
    await press("K", { metaKey: true, shiftKey: true });
    await until(() => dialog(), "the command menu");
    await press("Escape", {}, shadow()!.activeElement as Element); // from the search field, as a user types it
    await wait(30);
    expect(dialog()).toBeNull();
    expect(pickPressed()).toBe("true"); // one Esc, one layer
    await press("p");
    expect(pickPressed()).toBe("false");
    await press("p");
    expect(pickPressed()).toBe("true");
  });

  it("after a property menu opens and closes, P works again", async () => {
    await openKit();
    await press("e");
    await act(async () => sq<HTMLElement>('.row[data-entry="PRO-1"]')!.click());
    const status = sq<HTMLElement>('[aria-label^="Status:"]')!;
    status.focus();
    await press("ArrowDown", {}, status);
    await wait(30);
    await press("p");
    expect(pickPressed()).toBe("false"); // ignored while the menu is open
    await press("Escape", {}, shadow()!.activeElement ?? document.body);
    await wait(30);
    expect(sq('[role="menu"]')).toBeNull();
    await press("p");
    expect(pickPressed()).toBe("true");
  });

  it("after the composer closes, P works again", async () => {
    await openKit();
    await press("n");
    await until(() => sq('[role="dialog"][aria-label="New entry"]'), "the composer");
    await press("Escape");
    await press("p");
    expect(pickPressed()).toBe("true");
  });
});

describe("default dependencies (T07's store)", () => {
  it("opens with no injected deps: an empty session, the real store behind the sheet", async () => {
    await mount({ session: { reviewer: "rachit", title: "Smoke pass" } });
    await act(async () => window.__proompter?.open());
    await until(() => sq(".dock"), "the kit to open");
    expect(window.__proompter?.entries()).toEqual([]);
    await press("e");
    expect(sq(".empty")?.textContent).toContain("No entries yet");
    expect(sq(".sh-hd b")?.textContent).toBe("Smoke pass");
  });
});

describe("preview mode (D15)", () => {
  const KEY = "proompter:enabled";
  let originalError: typeof console.error;
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
    originalError = console.error;
  });
  /** Capture wraps the console, so a changed `console.error` means it is running. */
  const patched = () => console.error !== originalError;

  it("is dormant: no capture, no UI chunk, empty entries, open() does nothing", async () => {
    await mount({ deps: createFakeDeps() });
    expect(window.__proompter?.enabled()).toBe(false);
    await act(async () => window.__proompter?.open());
    await act(async () => window.__proompter?.toggle());
    await wait(150); // past the idle callback that would start capture
    expect(kit()).toBeNull();
    expect(patched()).toBe(false);
    expect(window.__proompter?.entries()).toEqual([]);
  });

  it("enable() starts capture and opens the kit; disable() returns to dormant", async () => {
    await mount({ deps: createFakeDeps() });
    await act(async () => window.__proompter?.enable());
    await until(() => sq(".dock"), "enable() to open the kit");
    expect(localStorage.getItem(KEY)).toBe("1");
    expect(window.__proompter?.enabled()).toBe(true);
    await until(patched, "capture to start");
    await act(async () => window.__proompter?.disable());
    expect(kit()).toBeNull();
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(window.__proompter?.enabled()).toBe(false);
    expect(window.__proompter?.entries()).toEqual([]);
    expect(patched()).toBe(false);
    await act(async () => window.__proompter?.open());
    expect(kit()).toBeNull();
  });

  it("the chord enables a dormant kit, then toggles it", async () => {
    await mount({ deps: createFakeDeps() });
    await chord();
    await until(() => sq(".dock"), "the chord to enable it");
    await chord();
    expect(kit()).toBeNull();
    expect(window.__proompter?.enabled()).toBe(true);
  });

  it("stays enabled across a remount: capture starts, the kit opens on open()", async () => {
    localStorage.setItem(KEY, "1");
    await mount({ deps: createFakeDeps() });
    expect(window.__proompter?.enabled()).toBe(true);
    expect(kit()).toBeNull();
    await until(patched, "capture to start");
    await act(async () => window.__proompter?.open());
    await until(() => sq(".dock"), "open()");
  });

  it("development ignores the key and is always active", async () => {
    vi.stubEnv("NODE_ENV", "development");
    await mount({ deps: createFakeDeps() });
    expect(window.__proompter?.enabled()).toBe(true);
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("development: disable() only closes the kit, enabled() stays true, nothing is stored", async () => {
    vi.stubEnv("NODE_ENV", "development");
    originalError = console.error;
    await mount({ deps: createFakeDeps() });
    await act(async () => window.__proompter?.enable());
    await until(() => sq(".dock"), "enable()");
    await until(patched, "capture to start");
    await act(async () => window.__proompter?.disable());
    expect(kit()).toBeNull();
    expect(window.__proompter?.enabled()).toBe(true);
    expect(patched()).toBe(true);
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("enable, disable, enable: capture runs again at the end", async () => {
    await mount({ deps: createFakeDeps() });
    await act(async () => window.__proompter?.enable());
    await until(patched, "capture to start");
    await act(async () => window.__proompter?.disable());
    expect(patched()).toBe(false);
    await act(async () => window.__proompter?.enable());
    await until(patched, "capture to start again");
  });

  it("two instances: disable() stops both captures", async () => {
    localStorage.setItem(KEY, "1");
    const mod = await import("../core/capture");
    const real = mod.createCapture;
    const running: boolean[] = [];
    vi.spyOn(mod, "createCapture").mockImplementation((o) => {
      const c = real(o);
      const i = running.push(false) - 1;
      return { ...c, enable: () => {
          running[i] = true;
          c.enable();
        },
        disable: () => {
          running[i] = false;
          c.disable();
        },
      };
    });
    await mount({ deps: createFakeDeps() });
    const host2 = document.createElement("div");
    document.body.appendChild(host2);
    const root2 = createRoot(host2);
    await act(async () => root2.render(<Proompter shadowCss="" frameSrc="about:blank" deps={createFakeDeps()} />));
    await until(() => running.length === 2 && running.every(Boolean), "both captures to start");
    await act(async () => window.__proompter?.disable());
    expect(running).toEqual([false, false]);
    await act(async () => window.__proompter?.enable());
    await until(() => running.every(Boolean), "both captures to start again");
    await act(async () => root2.unmount());
    vi.restoreAllMocks();
    host2.remove();
  });

  it("storage that throws does not crash: enable() is active for this page only", async () => {
    const boom = () => {
      throw new Error("denied");
    };
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(boom);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(boom);
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(boom);
    await mount({ deps: createFakeDeps() });
    expect(window.__proompter?.enabled()).toBe(false);
    await act(async () => window.__proompter?.enable());
    await until(() => sq(".dock"), "enable()");
    expect(window.__proompter?.enabled()).toBe(true);
    await act(async () => window.__proompter?.disable());
    expect(window.__proompter?.enabled()).toBe(false);
    vi.restoreAllMocks();
  });
});
