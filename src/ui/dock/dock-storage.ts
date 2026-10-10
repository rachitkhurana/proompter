import { parsePosition, type DockPosition } from "./dock-math";

/** localStorage keys, as in the prototype. */
export const DOCK_KEY = "proompter.dock";
export const COLLAPSED_KEY = "proompter.collapsed";

// Every access is wrapped: storage can throw (private mode, blocked site data, quota) or be missing.

export function loadPosition(): DockPosition | null {
  try {
    const raw = localStorage.getItem(DOCK_KEY);
    return raw ? parsePosition(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

/** `null` clears the saved position (reset). */
export function savePosition(p: DockPosition | null): void {
  try {
    if (p) localStorage.setItem(DOCK_KEY, JSON.stringify(p));
    else localStorage.removeItem(DOCK_KEY);
  } catch {
    // ignore
  }
}

export function loadCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

export function saveCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(COLLAPSED_KEY, collapsed ? "1" : "0");
  } catch {
    // ignore
  }
}
