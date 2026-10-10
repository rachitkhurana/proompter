import { toPng } from "html-to-image";
import type { Surface } from "../surface";
import type { SnapshotResult } from "./types.ts";

const PADDING = 12;

/** Keeps the kit's own UI out of the PNG. */
function snapshotFilter(node: Node): boolean {
  if (node.nodeType !== 1) return true;
  const el = node as Element;
  // The host is a custom element whose TAG is `proompter-root` (HOST_TAG in src/ui/shadow-root.tsx).
  return el.localName !== "proompter-root" && !el.hasAttribute("data-proompter");
}

/**
 * Element crop (with padding) + visible viewport, as PNG data URLs, from the surface's own document.
 * Never throws. If rendering fails and a retry with font embedding skipped succeeds (typically font
 * CSS blocked by CORS), it reports `fontsEmbedded: false`. If the retry fails too, the failure is not
 * font related: it is reported as `error` and `fontsEmbedded` stays true.
 */
export async function takeSnapshot(
  surface: Surface,
  el: Element | undefined,
  onError: (where: string, e: unknown) => void,
): Promise<SnapshotResult> {
  const result: SnapshotResult = { fontsEmbedded: true };

  const render = async (node: HTMLElement, opts: NonNullable<Parameters<typeof toPng>[1]>): Promise<string> => {
    const o = { ...opts, filter: snapshotFilter };
    if (!result.fontsEmbedded) return toPng(node, { ...o, skipFonts: true });
    try {
      return await toPng(node, o);
    } catch (e) {
      const png = await toPng(node, { ...o, skipFonts: true }); // throws again if not font related
      result.fontsEmbedded = false;
      onError("snapshot:fonts", e);
      return png;
    }
  };

  try {
    const { doc, win } = surface;
    if (el) {
      try {
        const rect = el.getBoundingClientRect();
        result.element = await render(el as HTMLElement, {
          width: Math.ceil(rect.width) + PADDING * 2,
          height: Math.ceil(rect.height) + PADDING * 2,
          style: { margin: `${PADDING}px` },
          cacheBust: false,
        });
      } catch (e) {
        onError("snapshot:element", e);
        result.error = e instanceof Error ? e.message : String(e);
      }
    }
    try {
      result.viewport = await render(doc.documentElement, {
        width: win.innerWidth,
        height: win.innerHeight,
        style: { transform: `translate(${-win.scrollX}px, ${-win.scrollY}px)`, transformOrigin: "top left" },
        cacheBust: false,
      });
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
