import { useState, type FormEvent } from "react";
import type { Entry, Session } from "../../core/entry";
import { Icon } from "../icons";
import { Button } from "../primitives/button";
import { Chip } from "../primitives/chip";
import { PriorityIcon } from "../primitives/priority-icon";
import { toast } from "../primitives/toast";
import type { GithubStatus, GithubSyncOutcome, PendingFile } from "../proompter-deps";

/** GitHub sync (D16). Present only when the host set `<Proompter github>`. */
export interface PublishGithub {
  status: GithubStatus;
  /** Sync now. `key` is the review key just typed after a 401. */
  onSync(key?: string): Promise<GithubSyncOutcome>;
}

export interface PublishPanelProps {
  session: Session;
  entries: readonly Entry[];
  pending: readonly PendingFile[];
  /** Writes the pending files. Absent: the button stays disabled. */
  onWrite?(): Promise<void>;
  github?: PublishGithub;
}

/** The Publish tab: the file tree of pending writes, and (v2) the GitHub issues that would be opened. */
export function PublishPanel({ session, entries, pending, onWrite, github }: PublishPanelProps) {
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
      {/* GitHub only (`save="github"`): there is no files sink, so no Files section. */}
      {onWrite || !github ? (
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
      ) : null}

      {github ? (
        <GithubSection entries={entries} github={github} />
      ) : (
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
      )}
    </div>
  );
}

/** The Publish tab's GitHub section once the host turned sync on: rows with their issue links, status, key field. */
function GithubSection({ entries, github }: { entries: readonly Entry[]; github: PublishGithub }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<GithubSyncOutcome | null>(null);
  const [key, setKey] = useState("");
  const { status } = github;

  const sync = async (typedKey?: string) => {
    if (busy) return;
    setBusy(true);
    try {
      setResult(await github.onSync(typedKey));
    } catch (err) {
      setResult({ ok: false, synced: 0, resolved: 0, error: err instanceof Error ? err.message : "Sync failed" });
    } finally {
      setBusy(false);
    }
  };
  const submitKey = (e: FormEvent) => {
    e.preventDefault();
    const k = key.trim();
    if (!k) return;
    setKey("");
    void sync(k);
  };

  const error = result ? (result.ok ? null : (result.error ?? status.error)) : status.error;
  let line: string;
  if (busy) line = "Syncing...";
  else if (error) line = error;
  else if (result?.ok && (result.synced > 0 || result.resolved > 0)) {
    line = `Synced ${result.synced} ${result.synced === 1 ? "entry" : "entries"}`;
    if (result.resolved > 0) line += `, ${result.resolved} resolved from GitHub`;
  } else if (status.pending > 0) line = `${status.pending} ${status.pending === 1 ? "entry" : "entries"} to sync`;
  else line = "Everything is synced.";

  return (
    <section aria-labelledby="pm-pub-issues">
      <div>
        <h3 id="pm-pub-issues">GitHub issues</h3>
        <p>Each entry becomes an issue and a file on the reviews branch. Closing an issue on GitHub resolves the entry.</p>
      </div>
      {entries.length > 0 ? (
        <div className="ilist">
          {entries.map((e) => {
            const url = status.urls[e.id];
            const label = e.issue ? `#${e.issue.replace(/^#/, "")}` : null;
            return (
              <div key={e.id} className="irow">
                <PriorityIcon priority={e.priority} />
                <span>{e.title}</span>
                <span className="mono" style={{ color: "var(--fg-3)" }}>
                  {label && url ? (
                    <a href={url} target="_blank" rel="noreferrer" aria-label={`Issue ${label} for ${e.id}`}>
                      {label}
                    </a>
                  ) : (
                    (label ?? e.id)
                  )}
                </span>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="empty" style={{ padding: 20 }}>
          No entries yet.
        </div>
      )}
      <p role="status" className={error && !busy ? "pm-err" : undefined}>
        {line}
      </p>
      {status.needsKey ? (
        <form className="keyrow" onSubmit={submitKey}>
          <input
            className="pm-in-title"
            type="password"
            aria-label="Review key"
            placeholder="Review key"
            autoComplete="off"
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
          <Button variant="pri" size="sm" type="submit" disabled={busy || !key.trim()}>
            Save and sync
          </Button>
        </form>
      ) : null}
      <div>
        <Button disabled={busy} onClick={() => void sync()}>
          <Icon name="gh" size="s" />
          Sync to GitHub
        </Button>
      </div>
    </section>
  );
}
