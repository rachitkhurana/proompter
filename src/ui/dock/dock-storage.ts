import { parsePosition, type DockPosition } from "./dock-math";

/** localStorage keys, as in the prototype. */
export const DOCK_KEY = "proompter.dock";
export const COLLAPSED_KEY = "proompter.collapsed";

// Every access is wrapped: storage can throw (private mode, blocked site data, quota) or be missing, and a
// stored value can be corrupt.

function read<T>(key: string, parse: (raw: string) => T, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : parse(raw);
  } catch {
    return fallback;
  }
}

/** `null` removes the key. */
function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // ignore
  }
}

export const loadPosition = (): DockPosition | null => read(DOCK_KEY, (raw) => parsePosition(JSON.parse(raw)), null);

/** `null` clears the saved position (reset). */
export const savePosition = (p: DockPosition | null): void => write(DOCK_KEY, p && JSON.stringify(p));

export const loadCollapsed = (): boolean => read(COLLAPSED_KEY, (raw) => raw === "1", false);

export const saveCollapsed = (collapsed: boolean): void => write(COLLAPSED_KEY, collapsed ? "1" : "0");
