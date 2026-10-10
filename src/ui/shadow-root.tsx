import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { mountFonts, unmountFonts } from "./fonts/fonts";
import compiledStyles from "./styles.css?inline";

export { mountFonts, unmountFonts };

/** Tag name of the element that hosts the shadow root. */
export const HOST_TAG = "proompter-root";

/** Interaction events that must not reach the host page's listeners once they leave our shadow root. */
const SEALED = ["pointerdown", "pointerup", "mousedown", "mouseup", "click", "touchstart", "touchend", "touchmove", "wheel", "focusin", "focusout"];

/** An app modal: the focus trap of these is what the kit must not trip. */
const MODAL = '[aria-modal="true"],[role="dialog"],[role="alertdialog"]';

const shielded = new WeakSet<Event>();

/** True when `ev` was default-prevented only by the shield (an Esc inside the kit), not by a handler of ours. */
export function isShielded(ev: Event): boolean {
  return shielded.has(ev);
}

/**
 * Keep the host app's modal machinery (Radix, Headless UI...) from treating the kit as "outside" (D11).
 * - Our interaction events stop at the host element, so document-level outside-click, focus-outside and
 *   scroll-lock listeners never see them. Our own document listeners are capture-phase or keydown, so they still run.
 * - Focus leaving an app dialog (`aria-modal` or `role="dialog"`) for the kit: its focusout is stopped, so a focus trap doesn't pull focus back.
 * - Esc inside the kit is default-prevented before the app's capture listeners, which skip handled events.
 * - A modal's `aria-hidden` on its siblings is taken off the host, so the kit stays visible to assistive tech.
 */
function shield(host: HTMLElement): () => void {
  const stop = (e: Event) => e.stopPropagation();
  const focusOut = (e: Event) => {
    const { target, relatedTarget } = e as FocusEvent;
    if (relatedTarget !== host || target === host || !(target instanceof Element)) return;
    // Only an app modal's focus trap needs this; plain app inputs keep their blur handlers. Radix dialogs carry
    // role="dialog" without aria-modal (they hide siblings with aria-hidden instead), so match both.
    if (target.closest(MODAL)) e.stopPropagation();
  };
  const key = (e: Event) => {
    const ev = e as KeyboardEvent;
    if (ev.key !== "Escape" || ev.defaultPrevented || !ev.composedPath().includes(host)) return;
    shielded.add(ev);
    ev.preventDefault();
  };
  for (const t of SEALED) host.addEventListener(t, stop, { passive: true });
  window.addEventListener("focusout", focusOut, true);
  window.addEventListener("keydown", key, true);
  const unhide = new MutationObserver(() => host.removeAttribute("aria-hidden"));
  unhide.observe(host, { attributes: true, attributeFilter: ["aria-hidden"] });
  return () => {
    unhide.disconnect();
    for (const t of SEALED) host.removeEventListener(t, stop);
    window.removeEventListener("focusout", focusOut, true);
    window.removeEventListener("keydown", key, true);
  };
}

const ShadowContainerContext = createContext<HTMLElement | null>(null);

/**
 * The element inside the shadow root that all UI renders into (`.pp`, which carries the tokens).
 * Portal into it (`createPortal`), so menus and tooltips stay inside the shadow tree.
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
    const unshield = shield(host);
    setContainer(root);
    return () => {
      unshield();
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
