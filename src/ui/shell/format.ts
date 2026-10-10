import type { Entry } from "../../core/entry";
import { VIEWPORTS, type ViewportId } from "../../core/surface";

const two = (n: number) => String(n).padStart(2, "0");

/** `12:42` in local time, as the prototype's list and activity show it. */
export function clock(iso: string | number): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${two(d.getHours())}:${two(d.getMinutes())}`;
}

/** `12:41:07`, for console and network rows. */
export function clockSeconds(ms: number): string {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return "";
  return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
}

export const viewportLabel = (v: ViewportId) => VIEWPORTS[v].label;

/** `390×844` (the exact size the entry was filed at). */
export function sizeLabel(e: Pick<Entry, "size">): string {
  return `${e.size.width}×${e.size.height}`;
}

/** The last two segments of a path: `entries/005-avatar-cropped.md`. */
export const tailPath = (path: string) => path.split("/").slice(-2).join("/");

/** `branch@sha · env`, skipping what the session does not have. */
export function sessionSubtitle(s: { branch?: string; sha?: string; env?: string }): string {
  const build = s.branch && s.sha ? `${s.branch}@${s.sha}` : (s.branch ?? s.sha ?? "");
  return [build, s.env].filter(Boolean).join(" · ");
}
