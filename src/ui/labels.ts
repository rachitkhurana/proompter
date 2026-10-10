/**
 * Labels the composer, the ticket and the entry list share. Orders come from the core arrays
 * (`ENTRY_INTENTS`, `ENTRY_PRIORITIES`, `ENTRY_STATUSES`, `ENTRY_KINDS`); priority and status labels sit with
 * their icons in `primitives/`.
 */
import type { EntryIntent, EntryKind } from "../core/entry";
import type { IconName } from "./icons";

export const INTENT_LABEL: Record<EntryIntent, string> = {
  fix: "Fix",
  change: "Change",
  question: "Question",
  approve: "Looks good",
};

/** Prototype `TAGS`. Tags already on an entry are always offered too, so they can be removed. */
export const DEFAULT_TAGS: readonly string[] = ["ui", "data", "copy", "a11y", "perf", "regression", "mobile"];

/** Menu key for "Not linked" in the test plan menu. */
export const NO_PLAN_KEY = "__none__";

/** Prototype: pick -> pick, multi -> multi, box ("area") -> area, text -> text, note -> note. */
export const KIND_ICON: Record<EntryKind, IconName> = {
  element: "pick",
  multi: "multi",
  box: "area",
  text: "text",
  note: "note",
};

export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** What the composer header and the ticket's "Where" section call the thing being reviewed. */
export function targetName(kind: EntryKind, count: number, label: string): string {
  switch (kind) {
    case "note":
      return "Page note";
    case "box":
      return `${plural(count, "element", "elements")} in a box`;
    case "multi":
      return plural(count, "element", "elements");
    case "text":
      return "Quoted text";
    default:
      return label || "Element";
  }
}
