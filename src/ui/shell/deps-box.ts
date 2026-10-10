import type { Capture } from "../../core/capture/types";
import type { ProompterDeps } from "../proompter-deps";

/**
 * Holds what must outlive the UI chunk mounting and unmounting: the kit's dependencies (the store above all)
 * and the host window's capture. Hiding the kit with `⌘⇧.` and showing it again keeps the session and the
 * console and network buffers. The light entry chunk owns one; the lazy UI chunk reads and fills it.
 */
export interface DepsBox {
  /** The deps, created with `make` on first call. */
  get(make: () => ProompterDeps): ProompterDeps;
  /** The deps if they exist yet. */
  peek(): ProompterDeps | undefined;
  /** The host window's capture, if one has been created (by the idle task or by the UI). */
  getCapture(): Capture | undefined;
  setCapture(c: Capture): Capture;
}

export function createDepsBox(): DepsBox {
  let deps: ProompterDeps | undefined;
  let capture: Capture | undefined;
  return {
    get(make) {
      deps ??= make();
      return deps;
    },
    peek: () => deps,
    getCapture: () => capture,
    setCapture: (c) => (capture = c),
  };
}
