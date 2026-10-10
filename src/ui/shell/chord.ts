/**
 * Tiny helpers shared by the light entry chunk (which toggles the kit) and the lazy UI chunk.
 * No imports from the rest of the kit, so this costs nothing in the entry chunk.
 */

/** `⌘⇧.` (Ctrl+Shift+. elsewhere): show or hide the kit. Layout-proof: `.` is `>` while Shift is held. */
export function isToggleChord(ev: KeyboardEvent): boolean {
  if (!(ev.metaKey || ev.ctrlKey) || !ev.shiftKey || ev.altKey) return false;
  return ev.code === "Period" || ev.key === "." || ev.key === ">";
}

const TYPING = "input,textarea,select,[contenteditable]";

/** The element a key event was aimed at, looking through shadow retargeting. */
function eventTarget(ev: Event): Element | null {
  const first = typeof ev.composedPath === "function" ? ev.composedPath()[0] : undefined;
  const node = (first as Node | undefined) ?? (ev.target as Node | null);
  if (!node) return null;
  return node.nodeType === 1 ? (node as Element) : node.parentElement;
}

/** True when the key was typed into a text field (letter shortcuts must stay out of its way). */
export function isTypingTarget(ev: Event): boolean {
  const el = eventTarget(ev);
  return !!el && !!el.closest(TYPING);
}
