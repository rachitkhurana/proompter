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

/** Keeps the kit's own UI out of the PNG. */
function snapshotFilter(node: Node): boolean {
  if (node.nodeType !== 1) return true;
  const el = node as Element;
  // The host is a custom element whose TAG is `proompter-root` (HOST_TAG in src/ui/shadow-root.tsx).
  return el.localName !== "proompter-root" && !el.hasAttribute("data-proompter");
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
async function svgToPng(svgUrl: string, width: number, height: number): Promise<string> {
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
  return canvas.toDataURL("image/png");
}

/**
 * Element crop (with padding) + visible viewport, as PNG data URLs, from the surface's own document.
 * Never throws. If rendering fails and a retry with font embedding skipped succeeds (typically font
 * CSS blocked by CORS), it reports `fontsEmbedded: false`. If the retry fails too, the failure is not
 * font related: it is reported as `error` and `fontsEmbedded` stays true.
 * Typed values and marked elements are blacked out inside each render (D17); if that fails the PNG is dropped and
 * `redactFailed` is set.
 */
export async function takeSnapshot(
  surface: Surface,
  el: Element | undefined,
  onError: (where: string, e: unknown) => void,
  redact: readonly string[] = [],
): Promise<SnapshotResult> {
  const result: SnapshotResult = { fontsEmbedded: true };

  const render = async (node: HTMLElement, opts: NonNullable<Parameters<typeof toSvg>[1]>): Promise<string> => {
    const o = { ...opts, filter: snapshotFilter };
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
  const finish = async (svg: string, width: number, height: number): Promise<string | undefined> => {
    try {
      return await svgToPng(maskSvg(svg, redact), width, height);
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
        // The clone keeps the live box size (html-to-image would stretch it to the image), so layout stays put.
        const svg = await render(el as HTMLElement, {
          width,
          height,
          style: { width: `${rect.width}px`, height: `${rect.height}px`, boxSizing: "border-box", margin: `${PADDING}px` },
          cacheBust: false,
        });
        result.element = await finish(svg, width, height);
      } catch (e) {
        onError("snapshot:element", e);
        result.error = e instanceof Error ? e.message : String(e);
      }
    }
    try {
      const svg = await render(doc.documentElement, {
        width: win.innerWidth,
        height: win.innerHeight,
        style: { transform: `translate(${-win.scrollX}px, ${-win.scrollY}px)`, transformOrigin: "top left" },
        cacheBust: false,
      });
      result.viewport = await finish(svg, win.innerWidth, win.innerHeight);
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
