import { toSvg } from "html-to-image";
import type { Surface } from "../surface";
import type { SnapshotResult } from "./types.ts";

const PADDING = 12;

/** Typed values are masked by default (D17). Buttons, toggles and pickers hold no typed text. */
const DEFAULT_REDACT =
  'input:not([type="button"],[type="submit"],[type="reset"],[type="checkbox"],[type="radio"],[type="range"],[type="color"]),' +
  'textarea,select,output,[role="textbox"],[role="combobox"],[contenteditable]:not([contenteditable="false"]),' +
  "[data-proompter-redact]";

/** Pure black, whatever the element draws: its box, its text and every descendant (images included). */
const MASK =
  "background:#000!important;color:#000!important;-webkit-text-fill-color:#000!important;border-color:#000!important;" +
  "filter:brightness(0)!important;text-shadow:none!important;box-shadow:none!important";

/** Neutral stand-in drawn over media html-to-image cannot read (see `createFilter`). */
const PLACEHOLDER_BG = "#2a2a2a";
const PLACEHOLDER_FG = "#999";

interface Placeholder {
  x: number;
  y: number;
  w: number;
  h: number;
  label: "video" | "canvas";
}

/** A `<video>` or `<canvas>` html-to-image would call `toDataURL()` on while cloning. */
function isMedia(el: Element): el is HTMLVideoElement | HTMLCanvasElement {
  return el.localName === "canvas" || (el.localName === "video" && !!(el as HTMLVideoElement).currentSrc);
}

/** True when `url` is a network URL on another origin than `doc` (data: and blob: are the page's own). */
function foreign(url: string, doc: Document): boolean {
  try {
    const u = new URL(url, doc.baseURI);
    return /^https?:$/.test(u.protocol) && u.origin !== doc.location.origin;
  } catch {
    return false;
  }
}

/** True when the browser lets us read the pixels of `src` back (it throws a SecurityError when tainted). */
function readable(src: HTMLVideoElement | HTMLCanvasElement): boolean {
  const doc = src.ownerDocument;
  if (src.localName === "canvas") {
    if (!(src as HTMLCanvasElement).width || !(src as HTMLCanvasElement).height) return true; // nothing to read, nothing to taint
  } else {
    const v = src as HTMLVideoElement;
    // No frame yet, so a probe would draw nothing and pass; but html-to-image reads the frame later, once it is there.
    if (v.readyState < 2 && foreign(v.currentSrc, doc) && !v.hasAttribute("crossorigin")) return false;
  }
  try {
    // One pixel of it on a probe canvas, then read that back: a tainted source taints the probe.
    const probe = doc.createElement("canvas");
    probe.width = probe.height = 1;
    probe.getContext("2d")?.drawImage(src, 0, 0, 1, 1);
    probe.toDataURL();
    return true;
  } catch {
    return false;
  }
}

/**
 * The filter html-to-image runs on the ORIGINAL nodes, before it clones them (never on the root, see `takeSnapshot`).
 * It keeps the kit's own UI out of the PNG, and drops a `<video>` or `<canvas>` whose pixels cannot be read (a
 * cross-origin video without CORS, a canvas tainted by a cross-origin image): html-to-image calls `toDataURL()` on
 * them while cloning, which throws a SecurityError and loses the whole picture. The verdict is cached per element;
 * the live page is only read, never changed (D17). `excluded` lists what was dropped, for the placeholders.
 */
function createFilter() {
  const verdicts = new WeakMap<Element, boolean>();
  const excluded = new Set<HTMLElement>();
  /** True when `el` is media we can't read. Remembers it for the placeholders. */
  const unreadable = (el: Element): boolean => {
    if (!isMedia(el)) return false;
    let ok = verdicts.get(el);
    if (ok === undefined) verdicts.set(el, (ok = readable(el)));
    if (!ok) excluded.add(el);
    return !ok;
  };
  const filter = (node: Node): boolean => {
    if (node.nodeType !== 1) return true;
    const el = node as Element;
    // The host is a custom element whose TAG is `proompter-root` (HOST_TAG in src/ui/shadow-root.tsx).
    if (el.localName === "proompter-root" || el.hasAttribute("data-proompter")) return false;
    return !unreadable(el);
  };
  return { filter, excluded, unreadable };
}

