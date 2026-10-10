import { useEffect, useRef, useState } from "react";
import type { Entry, Session } from "../../core/entry";
import { Icon } from "../icons";
import { IconButton } from "../primitives/button";
import { cx } from "../primitives/cx";
import { Segmented } from "../primitives/segmented";
import type { EntryPatch, PendingFile } from "../proompter-deps";
import { sessionSubtitle } from "../shell/format";
import { reducedMotion } from "../../core/motion";
import { Ticket } from "../ticket/ticket";
import { EntryList } from "./entry-list";
import { PublishPanel, type PublishGithub } from "./publish-panel";

export type SheetTab = "entries" | "publish";

/** What the ticket inside the sheet needs besides the entry. */
export interface SheetTicketProps {
  serialize(entry: Entry): string;
  entryPath(entry: Entry): string;
  tagOptions: readonly string[];
  planOptions: readonly string[];
  canOpenIssue?: boolean;
  onShow(entry: Entry): void;
  onUpdate(entry: Entry, patch: EntryPatch): void;
  onResolve(entry: Entry): void;
  onOpenIssue?(entry: Entry): void;
}

export interface SheetProps {
  open: boolean;
  /** Where it slides in from: `left` only when the dock is on the right edge. */
  side: "left" | "right";
  session: Session;
  entries: readonly Entry[];
  pending: readonly PendingFile[];
  tab: SheetTab;
  onTabChange(tab: SheetTab): void;
  /** The entry open as a ticket, or null for the list. */
  selectedId: string | null;
  onSelect(id: string | null): void;
  onClose(): void;
  onWrite?(): Promise<void>;
  /** GitHub sync for the Publish tab; absent: the tab is as in v1. */
  github?: PublishGithub;
  ticket: SheetTicketProps;
}

/**
 * The review session sheet (DESIGN §7): it slides in from the right, or from the left when the dock is on the
 * right edge. When the side changes while it is open it fades out, moves and fades back in, and never slides
 * across the screen. Tabs: Entries (grouped list, or a ticket) and Publish.
 */
export function Sheet({
  open,
  side,
  session,
  entries,
  pending,
  tab,
  onTabChange,
  selectedId,
  onSelect,
  onClose,
  onWrite,
  github,
  ticket,
}: SheetProps) {
  const ref = useRef<HTMLElement>(null);

  // -- side swap ----------------------------------------------------------------------------------------
  const [rendered, setRendered] = useState(side);
  const [instant, setInstant] = useState(false);
  const [fading, setFading] = useState(false);
  useEffect(() => {
    if (rendered === side) {
      // Flipped back before the fade finished: nothing to move, so do not stay faded out.
      setFading(false);
      return;
    }
    const move = () => {
      setInstant(true); // no translate transition for the jump
      setRendered(side);
      setFading(false);
      requestAnimationFrame(() => requestAnimationFrame(() => setInstant(false)));
    };
    if (!open || reducedMotion()) {
      move();
      return;
    }
    setFading(true);
    const id = setTimeout(move, 150);
    return () => clearTimeout(id);
  }, [side, rendered, open]);

  // -- focus --------------------------------------------------------------------------------------------
  const focus = useRef<{ inside: boolean; returnTo: HTMLElement | null }>({ inside: false, returnTo: null });
  useEffect(() => {
    if (!open) return;
    const el = ref.current;
    if (!el) return;
    const fs = focus.current;
    const prev = (el.getRootNode() as Document | ShadowRoot).activeElement;
    fs.returnTo = prev instanceof HTMLElement && !el.contains(prev) ? prev : null;
    fs.inside = true;
    el.focus({ preventScroll: true });
    return () => {
      const back = fs.returnTo;
      fs.returnTo = null;
      if (fs.inside && back?.isConnected) back.focus({ preventScroll: true });
      fs.inside = false;
    };
  }, [open]);

  const selected = selectedId ? entries.find((e) => e.id === selectedId) : undefined;
  const view = `${tab}:${selected?.id ?? ""}`;
  const lastView = useRef({ view, selectedId: selected?.id ?? null });
  useEffect(() => {
    const prev = lastView.current;
    lastView.current = { view, selectedId: selected?.id ?? null };
    if (!open || prev.view === view) return;
    const el = ref.current;
    if (!el) return;
    // The control that had focus is gone (list <-> ticket): back to the row we came from, else the sheet.
    const row =
      !selected && prev.selectedId
        ? Array.from(el.querySelectorAll<HTMLElement>("[data-entry]")).find(
            (n) => n.getAttribute("data-entry") === prev.selectedId,
          )
        : undefined;
    (row ?? el).focus({ preventScroll: true });
  }, [view, open, selected]);

  const pendingEntries = pending.filter((f) => f.path.startsWith("entries/")).length;

  return (
    <aside
      ref={ref}
      tabIndex={-1}
      className={cx("pm-surface", "pm-sheet", rendered === "left" && "left", open && "on", instant && "flip")}
      style={fading ? { opacity: 0 } : undefined}
      aria-label="Review session"
      aria-hidden={!open}
      inert={!open}
      onFocus={() => {
        focus.current.inside = true;
      }}
      onBlur={(e) => {
        const to = e.relatedTarget as Node | null;
        if (to && !e.currentTarget.contains(to)) focus.current.inside = false;
      }}
    >
      {selected && tab === "entries" ? (
        <Ticket
          key={selected.id}
          entry={selected}
          session={session}
          serialize={ticket.serialize}
          path={ticket.entryPath(selected)}
          tagOptions={ticket.tagOptions}
          planOptions={ticket.planOptions}
          canOpenIssue={ticket.canOpenIssue}
          onBack={() => onSelect(null)}
          onClose={onClose}
          onShow={() => ticket.onShow(selected)}
          onUpdate={(patch) => ticket.onUpdate(selected, patch)}
          onResolve={() => ticket.onResolve(selected)}
          onOpenIssue={ticket.onOpenIssue ? () => ticket.onOpenIssue?.(selected) : undefined}
        />
      ) : (
        <>
          <div className="sh-hd">
            <span className="logo">
              <Icon name="logo" />
            </span>
            <div className="t">
              <b role="heading" aria-level={2}>{session.title}</b>
              <span>{sessionSubtitle(session)}</span>
            </div>
            <IconButton label="Close" onClick={onClose}>
              <Icon name="x" size="s" />
            </IconButton>
          </div>
          <Segmented
            className="sh-tabs"
            variant="text"
            label="Sheet view"
            value={tab}
            onValueChange={onTabChange}
            items={[
              { value: "entries", label: "Entries", count: entries.length },
              { value: "publish", label: "Publish", count: pendingEntries },
            ]}
          />
          <div className="sh-bd">
            {tab === "publish" ? (
              <PublishPanel session={session} entries={entries} pending={pending} onWrite={onWrite} github={github} />
            ) : (
              <EntryList entries={entries} selectedId={selectedId} onOpen={(id) => onSelect(id)} />
            )}
          </div>
        </>
      )}
    </aside>
  );
}
