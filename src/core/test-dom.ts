/** Shared helpers for the core tests (happy-dom has no layout, so rects are stubbed). */

export function setRect(el: Element, left: number, top: number, width: number, height: number): void {
  const rect = {
    x: left,
    y: top,
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({}),
  };
  (el as { getBoundingClientRect: () => DOMRect }).getBoundingClientRect = () => rect as DOMRect;
}

/** Give every element under `root` a 100x40 box unless it already has one. */
export function boxAll(root: Element, w = 100, h = 40): void {
  root.querySelectorAll("*").forEach((el, i) => {
    if (!Object.prototype.hasOwnProperty.call(el, "getBoundingClientRect")) setRect(el, 0, i * 10, w, h);
  });
}

export function html(markup: string): HTMLElement {
  document.body.innerHTML = markup;
  return document.body;
}
