/**
 * Where the composer goes (prototype `placeComp`): anchored to the target, growing out of it, kept inside the
 * window and clear of the dock. Pure, so it is unit-tested.
 */
export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Placement {
  left: number;
  top: number;
  /** CSS `transform-origin` pieces: the panel scales in from the target's side. */
  ox: string;
  oy: string;
}

/** Window margin, px. */
export const MARGIN = 12;
/** Gap between the target and the panel, px. */
export const GAP = 10;

export function placeComposer(args: {
  /** The target on screen, or null (page note): the panel sits centred, 16% down. */
  anchor: Box | null;
  panel: { width: number; height: number };
  viewport: { width: number; height: number };
  /** The dock's rect, if there is one. */
  dock: Box | null;
}): Placement {
  const { anchor: r, panel, viewport, dock } = args;
  const pw = panel.width;
  const ph = panel.height;
  const m = MARGIN;
  let left: number;
  let top: number;
  let ox = "50%";
  let oy = "0";
  if (!r) {
    left = (viewport.width - pw) / 2;
    top = Math.max(m, viewport.height * 0.16);
  } else {
    const rBottom = r.top + r.height;
    left = Math.min(Math.max(m, r.left), viewport.width - pw - m);
    top = rBottom + GAP;
    if (top + ph > viewport.height - m) {
      top = r.top - ph - GAP;
      oy = "100%";
    }
    if (top < m) {
      top = Math.max(m, Math.min(viewport.height - ph - m, r.top + 24));
      oy = "0";
    }
    ox = `${Math.min(Math.max(16, r.left + Math.min(r.width, 40) / 2 - left), pw - 16)}px`;
  }
  // Keep clear of the dock.
  if (dock) {
    const dRight = dock.left + dock.width;
    const dBottom = dock.top + dock.height;
    if (top < dBottom && top + ph > dock.top && left < dRight && left + pw > dock.left) {
      top = Math.max(m, dock.top - ph - m);
    }
  }
  return { left, top, ox, oy };
}

/** Smallest box containing all of `boxes`; null for none. */
export function unionBox(boxes: readonly Box[]): Box | null {
  if (boxes.length === 0) return null;
  let l = Infinity;
  let t = Infinity;
  let r = -Infinity;
  let b = -Infinity;
  for (const x of boxes) {
    l = Math.min(l, x.left);
    t = Math.min(t, x.top);
    r = Math.max(r, x.left + x.width);
    b = Math.max(b, x.top + x.height);
  }
  return { left: l, top: t, width: r - l, height: b - t };
}
