import type { EntryIntent, EntryKind, EntryPriority } from "../../core/entry";
import type { IconName } from "../icons";

/** Prototype `INTENT`. */
export const INTENT_ORDER: readonly EntryIntent[] = ["fix", "change", "question", "approve"];
export const INTENT_LABEL: Record<EntryIntent, string> = {
  fix: "Fix",
  change: "Change",
  question: "Question",
  approve: "Looks good",
};

/** Prototype `PRIO` (urgent / high / med), under the one vocabulary of DESIGN D2.5. */
export const PRIORITY_ORDER: readonly EntryPriority[] = ["blocking", "important", "minor"];

/** Prototype `TAGS`. */
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

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The composer header's name for what is being reviewed (prototype `targetName`). */
export function targetName(kind: EntryKind, count: number, label: string): string {
  switch (kind) {
    case "note":
      return "Page note";
    case "box":
      return `${plural(count, "element", "elements")} in a box`;
    case "multi":
      return `${count} elements`;
    case "text":
      return "Quoted text";
    default:
      return label || "Element";
  }
}

export { plural };
