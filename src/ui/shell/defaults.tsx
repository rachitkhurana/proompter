/**
 * The default dependencies of `<Proompter>`: T07's store, serializer and composer, behind the small
 * `EntryStore` seam the sheet, ticket and command menu use (`../proompter-deps.ts`).
 * Only the lazy UI chunk imports this file.
 */
import { createFilesSink, DEFAULT_ENDPOINT, type FilesSink } from "../../core/sinks/files";
import { createGithubSink, REVIEW_KEY_STORAGE, type GithubSink } from "../../core/sinks/github";
import { isoSeconds, serialize, entryPath as entryFile, sessionIdFor } from "../../core/serialize";
import { createStore, type EntryStore as CoreStore, type StoreState as CoreState } from "../../core/store";
import { Composer } from "../composer/composer";
import { toast } from "../primitives/toast";
import type { EntryStore, GithubStatus, PendingFile, ProompterDeps, ProompterProps, StoreState } from "../proompter-deps";

const NO_PENDING: readonly PendingFile[] = [];
const HYDRATE_WAIT_MS = 2000;

/**
 * T07's store as the root's `EntryStore`: same data, `update`/`resolve` fire and forget.
 * With a files sink, `pending` is the sink's list and `write` flushes it; without one
 * nothing is pending and `write` is absent (the Publish button stays disabled).
 */
export function adaptStore(store: CoreStore, sink?: FilesSink, github?: GithubSink): EntryStore {
  let last: CoreState | undefined;
  let lastPending: readonly PendingFile[] | undefined;
  let lastGh: GithubStatus | undefined;
  let snap: StoreState | undefined;
  /** The GitHub part of the snapshot: the same object until one of its inputs changes. */
  const status = (): GithubStatus | undefined => {
    if (!github) return undefined;
    const pending = github.pending().length;
    const urls = github.urls();
    if (!lastGh || lastGh.pending !== pending || lastGh.urls !== urls || lastGh.error !== github.lastError || lastGh.needsKey !== github.needsKey) {
      lastGh = { pending, urls, error: github.lastError, needsKey: github.needsKey };
    }
    return lastGh;
  };
  return {
    getSnapshot() {
      const s = store.getState();
      const pending = sink ? sink.pending() : NO_PENDING;
      const gh = status();
      if (!snap || s !== last || pending !== lastPending || gh !== snap.github) {
        last = s;
        lastPending = pending;
        snap = { session: s.session, entries: s.entries, pending, ...(gh ? { github: gh } : {}) };
      }
      return snap;
    },
    subscribe(listener) {
      const offStore = store.subscribe(listener);
      const offSink = sink?.subscribe(listener);
      const offGh = github?.subscribe(listener);
      return () => {
        offStore();
        offSink?.();
        offGh?.();
      };
    },
    // The store logs the change in `activity` itself, so nothing is added here.
    update(id, patch, who) {
      void store.update(id, patch, who);
    },
    resolve(id, who) {
      void store.resolve(id, who);
    },
    ...(sink
      ? {
          async write() {
            await sink.write();
          },
        }
      : {}),
    ...(github
      ? {
          async syncGithub(key?: string) {
            if (key) saveKey(key);
            const r = await github.sync();
            return { ok: r.ok, synced: r.synced, resolved: r.resolved, ...(r.error !== undefined ? { error: r.error } : {}), ...(r.needsKey ? { needsKey: true } : {}) };
          },
        }
      : {}),
  };
}

/** The review key the reviewer typed: localStorage, with a copy in memory for when storage is blocked. */
let memoryKey: string | null = null;
function saveKey(key: string): void {
  memoryKey = key;
  try {
    localStorage.setItem(REVIEW_KEY_STORAGE, key);
  } catch {
    // private window: the in-memory copy lasts until the page closes
  }
}
function loadKey(): string | null {
  try {
    return localStorage.getItem(REVIEW_KEY_STORAGE) ?? memoryKey;
  } catch {
    return memoryKey;
  }
}

/** Per-browser tag for session ids when GitHub sync is on. */
export const BROWSER_TAG_STORAGE = "proompter:browser";
let memoryTag: string | null = null;
/**
 * With GitHub sync, every reviewer's browser writes to the same branch: a shared `<date>_review` id would make two
 * reviewers' PRO-1 the same issue and file. A random tag kept in this browser keeps reloads in one session and
 * different browsers apart (`2026-10-11_review-k3x9q2`). The route also refuses a mismatch with 409.
 */