/**
 * Where the dropped media sat, in image pixels, for the part of the page that was captured: `region` is its box in
 * viewport coordinates and `pad` the margin around it. Media that isn't painted (hidden, or at opacity 0 itself or
 * under an ancestor that is) is skipped, each rect is clipped to every ancestor that clips its overflow, and what is
 * outside the region or has nothing left is left out.
 */
function placeholders(excluded: Set<HTMLElement>, region: { left: number; top: number; width: number; height: number }, pad: number): Placeholder[] {
  const out: Placeholder[] = [];
  for (const el of excluded) {
    const view = el.ownerDocument.defaultView ?? window;
    if (view.getComputedStyle(el).visibility === "hidden") continue;
    const r = el.getBoundingClientRect();
    let [l, t, rt, b] = [r.left, r.top, r.left + r.width, r.top + r.height];
    let shown = true;
    for (let p: Element | null = el; p && shown; p = p.parentElement) {
      const cs = view.getComputedStyle(p);
      if (parseFloat(cs.opacity) === 0) shown = false;
      else if (p !== el && (cs.overflowX !== "visible" || cs.overflowY !== "visible")) {
        const c = p.getBoundingClientRect();
        [l, t, rt, b] = [Math.max(l, c.left), Math.max(t, c.top), Math.min(rt, c.right), Math.min(b, c.bottom)];
      }
    }
    // Into the region, whose image is `width + 2 * pad` wide.
    l = Math.max(l, region.left - pad);
    t = Math.max(t, region.top - pad);
    rt = Math.min(rt, region.left + region.width + pad);
    b = Math.min(b, region.top + region.height + pad);
    if (!shown || rt <= l || b <= t) continue;
    out.push({ x: l - region.left + pad, y: t - region.top + pad, w: rt - l, h: b - t, label: el.localName === "canvas" ? "canvas" : "video" });
  }
  return out;
}

/**
 * Blacks out the matching elements INSIDE the rendered clone (D17), so the mask goes wherever html-to-image laid
 * the element out, not where we guess it is. Takes and returns an SVG data URL. Throws on anything unexpected.
 */
export function maskSvg(svgUrl: string, extra: readonly string[]): string {
  const svg = new DOMParser().parseFromString(decodeURIComponent(svgUrl.slice(svgUrl.indexOf(",") + 1)), "image/svg+xml");
  if (svg.getElementsByTagName("parsererror").length) throw new Error("snapshot SVG did not parse");
  const sel = [DEFAULT_REDACT, ...(extra.length ? [extra.join(",")] : [])].join(",");
  svg.querySelectorAll(sel).forEach((el) => {
    el.setAttribute("style", `${el.getAttribute("style") ?? ""};${MASK}`);
    if (/^(input|textarea|select)$/.test(el.localName)) {
      el.removeAttribute("value");
      if (el.localName !== "input") el.textContent = "";
    }
  });
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(svg))}`;
}

/** What html-to-image's `toCanvas` does with the SVG, then a PNG. */
async function svgToPng(svgUrl: string, width: number, height: number, holes: readonly Placeholder[] = []): Promise<string> {
  const img = new Image();
  img.src = svgUrl;
  await img.decode();
  await new Promise((r) => requestAnimationFrame(r)); // Safari draws a blank image without a frame in between
  const ratio = window.devicePixelRatio || 1;
  const canvas = document.createElement("canvas");
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d canvas");
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  for (const h of holes) {
    ctx.fillStyle = PLACEHOLDER_BG;
    ctx.fillRect(h.x * ratio, h.y * ratio, h.w * ratio, h.h * ratio);
    ctx.fillStyle = PLACEHOLDER_FG;
    ctx.font = `${12 * ratio}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(h.label, (h.x + h.w / 2) * ratio, (h.y + h.h / 2) * ratio, h.w * ratio);
  }
  return canvas.toDataURL("image/png");
}

