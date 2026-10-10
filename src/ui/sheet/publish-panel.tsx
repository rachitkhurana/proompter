import { useState } from "react";
import type { Entry, Session } from "../../core/entry";
import { Icon } from "../icons";
import { Button } from "../primitives/button";
import { Chip } from "../primitives/chip";
import { PriorityIcon } from "../primitives/priority-icon";
import { toast } from "../primitives/toast";
import type { PendingFile } from "../proompter-deps";

export interface PublishPanelProps {
  session: Session;
  entries: readonly Entry[];
  pending: readonly PendingFile[];
  /** Writes the pending files. Absent: the button stays disabled. */
  onWrite?(): Promise<void>;
}

/** The Publish tab: the file tree of pending writes, and (v2) the GitHub issues that would be opened. */
export function PublishPanel({ session, entries, pending, onWrite }: PublishPanelProps) {
  const [busy, setBusy] = useState(false);
  const files = pending.length;
  // v2 preview: fix and change entries that are still open and have no issue yet.
  const issues = entries.filter(
    (e) => !e.issue && e.status !== "resolved" && (e.intent === "fix" || e.intent === "change"),
  );
  const canWrite = files > 0 && !!onWrite && !busy;

  const write = async () => {
    if (!canWrite || !onWrite) return;
    setBusy(true);
    try {
      await onWrite();
      toast(
        <>
          Wrote {files} file{files === 1 ? "" : "s"} to <span className="mono">reviews/{session.id}/</span>
        </>,
      );
    } catch (err) {
      toast(`Could not write the files: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pub">
      <section aria-labelledby="pm-pub-files">
        <div>
          <h3 id="pm-pub-files">Files</h3>
          <p>Each entry is a markdown file in the repo, one folder per session. Commit them with your branch.</p>
        </div>
        {/* Focusable: long paths scroll sideways, and a scrollable region must be reachable by keyboard (axe). */}
        <div className="tree" role="list" aria-label="Pending files" tabIndex={0}>
          {files > 0 ? (
            pending.map((f) => (
              <div key={f.path} role="listitem" className={f.change === "add" ? "a" : "m"}>
                {f.change === "add" ? "+" : "~"} {f.path}
              </div>
            ))
          ) : (
            <div>Everything is written. Nothing new to commit.</div>
          )}
        </div>
        <div>
          <Button variant="pri" disabled={!canWrite} onClick={() => void write()}>
            <Icon name="file" size="s" />
            Write {files} file{files === 1 ? "" : "s"}
          </Button>
        </div>
      </section>

      <section aria-labelledby="pm-pub-issues">
        <div>
          <h3 id="pm-pub-issues">
            GitHub issues
            <Chip ghost>v2</Chip>
          </h3>
          <p>Fix and change entries can open an issue. Questions and approvals stay in the files.</p>
        </div>
        {issues.length > 0 ? (
          <div className="ilist">
            {issues.map((e) => (
              <div key={e.id} className="irow">
                <PriorityIcon priority={e.priority} />
                <span>{e.title}</span>
                <span className="mono" style={{ color: "var(--fg-3)" }}>
                  {e.id}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty" style={{ padding: 20 }}>
            Every open fix and change already has an issue.
          </div>
        )}
        <div>
          <Button disabled>
            <Icon name="gh" size="s" />
            Open {issues.length} issue{issues.length === 1 ? "" : "s"}
          </Button>
        </div>
      </section>
    </div>
  );
}