export function browserTag(): string {
  const fresh = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");
  try {
    const kept = localStorage.getItem(BROWSER_TAG_STORAGE);
    if (kept && /^[a-z0-9]{6}$/.test(kept)) return kept;
    const tag = fresh();
    localStorage.setItem(BROWSER_TAG_STORAGE, tag);
    return tag;
  } catch {
    return (memoryTag ??= fresh()); // private window: lasts until the page closes
  }
}

/** With GitHub sync: this browser's session id, and its start when it can be kept. */
function githubSession(title: string): { id: string; started?: string } {
  const id = `${sessionIdFor(title, new Date())}-${browserTag()}`;
  const started = sessionStart(id);
  return started ? { id, started } : { id };
}

/** The GitHub session's id and start, per browser: `{ id, started }`. */
export const SESSION_START_STORAGE = "proompter:session";
/**
 * The start time the route checks ownership by (409 for another review). IndexedDB keeps it too, but only once an
 * entry is saved and only per tab until then: two tabs opened together, or a browser whose IndexedDB was cleared,
 * would each claim a different start for the same id. localStorage is shared by the tabs and lives with the tag.
 */
export function sessionStart(id: string): string | undefined {
  const read = (raw: string | null): { id?: unknown; started?: unknown } | null => {
    try {
      return JSON.parse(raw ?? "null") as { id?: unknown; started?: unknown } | null;
    } catch {
      return null; // junk: replaced below
    }
  };
  try {
    const kept = read(localStorage.getItem(SESSION_START_STORAGE));
    if (kept?.id === id && typeof kept.started === "string" && !Number.isNaN(Date.parse(kept.started))) return kept.started;
    const started = isoSeconds(new Date());
    localStorage.setItem(SESSION_START_STORAGE, JSON.stringify({ id, started }));
    return started;
  } catch {
    return undefined; // private window: the store's own start (one tab, one page load)
  }
}

export function createDefaultDeps(options: ProompterProps): ProompterDeps {
  // A new entry is numbered only after the disk has been read (`sink.hydrated`), so it can never take a number
  // that already exists in `reviews/`. Capped at 2 s in case the route hangs.
  // eslint-disable-next-line prefer-const -- assigned after the store exists; the store's beforeCreate closure reads it
  let sink: FilesSink | undefined;
  const core = createStore({
    session: {
      title: options.session?.title ?? "Review",
      reviewer: options.session?.reviewer ?? "reviewer",
      ...(options.github ? githubSession(options.session?.title ?? "Review") : {}),
    },
    plugins: options.plugins,
    onWriteError: () => toast("Couldn't save locally. The entry is kept until you close this tab."),
    beforeCreate: () => (sink ? Promise.race([sink.hydrated, new Promise<void>((r) => setTimeout(r, HYDRATE_WAIT_MS))]) : undefined),
  });
  // Outside dev there is no route: `enabled: false` skips the GET (no failing request in the host's console).
  sink = createFilesSink({
    endpoint: options.endpoint ?? DEFAULT_ENDPOINT,
    store: core,
    enabled: process.env.NODE_ENV === "development",
  });
  void sink.rehydrate();
  const github = options.github ? createGithubSink({ ...(options.github.endpoint ? { endpoint: options.github.endpoint } : {}), store: core, key: loadKey }) : undefined;
  return {
    store: adaptStore(core, sink, github),
    serialize: (entry, session) => serialize(entry, session),
    entryPath: (entry, session) => `reviews/${session.id}/${entryFile(entry)}`,
    composer: (p) =>
      p.surface ? (
        <Composer
          ref={p.discardRef}
          commit={p.commit}
          surface={p.surface}
          viewport={p.viewport}
          size={p.surface.size()}
          rotated={p.rotated}
          route={p.surface.win.location.pathname}
          capture={p.getCapture()}
          store={core}
          plugins={p.plugins}
          onClose={(r) => (r.type === "saved" ? p.onCreated(r.entry) : p.onClose())}
        />
      ) : null,
  };
}
