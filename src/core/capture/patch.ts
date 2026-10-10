/** Wrapper state; `on` false means the wrapper just passes calls through. */
export interface PatchState {
  on: boolean;
}

type AnyFn = (...args: never[]) => unknown;

export interface Patch {
  enable(): void;
  disable(): void;
}

/**
 * Patches `owner[key]` with `make(orig, state)`.
 *
 * disable() restores the original only if our wrapper is still the current value. If the host
 * wrapped it after us, we leave the host's wrapper in place and flip our wrapper to pass-through,
 * so nothing is clobbered. enable() after that just flips the flag back on. Both are idempotent.
 */
export function createPatch(
  owner: object | undefined,
  key: string,
  make: (orig: AnyFn, state: PatchState) => AnyFn,
): Patch {
  let cur: { state: PatchState; wrapper: AnyFn; orig: AnyFn } | null = null;
  const o = owner as Record<string, unknown> | undefined;
  return {
    enable() {
      if (!o) return;
      if (cur) {
        cur.state.on = true;
        return;
      }
      const orig = o[key];
      if (typeof orig !== "function") return;
      const state: PatchState = { on: true };
      const wrapper = make(orig as AnyFn, state);
      o[key] = wrapper;
      cur = { state, wrapper, orig: orig as AnyFn };
    },
    disable() {
      if (!o || !cur) return;
      cur.state.on = false;
      if (o[key] === cur.wrapper) {
        o[key] = cur.orig;
        cur = null;
      }
    },
  };
}
