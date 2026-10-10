/**
 * Keyboard focus and the viewport iframe. After a click inside a device frame the frame owns focus, and a
 * browser delivers keys to the focused document only. The kit forwards the keys it can see from the frame
 * (PickEngine `forwardKey`), but the dependable fix is to keep focus on the host document whenever the kit
 * takes over (a new entry draft, or a save/discard), so every shortcut works exactly as on the live page.
 */

/** If a device frame holds focus, hand it back to the host document. */
export function returnFocusFromFrame(): void {
  const active = document.activeElement;
  if (active?.tagName !== "IFRAME") return;
  (active as HTMLElement).blur();
  try {
    window.focus();
  } catch {
    /* some embedders refuse; blur already moved focus to the body */
  }
}
