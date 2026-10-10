/**
 * Global shortcuts and the Esc order (DESIGN §7), as a pure function over a state snapshot and a set of
 * actions, so it can be unit-tested without mounting anything. The root wires it to `document` keydown and
 * to keys forwarded from the viewport iframe (PickEngine `forwardKey`).
 */
import type { PickMode } from "../../core/pick";
import type { ViewportId } from "../../core/surface";
import { VIEWPORT_ORDER } from "../../core/surface";
import { isTypingTarget } from "./chord";

export interface KeyState {
  /** A dropdown menu is open (Radix closes it itself when it saw the key; see `closeMenu`). */
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

export type EscapeStep = "menu" | "composer" | "command" | "mode" | "ticket" | "sheet";

/** Esc closes one thing: menu, composer, command menu, current mode, ticket, sheet. */
export function escapeStep(s: KeyState): EscapeStep | null {
  if (s.menuOpen) return "menu";
  if (s.composerOpen) return "composer";
  if (s.commandOpen) return "command";
  if (s.mode !== "idle") return "mode";
  if (s.sheetOpen && s.ticketOpen) return "ticket";
  if (s.sheetOpen) return "sheet";
  return null;
}

const TOOL_KEYS: Record<string, Exclude<PickMode, "idle">> = {
  p: "pick",
  m: "multi",
  b: "box",
  t: "text",
  n: "note",
};

/**
 * Handle one keydown. Returns true when the key was used (and its default prevented).
 * Skips events something else already handled (`defaultPrevented`: the dock grip's arrows, a Radix menu or
 * dialog that closed itself on Esc), and letter shortcuts typed into a text field.
 */
export function handleKeydown(ev: KeyboardEvent, state: KeyState, actions: KeyActions): boolean {
  if (ev.defaultPrevented) return false;
  // Keys that belong to an input method editor are not shortcuts.
  if (ev.isComposing || ev.keyCode === 229) return false;
  const key = typeof ev.key === "string" ? ev.key : "";
  const mod = ev.metaKey || ev.ctrlKey;

  if (mod && !ev.shiftKey && !ev.altKey && key.toLowerCase() === "k") {
    ev.preventDefault();
    actions.toggleCommand();
    return true;
  }

  if (key === "Escape") {
    const step = escapeStep(state);
    if (!step) return false;
    ev.preventDefault();
    switch (step) {
      case "menu":
        actions.closeMenu();
        break;
      case "composer":
        actions.closeComposer();
        break;
      case "command":
        actions.closeCommand();
        break;
      case "mode":
        actions.exitMode();
        break;
      case "ticket":
        actions.backToList();
        break;
      case "sheet":
        actions.closeSheet();
        break;
    }
    return true;
  }

  if (mod || ev.altKey || ev.repeat || isTypingTarget(ev)) return false;
  // The command menu, an open menu and the composer own the keyboard while they are open: only Esc and ⌘K
  // (above) and the toggle chord (handled elsewhere) act. Otherwise `e` in a menu would toggle the sheet,
  // and `p` on a composer chip would discard the draft.
  if (state.commandOpen || state.menuOpen || state.composerOpen) return false;

  const k = key.toLowerCase();
  const tool = TOOL_KEYS[k];
  if (tool) {
    ev.preventDefault();
    actions.toggleTool(tool);
    return true;
  }
  if (k === "f") {
    ev.preventDefault();
    actions.toggleFreeze();
    return true;
  }
  if (k === "r") {
    ev.preventDefault();
    actions.rotate();
    return true;
  }
  if (k === "e") {
    ev.preventDefault();
    actions.toggleSheet();
    return true;
  }
  if (k >= "1" && k <= "4" && k.length === 1) {
    const v = VIEWPORT_ORDER[Number(k) - 1];
    if (v) {
      ev.preventDefault();
      actions.setViewport(v);
      return true;
    }
  }
  return false;
}
