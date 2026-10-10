import { GEIST_MONO_WOFF2_BASE64, GEIST_SANS_WOFF2_BASE64 } from "./fonts-data";

/** The one tag Proompter adds to the host document (DESIGN D2.2). */
export const FONTS_STYLE_ATTR = "data-proompter-fonts";

function face(family: string, base64: string): string {
  if (!base64) return "";
  return (
    `@font-face{font-family:"${family}";font-style:normal;font-weight:100 900;font-display:swap;` +
    `src:url(data:font/woff2;base64,${base64}) format("woff2")}`
  );
}

/** The `@font-face` CSS for "Proompter Sans" and "Proompter Mono". Empty until the fonts are generated. */
export function fontsCss(): string {
  return face("Proompter Sans", GEIST_SANS_WOFF2_BASE64) + face("Proompter Mono", GEIST_MONO_WOFF2_BASE64);
}

// Reference-counted, so several mounts (or React StrictMode's double effect) share one tag.
let mounts = 0;

/**
 * Inject `<style data-proompter-fonts>` into `document.head`. `@font-face` rules inside a shadow root
 * don't register, so this is the one change the kit makes to the host document. The families are
 * namespaced, so they never collide with a host that loads Geist itself.
 */
export function mountFonts(): void {
  mounts++;
  if (document.head.querySelector(`style[${FONTS_STYLE_ATTR}]`)) return;
  const css = fontsCss();
  if (!css) return;
  const style = document.createElement("style");
  style.setAttribute(FONTS_STYLE_ATTR, "");
  style.textContent = css;
  document.head.appendChild(style);
}

/** Remove the tag once the last `mountFonts()` caller has gone. */
export function unmountFonts(): void {
  mounts = Math.max(0, mounts - 1);
  if (mounts > 0) return;
  document.head.querySelector(`style[${FONTS_STYLE_ATTR}]`)?.remove();
}
