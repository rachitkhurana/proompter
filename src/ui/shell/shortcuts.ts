/**
 * Global shortcuts and the Esc order (DESIGN §7), as a pure function over a state snapshot and a set of
 * actions, so it can be unit-tested without mounting anything. The root wires it to `document` keydown and
 * to keys forwarded from the viewport iframe (PickEngine `forwardKey`).
 */
import type { PickMode } from "../../core/pick";
import { eventElement } from "../../core/resolve";
import type { ViewportId } from "../../core/surface";
import { VIEWPORT_ORDER } from "../../core/surface";
import { isShielded } from "../shadow-root";

/** Same selector as the pick engine's own typing check (`core/pick`, not exported). */
const TYPING = "input,textarea,select,[contenteditable]";

export interface KeyState {
  /** A dropdown menu is open (it closes itself when it saw the key; see `closeMenu`). */
  menuOpen: boolean;
  composerOpen: boolean;
  commandOpen: boolean;
  mode: PickMode;
  sheetOpen: boolean;
  /** The sheet is showing a ticket rather than the list. */
  ticketOpen: boolean;
}

export interface KeyActions {
  closeMenu(): void;
  closeComposer(): void;
  closeCommand(): void;
  exitMode(): void;
  backToList(): void;
  closeSheet(): void;
  toggleCommand(): void;
  toggleTool(tool: Exclude<PickMode, "idle">): void;
  toggleFreeze(): void;
  rotate(): void;
  setViewport(v: ViewportId): void;
  toggleSheet(): void;
}

/** Letter and number shortcuts, by lower-case key. */
const SHORTCUTS = new Map<string, (a: KeyActions) => void>([
  ["p", (a) => a.toggleTool("pick")],
  ["m", (a) => a.toggleTool("multi")],
  ["b", (a) => a.toggleTool("box")],
  ["t", (a) => a.toggleTool("text")],
  ["n", (a) => a.toggleTool("note")],
  ["f", (a) => a.toggleFreeze()],
  ["r", (a) => a.rotate()],
  ["e", (a) => a.toggleSheet()],
  ...VIEWPORT_ORDER.map((v, i): [string, (a: KeyActions) => void] => [String(i + 1), (a) => a.setViewport(v)]),
]);

/**
 * Handle one keydown. Returns true when the key was used (and its default prevented).
 * Skips events something else already handled (`defaultPrevented`: the dock grip's arrows, a menu that
 * closed itself on Esc; not the shield's own mark, see `isShielded`), and letter shortcuts typed into a text field.
 */
export function handleKeydown(ev: KeyboardEvent, state: KeyState, actions: KeyActions): boolean {
  if (ev.defaultPrevented && !isShielded(ev)) return false;
  // Keys that belong to an input method editor are not shortcuts.
  if (ev.isComposing || ev.keyCode === 229) return false;
  const key = typeof ev.key === "string" ? ev.key : "";
  const mod = ev.metaKey || ev.ctrlKey;

  if (mod && !ev.shiftKey && !ev.altKey && key.toLowerCase() === "k") {
    ev.preventDefault();
    actions.toggleCommand();
    return true;
  }

  // Esc closes one thing: menu, composer, command menu, current mode, ticket, sheet.
  if (key === "Escape") {
    const close: keyof KeyActions | null = state.menuOpen
      ? "closeMenu"
      : state.composerOpen
        ? "closeComposer"
        : state.commandOpen
          ? "closeCommand"
          : state.mode !== "idle"
            ? "exitMode"
            : state.sheetOpen
              ? state.ticketOpen
                ? "backToList"
                : "closeSheet"
              : null;
    if (!close) return false;
    ev.preventDefault();
    actions[close]();
    return true;
  }

  if (mod || ev.altKey || ev.repeat || eventElement(ev)?.closest(TYPING)) return false;
  // The command menu, an open menu and the composer own the keyboard while they are open: only Esc and ⌘K
  // (above) and the toggle chord (handled elsewhere) act. Otherwise `e` in a menu would toggle the sheet,
  // and `p` on a composer chip would discard the draft.
  if (state.commandOpen || state.menuOpen || state.composerOpen) return false;

  const run = SHORTCUTS.get(key.toLowerCase());
  if (!run) return false;
  ev.preventDefault();
  run(actions);
  return true;
}
