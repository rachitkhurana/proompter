import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ShadowRoot } from "./shadow-root";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Radix leans on a few layout/pointer APIs that happy-dom leaves out.
const proto = Element.prototype as unknown as Record<string, unknown>;
proto.scrollIntoView ??= () => {};
proto.hasPointerCapture ??= () => false;
proto.setPointerCapture ??= () => {};
proto.releasePointerCapture ??= () => {};
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

export interface Mounted {
  root: Root;
  /** The shadow root created by `<ShadowRoot>`, once mounted. */
  shadow: () => NonNullable<Element["shadowRoot"]>;
  unmount: () => Promise<void>;
}

/**
 * Render `ui` inside a `<ShadowRoot>` in a fresh div on `document.body`.
 * Pass `css: ""` to skip the stylesheet: happy-dom would otherwise report CSS animations that never
 * fire `animationend`, and Radix's Presence would wait on them forever.
 */
export async function mountInShadow(ui: ReactNode, options: { css?: string } = {}): Promise<Mounted> {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root = createRoot(el);
  await act(async () => {
    root.render(<ShadowRoot css={options.css}>{ui}</ShadowRoot>);
  });
  return {
    root,
    shadow: () => {
      const host = document.querySelector("proompter-root");
      if (!host?.shadowRoot) throw new Error("no shadow root mounted");
      return host.shadowRoot;
    },
    unmount: async () => {
      await act(async () => root.unmount());
      el.remove();
    },
  };
}
