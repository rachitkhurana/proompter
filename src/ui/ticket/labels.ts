import type { EntryIntent, EntryPriority, EntryStatus } from "../../core/entry";

/** Menu order and labels, from the prototype's `INTENT`, `PRIO` and `STATUS`. */
export const INTENTS: ReadonlyArray<{ value: EntryIntent; label: string }> = [
  { value: "fix", label: "Fix" },
  { value: "change", label: "Change" },
  { value: "question", label: "Question" },
  { value: "approve", label: "Looks good" },
];

export const INTENT_LABEL: Record<EntryIntent, string> = {
  fix: "Fix",
  change: "Change",
  question: "Question",
  approve: "Looks good",
};

export const PRIORITIES: readonly EntryPriority[] = ["blocking", "important", "minor"];
export const STATUSES: readonly EntryStatus[] = ["open", "progress", "resolved"];

/** Prototype `TAGS`. Tags already on an entry are always offered too, so they can be removed. */
export const DEFAULT_TAGS: readonly string[] = ["ui", "data", "copy", "a11y", "perf", "regression", "mobile"];
