/**
 * Keyboard focus and the viewport iframe. After a click inside a device frame the frame owns focus, and a
 * browser delivers keys to the focused document only. The kit forwards the keys it can see from the frame
 * (PickEngine `forwardKey`), but the dependable fix is to keep focus on the host document whenever the kit
 * takes over (a new entry draft, or a save/discard), so every shortcut works exactly as on the live page.
 */

/** If a device frame holds focus, hand it back to the host document. Returns true when it moved focus. */
export function returnFocusFromFrame(doc: Document = document): boolean {
  const active = doc.activeElement;
  const isFrame = !!active && active.tagName === "IFRAME";
  if (!isFrame) return false;
  (active as HTMLElement).blur();
  try {
    doc.defaultView?.focus();
  } catch {
    /* some embedders refuse; blur already moved focus to the body */
  }
  return true;
}
