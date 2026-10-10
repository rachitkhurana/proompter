/**
 * `<Proompter>`: the root component (DESIGN §3). This file is the LIGHT part, the only one in the entry chunk:
 *
 * - Server and first client render: nothing.
 * - Frame mode (`?__proompter_frame=1`): nothing is drawn; it only exposes a capture to the parent kit.
 * - Otherwise it installs `window.__proompter` and the `⌘⇧.` listener, and loads the UI chunk (dock, sheet,
 *   fonts, everything else) with `import()` the first time the kit is opened.
 *
 * Imports here must stay type-only or tiny: the UI lives in `./shell/ui`.
 */
import { lazy, Suspense, useEffect, useState, useSyncExternalStore } from "react";
import type { ProompterApi, ProompterProps } from "./proompter-deps";
import { isToggleChord } from "./shell/chord";
import { createDepsBox } from "./shell/deps-box";

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

const KitUI = lazy(() => import("./shell/ui"));

const noSubscribe = () => () => {};
const inFrame = () => {
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
      const capture = createCapture({ win: window as Window & typeof globalThis, redact, queries });
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
  top.toggle();
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
      document.removeEventListener("keydown", onChord, true);
      delete window.__proompter;
    }
  };
}

function HostMode(props: ProompterProps) {
  const [open, setOpen] = useState(!!props.defaultOpen);
  const [box] = useState(createDepsBox);

  // Nothing global exists until this mounts: no listener, no `window.__proompter`.
  useEffect(() => {
    const api: ProompterApi = {
      open: () => setOpen(true),
      close: () => setOpen(false),
      toggle: () => setOpen((o) => !o),
      entries: () => box.peek()?.store.getSnapshot().entries ?? [],
    };
    return register(api);
  }, [box]);

  // Capture starts once the page is idle, from its own small chunk (not the UI's), and stops on unmount.
  // The UI chunk reuses this instance, so the buffers also cover the time before the first open.
  const { redact, queries } = props;
  useEffect(() => {
    let cancelled = false;
    const cancelIdle = whenIdle(() => {
      void import("../core/capture").then(({ createCapture }) => {
        if (cancelled) return;
        const capture =
          box.getCapture() ??
          box.setCapture(createCapture({ win: window as Window & typeof globalThis, redact, queries }));
        capture.enable();
      });
    });
    return () => {
      cancelled = true;
      cancelIdle();
      box.getCapture()?.disable();
    };
    // Hooks given on the first render are the ones the page keeps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [box]);

  if (!open) return null;
  return (
    <Suspense fallback={null}>
      <KitUI options={props} box={box} onToggleKit={() => setOpen((o) => !o)} />
    </Suspense>
  );
}
