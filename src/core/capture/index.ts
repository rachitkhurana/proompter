import { createConsolePatches } from "./console.ts";
import { createFetchPatch, createXhrPatches } from "./network.ts";
import type { Patch } from "./patch.ts";
import { redactConsoleEntry, redactNetworkEntry } from "./redact.ts";
import { takeSnapshot } from "./snapshot.ts";
import type {
  Capture,
  CaptureConsoleEntry,
  CaptureContext,
  CaptureEntry,
  CaptureInternalError,
  CaptureNetworkEntry,
  CaptureOptions,
  CaptureQuery,
} from "./types.ts";

const RING_CAP = 50;

/** Keeps the last `RING_CAP` items. */
function createRing<T>() {
  const items: T[] = [];
  return {
    push(item: T): void {
      items.push(item);
      if (items.length > RING_CAP) items.splice(0, items.length - RING_CAP);
    },
    toArray: (): T[] => items.slice(),
  };
}

/**
 * Creates a capture bound to one window (use `surface.win` for frame mode). Nothing is patched until
 * `enable()`; `disable()` restores what we patched without clobbering later host patches.
 */
export function createCapture(opts: CaptureOptions): Capture {
  const { win } = opts;
  const consoleRing = createRing<CaptureConsoleEntry>();
  const networkRing = createRing<CaptureNetworkEntry>();
  const errorRing = createRing<CaptureInternalError>();
  let patches: Patch[] | null = null;
  let enabled = false;

  const fail = (where: string, e: unknown): void => {
    errorRing.push({ timestamp: Date.now(), where, message: e instanceof Error ? e.message : String(e) });
  };

  const applyHook = <T extends CaptureEntry>(entry: T): T | null => {
    if (!opts.redact) return entry;
    try {
      return (opts.redact(entry) as T | null | undefined) ?? null;
    } catch (e) {
      fail("redact-hook", e);
      return null; // fail closed: an entry the hook choked on is not stored
    }
  };

  const consoleSink = {
    fail,
    push(entry: CaptureConsoleEntry) {
      const out = applyHook(redactConsoleEntry(entry));
      if (out) consoleRing.push(out);
    },
  };
  const networkSink = {
    fail,
    push(entry: CaptureNetworkEntry) {
      const out = applyHook(redactNetworkEntry(entry));
      if (out) networkRing.push(out);
    },
  };

  const build = (): Patch[] => [
    ...createConsolePatches(win, consoleSink),
    createFetchPatch(win, networkSink),
    ...createXhrPatches(win, networkSink),
  ];

  return {
    enable() {
      if (enabled) return;
      try {
        patches ??= build();
        for (const p of patches) p.enable();
        enabled = true;
      } catch (e) {
        fail("enable", e);
      }
    },
    disable() {
      if (!enabled) return;
      enabled = false;
      for (const p of patches ?? []) {
        try {
          p.disable();
        } catch (e) {
          fail("disable", e);
        }
      }
    },
    context(): CaptureContext {
      let queries: CaptureQuery[] = [];
      try {
        queries = opts.queries ? opts.queries().map((q) => ({ key: q.key, status: q.status, updatedAt: q.updatedAt })) : [];
      } catch (e) {
        fail("queries", e);
      }
      return {
        console: consoleRing.toArray(),
        network: networkRing.toArray(),
        queries,
        internalErrors: errorRing.toArray(),
      };
    },
    snapshot: (surface, el, redact) => takeSnapshot(surface, el, fail, redact),
  };
}