/**
 * Element crop (with padding) + visible viewport, as PNG data URLs, from the surface's own document.
 * Never throws. If rendering fails and a retry with font embedding skipped succeeds (typically font
 * CSS blocked by CORS), it reports `fontsEmbedded: false`. If the retry fails too, the failure is not
 * font related: it is reported as `error` and `fontsEmbedded` stays true.
 * Typed values and marked elements are blacked out inside each render (D17); if that fails the PNG is dropped and
 * `redactFailed` is set. A `<video>` or `<canvas>` the browser won't let us read is left out of the clone and a grey
 * placeholder is drawn at its place on the PNG. Its box is removed from the clone, so where its container has no
 * fixed size the layout around it may collapse; the placeholder sits at the live position regardless.
 */
export async function takeSnapshot(
  surface: Surface,
  el: Element | undefined,
  onError: (where: string, e: unknown) => void,
  redact: readonly string[] = [],
): Promise<SnapshotResult> {
  const result: SnapshotResult = { fontsEmbedded: true };
  const { filter, excluded, unreadable } = createFilter();

  const render = async (node: HTMLElement, opts: NonNullable<Parameters<typeof toSvg>[1]>): Promise<string> => {
    const o = { ...opts, filter };
    if (!result.fontsEmbedded) return toSvg(node, { ...o, skipFonts: true });
    try {
      return await toSvg(node, o);
    } catch (e) {
      const svg = await toSvg(node, { ...o, skipFonts: true }); // throws again if not font related
      result.fontsEmbedded = false;
      onError("snapshot:fonts", e);
      return svg;
    }
  };

  /** Fail closed: if the mask or the drawing fails, there is no picture. */
  const finish = async (svg: string, width: number, height: number, holes: Placeholder[]): Promise<string | undefined> => {
    try {
      return await svgToPng(maskSvg(svg, redact), width, height, holes);
    } catch (e) {
      onError("snapshot:redact", e);
      result.redactFailed = true;
      return undefined;
    }
  };

  try {
    const { doc, win } = surface;
    if (el) {
      try {
        const rect = el.getBoundingClientRect();
        const width = Math.ceil(rect.width) + PADDING * 2;
        const height = Math.ceil(rect.height) + PADDING * 2;
        // html-to-image doesn't filter the root, so a picked video or canvas we can't read is never rendered: just its placeholder.
        const svg = unreadable(el)
          ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"/>`)}`
          : // The clone keeps the live box size (html-to-image would stretch it to the image), so layout stays put.
            await render(el as HTMLElement, {
              width,
              height,
              style: { width: `${rect.width}px`, height: `${rect.height}px`, boxSizing: "border-box", margin: `${PADDING}px` },
              cacheBust: false,
            });
        result.element = await finish(svg, width, height, placeholders(excluded, rect, PADDING));
      } catch (e) {
        onError("snapshot:element", e);
        result.error = result.elementError = e instanceof Error ? e.message : String(e);
      }
    }
    try {
      const svg = await render(doc.documentElement, {
        width: win.innerWidth,
        height: win.innerHeight,
        style: { transform: `translate(${-win.scrollX}px, ${-win.scrollY}px)`, transformOrigin: "top left" },
        cacheBust: false,
      });
      result.viewport = await finish(
        svg,
        win.innerWidth,
        win.innerHeight,
        placeholders(excluded, { left: 0, top: 0, width: win.innerWidth, height: win.innerHeight }, 0),
      );
    } catch (e) {
      onError("snapshot:viewport", e);
      result.error = e instanceof Error ? e.message : String(e);
    }
  } catch (e) {
    onError("snapshot", e);
    result.error = e instanceof Error ? e.message : String(e);
  }
  return result;
}
