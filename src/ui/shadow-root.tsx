import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { mountFonts, unmountFonts } from "./fonts/fonts";
import compiledStyles from "./styles.css?inline";

export { mountFonts, unmountFonts };

/** Tag name of the element that hosts the shadow root. */
export const HOST_TAG = "proompter-root";

const ShadowContainerContext = createContext<HTMLElement | null>(null);

/**
 * The element inside the shadow root that all UI renders into (`.pp`, which carries the tokens).
 * Pass it as `container` to every Radix portal, so menus and dialogs stay inside the shadow tree.
 * Returns `null` outside a `<ShadowRoot>`.
 */
export function useShadowContainer(): HTMLElement | null {
  return useContext(ShadowContainerContext);
}

export interface ShadowRootProps {
  children?: ReactNode;
  /** Stylesheet text injected into the shadow root. Defaults to the compiled UI CSS. */
  css?: string;
  /**
   * Where to append the host element. Defaults to `document.body`.
   * Pass `null` to wait (nothing mounts until a parent is available).
   */
  parent?: HTMLElement | null;
}

/**
 * Mounts a `<proompter-root>` element, attaches an open shadow root, injects the UI CSS, and renders
 * `children` into it through a portal. Nothing exists in the DOM until this effect runs, and
 * everything is removed on unmount.
 */
export function ShadowRoot({ children, css = compiledStyles, parent }: ShadowRootProps) {
  const [container, setContainer] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const target = parent === undefined ? document.body : parent;
    if (!target) return;
    const host = document.createElement(HOST_TAG);
    const shadow = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = css;
    const root = document.createElement("div");
    root.className = "pp pm-root";
    shadow.append(style, root);
    target.appendChild(host);
    mountFonts(); // the kit's one change to the host document: <style data-proompter-fonts>
    setContainer(root);
    return () => {
      unmountFonts();
      host.remove();
      setContainer(null);
    };
  }, [css, parent]);

  if (!container) return null;
  return (
    <ShadowContainerContext value={container}>{createPortal(children, container)}</ShadowContainerContext>
  );
}
