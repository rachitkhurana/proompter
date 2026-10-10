/** Pieces the composer and the ticket share: the property menus and the captured-context log rows. */
import type { ReactElement } from "react";
import type { CaptureConsoleEntry, CaptureNetworkEntry } from "../core/capture/types";
import { ENTRY_INTENTS, ENTRY_PRIORITIES, ENTRY_STATUSES, type EntryIntent, type EntryPriority, type EntryStatus } from "../core/entry";
import { Icon } from "./icons";
import { INTENT_LABEL, NO_PLAN_KEY } from "./labels";
import { Menu, type MenuItem } from "./primitives/menu";
import { PRIORITY_LABEL, PriorityIcon } from "./primitives/priority-icon";
import { STATUS_LABEL, StatusIcon } from "./primitives/status-icon";
import { clockSeconds } from "./shell/format";

export type PropName = "status" | "intent" | "priority" | "tags" | "plan";

/** The menu's accessible name, heading and selection mode, per property. */
const PROPS: Record<PropName, { label: string; header?: string; selection: "single" | "multiple" }> = {
  status: { label: "Status", selection: "single" },
  intent: { label: "Intent", selection: "single" },
  priority: { label: "Priority", selection: "single" },
  tags: { label: "Tags", header: "Tags", selection: "multiple" },
  plan: { label: "Test plan", header: "Link to the manual test plan", selection: "single" },
};

export interface PropValues {
  status?: EntryStatus;
  intent: EntryIntent;
  priority: EntryPriority;
  tags: readonly string[];
  plan: string | null;
}

/** The checked-state menu items of every property for the current values. */
export function propertyItems(
  v: PropValues,
  tagChoices: readonly string[],
  planChoices: readonly string[],
): Record<PropName, MenuItem[]> {
  return {
    status: ENTRY_STATUSES.map((s) => ({ key: s, label: STATUS_LABEL[s], icon: <StatusIcon status={s} />, checked: v.status === s })),
    intent: ENTRY_INTENTS.map((k) => ({ key: k, label: INTENT_LABEL[k], icon: <Icon name={k} size="s" />, checked: v.intent === k })),
    priority: ENTRY_PRIORITIES.map((k) => ({ key: k, label: PRIORITY_LABEL[k], icon: <PriorityIcon priority={k} />, checked: v.priority === k })),
    tags: tagChoices.map((t) => ({ key: t, label: t, icon: <Icon name="tag" size="s" />, checked: v.tags.includes(t) })),
    plan: [
      { key: NO_PLAN_KEY, label: "Not linked", checked: v.plan === null },
      ...planChoices.map((p) => ({ key: p, label: p, icon: <Icon name="plan" size="s" />, checked: v.plan === p })),
    ],
  };
}

export function PropMenu({
  prop,
  items,
  onSelect,
  onOpenChange,
  trigger,
}: {
  prop: PropName;
  items: MenuItem[];
  onSelect(key: string): void;
  onOpenChange?(open: boolean): void;
  trigger: ReactElement;
}) {
  return <Menu {...PROPS[prop]} items={items} onSelect={onSelect} onOpenChange={onOpenChange} trigger={trigger} />;
}

/**
 * Rows of captured console lines or requests (the caller supplies the wrapper and the empty state).
 * `bad` decides which requests are coloured as failures: the composer goes by `!ok`, the ticket by status.
 */
export function LogRows(
  props: { console: readonly CaptureConsoleEntry[] } | { network: readonly CaptureNetworkEntry[]; bad(n: CaptureNetworkEntry): boolean },
) {
  return (
    <>
      {"console" in props
        ? props.console.map((c, i) => (
            <div key={i}>
              <span className="m">{clockSeconds(c.timestamp)}</span>
              <span className={c.level === "error" ? "e" : "w"}>{c.level}</span>
              <span title={c.message}>{c.message}</span>
            </div>
          ))
        : props.network.map((n, i) => (
            <div key={i}>
              <span className={props.bad(n) ? "e" : "g"}>{n.status ?? "ERR"}</span>
              <span className="m num">{Math.round(n.durationMs)}ms</span>
              <span title={n.url}>
                {n.method} {n.url}
              </span>
            </div>
          ))}
    </>
  );
}
