/**
 * Tiny helpers shared by the light entry chunk (which toggles the kit) and the lazy UI chunk.
 * No imports from the rest of the kit, so this costs nothing in the entry chunk.
 */

/** `⌘⇧.` (Ctrl+Shift+. elsewhere): show or hide the kit. Layout-proof: `.` is `>` while Shift is held. */
export function isToggleChord(ev: KeyboardEvent): boolean {
  if (!(ev.metaKey || ev.ctrlKey) || !ev.shiftKey || ev.altKey) return false;
  return ev.code === "Period" || ev.key === "." || ev.key === ">";
}
