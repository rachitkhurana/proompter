import type { KeyboardEvent } from "react";
import type { Entry, EntryStatus } from "../../core/entry";
import { PickIcon, icons } from "../icons";
import { cx } from "../primitives/cx";
import { Kbd } from "../primitives/kbd";
import { PRIORITY_LABEL, PriorityIcon } from "../primitives/priority-icon";
import { STATUS_LABEL, StatusIcon } from "../primitives/status-icon";
import { clock, viewportLabel } from "../shell/format";

const GROUPS: ReadonlyArray<EntryStatus> = ["open", "progress", "resolved"];

export interface EntryListProps {
  entries: readonly Entry[];
  /** Highlights a row (the ticket that was just open). */
  selectedId?: string | null;
  onOpen(id: string): void;
}

/** The Entries tab: grouped Open / In progress / Resolved, newest first, one 40px row per entry. */
export function EntryList({ entries, selectedId, onOpen }: EntryListProps) {
  if (entries.length === 0) {
    return (
      <div className="empty">
        <span className="ei">
          <PickIcon />
        </span>
        <span>
          No entries yet. Press <Kbd>P</Kbd> and click anything on the page.
        </span>
      </div>
    );
  }

  // Up/Down move between rows (the rows are the only tab stops worth a shortcut in a long list).
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const rows = Array.from(e.currentTarget.querySelectorAll<HTMLElement>(".row"));
    const root = e.currentTarget.getRootNode() as Document | ShadowRoot;
    const i = rows.findIndex((r) => r === root.activeElement);
    if (i < 0) return;
    e.preventDefault();
    rows[(i + (e.key === "ArrowDown" ? 1 : -1) + rows.length) % rows.length]?.focus();
  };

  return (
    <div onKeyDown={onKeyDown}>
      {GROUPS.map((status) => {
        const list = entries.filter((e) => e.status === status);
        if (list.length === 0) return null;
        return (
          <section key={status} aria-label={STATUS_LABEL[status]}>
            <div className="grp">
              <StatusIcon status={status} />
              {STATUS_LABEL[status]}
              <span className="n num">{list.length}</span>
            </div>
            {list
              .slice()
              .reverse()
              .map((e) => {
                const VpIcon = icons[e.viewport];
                return (
                  <button
                    key={e.id}
                    type="button"
                    data-entry={e.id}
                    className={cx("row", e.status, selectedId === e.id && "sel")}
                    aria-label={`${e.id}: ${e.title}. ${PRIORITY_LABEL[e.priority]}, ${STATUS_LABEL[e.status]}, ${viewportLabel(e.viewport)}`}
                    onClick={() => onOpen(e.id)}
                  >
                    <PriorityIcon priority={e.priority} />
                    <span className="id">{e.id}</span>
                    <StatusIcon status={e.status} />
                    <span className="t">{e.title}</span>
                    <span className="r">
                      <span title={viewportLabel(e.viewport)}>
                        <VpIcon size="s" />
                      </span>
                      <span className="num">{clock(e.created)}</span>
                    </span>
                  </button>
                );
              })}
          </section>
        );
      })}
    </div>
  );
}
