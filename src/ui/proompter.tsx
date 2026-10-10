/**
 * `<Proompter>`: the root component (DESIGN §3). This file is the LIGHT part, the only one in the entry chunk:
 *
 * - Server and first client render: nothing.
 * - Frame mode (`?__proompter_frame=1`): nothing is drawn; it only exposes a capture to the parent kit.
 * - Otherwise it installs `window.__proompter` and the `⌘⇧.` listener, and loads the UI chunk (dock, sheet,
 *   fonts, everything else) with `import()` the first time the kit is opened.
 * - Outside development (a deployed preview, D15) the kit is dormant until `enable()` or the chord: no capture,
 *   no UI chunk. The choice persists in `localStorage["proompter:enabled"]`.
 *
 * Imports here must stay type-only or tiny: the UI lives in `./shell/ui`.
 */
import { lazy, Suspense, useEffect, useState, useSyncExternalStore } from "react";
import type { DepsBox, ProompterApi, ProompterProps } from "./proompter-deps";
import { isToggleChord } from "./shell/chord";

export type {
  ComposerSlot,
  ComposerSlotProps,
  EntryPatch,
  EntryStore,
  PendingFile,
  ProompterApi,
  ProompterDeps,
  ProompterProps,
  Serialize,
  StoreState,
} from "./proompter-deps";

/** Same name as `FRAME_PARAM` in core/surface; repeated here to keep that module out of the entry chunk. */
const FRAME_PARAM = "__proompter_frame";

const ENABLED_KEY = "proompter:enabled";
const isDev = () => process.env.NODE_ENV === "development";
const stored = () => {
  try {
    return localStorage.getItem(ENABLED_KEY) === "1";
  } catch {
    return false;
  }
};

// One active flag for every mounted <Proompter> (D15). The stored key decides on load; `override` is what
// enable()/disable() decided since, so it also holds when storage throws. Development is always active.
let override: boolean | null = null;
const listeners = new Set<() => void>();
const isActive = () => isDev() || (override ?? stored());
const subscribeActive = (cb: () => void) => {
  listeners.add(cb);
  return () => void listeners.delete(cb);
};
function setActiveFlag(v: boolean) {
  override = v;
  try {
    if (v) localStorage.setItem(ENABLED_KEY, "1");
    else localStorage.removeItem(ENABLED_KEY);
  } catch {
    /* private mode: the choice lasts for this page only */
  }
  listeners.forEach((l) => l());
}

const KitUI = lazy(() => import("./shell/ui"));

const noSubscribe = () => () => {};
/** True inside a Proompter device viewport frame (`?__proompter_frame`); false on the host page and on the server. */
export const inFrame = () => {
  try {
    return new URLSearchParams(window.location.search).has(FRAME_PARAM);
  } catch {
    return false;
  }
};

export function Proompter(props: ProompterProps) {
  // The server (and hydration) assume "frame", so they render nothing; the client re-renders with the truth.
  const frame = useSyncExternalStore(noSubscribe, inFrame, () => true);
  return frame ? <FrameMode redact={props.redact} queries={props.queries} /> : <HostMode {...props} />;
}

/** Inside a device frame: draw nothing, but record console and network from page load for the parent kit. */
function FrameMode({ redact, queries }: Pick<ProompterProps, "redact" | "queries">): null {
  useEffect(() => {
    if (!inFrame()) return; // hydrating on the host page: the server snapshot said "frame" for one render
    let cancelled = false;
    let off: (() => void) | undefined;
    void import("../core/capture").then(({ createCapture }) => {
      if (cancelled) return;
      const capture = createCapture({ win: window, redact, queries });
      capture.enable();
      window.__proompter_capture = capture;
      off = () => {
        capture.disable();
        if (window.__proompter_capture === capture) delete window.__proompter_capture;
      };
    });
    return () => {
      cancelled = true;
      off?.();
    };
    // Hooks given on the first render are the ones the page keeps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

/** Run `cb` when the browser is idle (a short timeout where `requestIdleCallback` is missing). */
function whenIdle(cb: () => void): () => void {
  if (typeof requestIdleCallback === "function") {
    const id = requestIdleCallback(cb, { timeout: 2000 });
    return () => cancelIdleCallback(id);
  }
  const id = setTimeout(cb, 50);
  return () => clearTimeout(id);
}

// Several <Proompter> can be mounted (a layout and a page, StrictMode's double mount): the `⌘⇧.` listener is
// installed once per window, drives the newest instance, and `window.__proompter` always points at a live one.
const live: ProompterApi[] = [];
const onChord = (ev: KeyboardEvent) => {
  if (ev.defaultPrevented || !isToggleChord(ev)) return;
  const top = live[live.length - 1];
  if (!top) return;
  ev.preventDefault();
  if (top.enabled()) top.toggle();
  else top.enable();
};

function register(api: ProompterApi): () => void {
  live.push(api);
  if (live.length === 1) document.addEventListener("keydown", onChord, true);
  window.__proompter = api;
  return () => {
    const i = live.indexOf(api);
    if (i >= 0) live.splice(i, 1);
    const top = live[live.length - 1];
    if (top) window.__proompter = top;
    else {
      override = null;
      document.removeEventListener("keydown", onChord, true);
      delete window.__proompter;
    }
  };
}

function HostMode(props: ProompterProps) {
  const [open, setOpen] = useState(!!props.defaultOpen);
  const [box] = useState<DepsBox>(() => ({}));
  const active = useSyncExternalStore(subscribeActive, isActive, () => false);

  // Nothing global exists until this mounts: no listener, no `window.__proompter`.
  useEffect(() => {
    const api: ProompterApi = {
      open: () => isActive() && setOpen(true),
      close: () => setOpen(false),
      toggle: () => isActive() && setOpen((o) => !o),
      entries: () => (isActive() ? (box.deps?.store.getSnapshot().entries ?? []) : []),
      enable: () => {
        if (!isDev()) setActiveFlag(true);
        setOpen(true);
      },
      disable: () => {
        if (!isDev()) setActiveFlag(false);
        setOpen(false);
      },
      enabled: isActive,
    };
    return register(api);
  }, [box]);

  // Capture starts once the page is idle, from its own small chunk (not the UI's), and stops on unmount.
  // The UI chunk reuses this instance, so the buffers also cover the time before the first open.
  const { redact, queries } = props;
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const cancelIdle = whenIdle(() => {
      void import("../core/capture").then(({ createCapture }) => {
        if (cancelled) return;
        (box.capture ??= createCapture({ win: window, redact, queries })).enable();
      });
    });
    return () => {
      cancelled = true;
      cancelIdle();
      box.capture?.disable();
    };
    // Hooks given on the first render are the ones the page keeps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [box, active]);

  if (!open || !active) return null;
  return (
    <Suspense fallback={null}>
      <KitUI options={props} box={box} onToggleKit={() => setOpen((o) => !o)} />
    </Suspense>
  );
}
