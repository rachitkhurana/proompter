/** True when the user asked the OS for reduced motion. */
export function reducedMotion(): boolean {
  try {
    return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/** `n` kept within [lo, hi]; when the range is inverted (no room) `lo` wins. */
export const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), Math.max(lo, hi));
