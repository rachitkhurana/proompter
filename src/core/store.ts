/**
 * The entry store (DESIGN §8): entries and session state, a React-friendly subscribe API, an event stream for
 * sinks, and IndexedDB persistence. Framework-free.
 *
 * - `getState()` returns an immutable snapshot whose identity changes only when something changed, so
 *   `useSyncExternalStore(store.subscribe, store.getState)` works as is.
 * - `on(listener)` delivers `entry:created` / `entry:updated` (`EntryEvent`) to sinks, after the state has
 *   changed and after redaction. A sink never sees an entry the built-in and plugin redaction have not cleared.
 * - Persistence is raw `indexedDB` (no dependency), best effort: every call is wrapped. A failure to open falls
 *   back to memory; a failed write calls `onWriteError` (once per burst of failures) so the UI can warn.
 * - Numbering is per session (`PRO-1`, `PRO-2`, ...). With IndexedDB the number is allocated INSIDE the same
 *   readwrite transaction that adds the entry (max `n` of the session + 1, and `add`, never `put`), so two tabs on
 *   the same session cannot both take PRO-4 or overwrite each other. Without it, numbering continues from the
 *   highest number in memory.
 */
import { redactText } from "./capture/redact";
import type {
  Entry,
  EntryActivity,
  EntryEvent,
  EntryIntent,
  EntryPriority,
  EntryStatus,
  ProompterPlugin,
  Session,
} from "./entry";
import { applyRedact, RedactError, type Plugins } from "./plugins";
import { assetNames, cleanDescription, isoSeconds, sessionIdFor } from "./serialize";

export { RedactError };

export interface SessionInit {
  title: string;
  reviewer: string;
  branch?: string;
  sha?: string;
  env?: string;
  /** Defaults to now. */
  started?: Date | string;
  /**
   * Defaults to `<YYYY-MM-DD>_<title-slug>` from `started`. If given it must match
   * `^\d{4}-\d{2}-\d{2}_[a-z0-9-]+$` (it becomes a folder name): anything else throws.
   */
  id?: string;
}

/** What a session id may look like. No `/`, `\`, `..` or anything else that could leave `reviews/`. */
export const SESSION_ID = /^\d{4}-\d{2}-\d{2}_[a-z0-9-]+$/;

export interface StoreOptions {
  session: SessionInit;
  /** Used for `redact` on create and update (DESIGN §9). */
  plugins?: readonly ProompterPlugin[];
  /** IndexedDB factory. Default `globalThis.indexedDB`; `null` forces memory only. */
  idb?: IDBFactory | null;
  /** IndexedDB database name. Default `proompter`. */
  dbName?: string;
  now?: () => Date;
  /**
   * T09: `create` waits for this (after `ready`) before it picks an entry number. The files sink passes its
   * `hydrated` promise so numbers already on disk are adopted first. Errors are ignored; a hung promise is the
   * caller's to time out.
   */
  beforeCreate?: () => Promise<unknown> | undefined;
  /**
   * Called when a write to IndexedDB fails (quota, aborted transaction): the entry is kept in memory only.
   * Fires once per burst of failures; a later successful write re-arms it.
   */
  onWriteError?: () => void;
}

export interface StoreState {
  session: Session;
  /** Ordered by `n`. */
  entries: readonly Entry[];
  /** The saved entries of this session have been loaded (or loading failed and the store runs in memory). */
  ready: boolean;
}

/** What a caller supplies to `create`; the store adds id, n, session, status, timestamps and the activity log. */
export type NewEntry = Omit<Entry, "id" | "ref" | "n" | "session" | "status" | "issue" | "created" | "updated" | "activity"> & {
  status?: EntryStatus;
  issue?: string | null;
  created?: string;
};

/** The fields `update` can change (everything else is fixed once filed). An empty title is ignored. */
export interface EntryPatch {
  title?: string;
  description?: string;
  status?: EntryStatus;
  intent?: EntryIntent;
  priority?: EntryPriority;
  tags?: string[];
  testPlan?: string | null;
  task?: string | null;
  /** The note from `proompter resolve --note` (T15); `null` removes it. */
  resolution?: string | null;
  issue?: string | null;
}

export type EntryListener = (event: EntryEvent) => void;

export interface EntryStore {
  getState(): StoreState;
  /** For `useSyncExternalStore`. */
  subscribe(listener: () => void): () => void;
  /** Sink events. Returns the unsubscribe function. */
  on(listener: EntryListener): () => void;
  get(id: string): Entry | undefined;
  /** Resolves when the session's saved entries are loaded. Never rejects. */
  readonly ready: Promise<void>;
  /**
   * File a new entry. Waits for `ready`, so numbering continues after a reload. Rejects with `RedactError` (and
   * stores and emits nothing) when a redact plugin fails; the entry number is not used up.
   */
  create(draft: NewEntry, opts?: { plugins?: Plugins }): Promise<Entry>;
  /** Change fields, log the change in `activity`, emit `entry:updated`. No change: no event, same entry back. */
  update(id: string, patch: EntryPatch, who?: string): Promise<Entry | undefined>;
  resolve(id: string, who?: string): Promise<Entry | undefined>;
  /**
   * T09: adopt entries read from disk (parsed files) that this session does not have, keeping their numbers.
   * Entries of another session or with a number already present are ignored. Emits no `entry:created` (they are
   * already on disk) and numbering continues above the highest number. Returns the entries that were added.
   */
  hydrate(entries: readonly Entry[]): Promise<Entry[]>;
  /** Resolves when everything queued so far has been written to IndexedDB (or dropped). For tests and shutdown. */
  flush(): Promise<void>;
  /** Close the database. The store keeps working in memory. */
  close(): void;
}

// ---------------------------------------------------------------------------------------------------------
// IndexedDB (raw)

type AddResult = { entry: Entry } | { error: unknown } | null;

const ENTRIES = "entries";
const SESSIONS = "sessions";
const OPEN_TIMEOUT_MS = 2500;

interface EntryRecord {
  key: string;
  session: string;
  entry: Entry;
}

function openDatabase(factory: IDBFactory | null | undefined, name: string): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (!factory) return resolve(null);
    let done = false;
    const finish = (db: IDBDatabase | null) => {
      if (done) {
        db?.close();
        return;
      }
      done = true;
      clearTimeout(timer);
      resolve(db);
    };
    const timer = setTimeout(() => finish(null), OPEN_TIMEOUT_MS);
    try {
      const req = factory.open(name, 1);
      req.onupgradeneeded = () => {
        try {
          const db = req.result;
          if (!db.objectStoreNames.contains(ENTRIES)) db.createObjectStore(ENTRIES, { keyPath: "key" });
          if (!db.objectStoreNames.contains(SESSIONS)) db.createObjectStore(SESSIONS, { keyPath: "id" });
        } catch {
          finish(null);
        }
      };
      req.onsuccess = () => finish(req.result);
      req.onerror = () => finish(null);
      req.onblocked = () => finish(null);
    } catch {
      finish(null);
    }
  });
}

/** Run one request in its own transaction. Resolves with the request's result, or `ok: false` on any failure. */
function run<T>(
  db: IDBDatabase,
  store: string,
  mode: IDBTransactionMode,
  op: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<{ ok: boolean; result?: T }> {
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(store, mode);
      const req = op(tx.objectStore(store));
      tx.oncomplete = () => resolve({ ok: true, result: req.result });
      tx.onerror = () => resolve({ ok: false });
      tx.onabort = () => resolve({ ok: false });
    } catch {
      resolve({ ok: false });
    }
  });
}

function createBackend(db: IDBDatabase) {
  return {
    async loadSession(sessionId: string): Promise<{ session?: Session; entries: Entry[] }> {
      const [rows, sess] = await Promise.all([
        run<EntryRecord[]>(db, ENTRIES, "readonly", (s) => s.getAll() as IDBRequest<EntryRecord[]>),
        run<Session[]>(db, SESSIONS, "readonly", (s) => s.getAll() as IDBRequest<Session[]>),
      ]);
      const entries = (rows.result ?? [])
        .filter((r) => r && r.session === sessionId && r.entry && typeof r.entry.n === "number")
        .map((r) => r.entry)
        .sort((a, b) => a.n - b.n);
      const session = (sess.result ?? []).find((s) => s && s.id === sessionId);
      return { session, entries };
    },
    /**
     * Allocate the next number and add the entry in ONE readwrite transaction. `build(n)` makes the entry (and may
     * throw, which aborts the transaction and comes back as `{ error }`). `null`: IndexedDB itself failed.
     */
    addEntry(sessionId: string, minN: number, build: (n: number) => Entry) {
      return new Promise<AddResult>((resolve) => {
        let added: Entry | undefined;
        let failure: { error: unknown } | undefined;
        try {
          const tx = db.transaction(ENTRIES, "readwrite");
          const store = tx.objectStore(ENTRIES);
          const all = store.getAll() as IDBRequest<EntryRecord[]>;
          all.onsuccess = () => {
            try {
              let max = minN - 1;
              for (const r of all.result ?? []) {
                if (r && r.session === sessionId && r.entry && typeof r.entry.n === "number") max = Math.max(max, r.entry.n);
              }
              const entry = build(max + 1);
              const record: EntryRecord = { key: `${sessionId}/${entry.n}`, session: sessionId, entry };
              store.add(record); // never `put`: an existing key must fail, not be overwritten
              added = entry;
            } catch (error) {
              failure = { error };
              try {
                tx.abort();
              } catch {
                // already finished
              }
            }
          };
          tx.oncomplete = () => resolve(added ? { entry: added } : null);
          tx.onerror = () => resolve(failure ?? null);
          tx.onabort = () => resolve(failure ?? null);
        } catch {
          resolve(null);
        }
      });
    },
    async putEntry(entry: Entry) {
      const record: EntryRecord = { key: `${entry.session}/${entry.n}`, session: entry.session, entry };
      return (await run(db, ENTRIES, "readwrite", (s) => s.put(record))).ok;
    },
    async putSession(session: Session) {
      return (await run(db, SESSIONS, "readwrite", (s) => s.put(session))).ok;
    },
    close() {
      try {
        db.close();
      } catch {
        // already closed
      }
    },
  };
}

// ---------------------------------------------------------------------------------------------------------
// Store

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const orNone = (v: string | null | undefined) => (v === null || v === undefined || v === "" ? "none" : v);

/**
 * The patch as the store will keep it: the built-in redaction first (so a repeated edit containing a secret
 * compares equal to what is stored), an empty title dropped, descriptions cleaned like the composer's.
 */
function sanitizePatch(patch: EntryPatch): EntryPatch {
  const out: EntryPatch = { ...patch };
  if (patch.title !== undefined) {
    const t = redactText(patch.title).trim();
    if (t === "") delete out.title;
    else out.title = t;
  }
  if (patch.description !== undefined) out.description = cleanDescription(redactText(patch.description));
  if (patch.tags !== undefined) out.tags = patch.tags.map(redactText);
  if (typeof patch.testPlan === "string") out.testPlan = redactText(patch.testPlan);
  if (typeof patch.task === "string") out.task = redactText(patch.task);
  if (typeof patch.resolution === "string") out.resolution = redactText(patch.resolution);
  if (typeof patch.issue === "string") out.issue = redactText(patch.issue);
  return out;
}

function describeChanges(prev: Entry, patch: EntryPatch): { next: Entry; log: string[] } {
  const next: Record<string, unknown> = { ...prev };
  const old: Record<string, unknown> = { ...prev };
  const changes: Record<string, unknown> = { ...patch };
  const log: string[] = [];
  for (const [key, label, edited] of CHANGE_FIELDS) {
    const to = changes[key];
    if (to === undefined || same(to ?? undefined, old[key] ?? undefined)) continue;
    log.push(edited ? `${label} edited` : `${label}: ${show(old[key])} → ${show(to)}`);
    if (to === null && key !== "issue") delete next[key];
    else next[key] = Array.isArray(to) ? [...to] : to;
  }
  return { next: next as unknown as Entry, log };
}

/** Patch fields in activity-log order: [key, log label, log "edited" instead of old → new]. */
const CHANGE_FIELDS: ReadonlyArray<readonly [keyof EntryPatch, string, boolean]> = [
  ["status", "status", false],
  ["priority", "priority", false],
  ["intent", "intent", false],
  ["title", "title", true],
  ["description", "description", true],
  ["tags", "tags", false],
  ["testPlan", "test plan", false],
  ["task", "task", false],
  ["resolution", "resolution", true],
  ["issue", "issue", false],
];
const show = (v: unknown) => (Array.isArray(v) ? v.join(", ") || "none" : orNone(v as string | null | undefined));

export function createStore(opts: StoreOptions): EntryStore {
  const now = opts.now ?? (() => new Date());
  const started = opts.session.started ? new Date(opts.session.started) : now();
  if (opts.session.id !== undefined && !SESSION_ID.test(opts.session.id)) {
    throw new Error(`Invalid session id '${opts.session.id}': it must match ${String(SESSION_ID)}`);
  }
  const initialSession: Session = {
    id: opts.session.id ?? sessionIdFor(opts.session.title, started),
    title: opts.session.title,
    reviewer: opts.session.reviewer,
    ...(opts.session.branch !== undefined ? { branch: opts.session.branch } : {}),
    ...(opts.session.sha !== undefined ? { sha: opts.session.sha } : {}),
    ...(opts.session.env !== undefined ? { env: opts.session.env } : {}),
    started: isoSeconds(started),
    version: 1,
  };

  let state: StoreState = {
    session: initialSession,
    entries: [],
    ready: false,
  };
  const stateListeners = new Set<() => void>();
  const eventListeners = new Set<EntryListener>();
  let backend: ReturnType<typeof createBackend> | null = null;
  let failing = false;
  let sessionSaved = false;
  let writes: Promise<unknown> = Promise.resolve();

  const setState = (patch: Partial<StoreState>) => {
    state = { ...state, ...patch };
    for (const l of [...stateListeners]) {
      try {
        l();
      } catch {
        // a broken subscriber must not break the store
      }
    }
  };
  const emit = (event: EntryEvent) => {
    for (const l of [...eventListeners]) {
      try {
        l(event);
      } catch {
        // a broken sink must not break the store
      }
    }
  };
  /** Report a write result; `onWriteError` fires on the first failure of a burst, a success re-arms it. */
  const wrote = (ok: boolean) => {
    if (ok) failing = false;
    else if (!failing) {
      failing = true;
      try {
        opts.onWriteError?.();
      } catch {
        // a broken callback must not break the store
      }
    }
  };
  const queue = (job: () => Promise<unknown>) => {
    writes = writes.then(job, job).catch(() => {});
  };
  const saveSessionOnce = () => {
    if (!backend || sessionSaved) return;
    sessionSaved = true;
    const b = backend;
    const s = state.session;
    queue(async () => wrote(await b.putSession(s)));
  };
  const persist = (entry: Entry) => {
    if (!backend) return;
    const b = backend;
    saveSessionOnce();
    queue(async () => wrote(await b.putEntry(entry)));
  };

  const factory = opts.idb === undefined ? (globalThis as { indexedDB?: IDBFactory }).indexedDB : opts.idb;
  const ready: Promise<void> = (async () => {
    try {
      const db = await openDatabase(factory, opts.dbName ?? "proompter");
      if (!db) {
        setState({ ready: true });
        return;
      }
      backend = createBackend(db);
      const saved = await backend.loadSession(initialSession.id);
      // Entries filed while loading (unlikely: `create` waits for `ready`) stay; saved ones come first.
      const have = new Set(state.entries.map((e) => e.n));
      const merged = [...saved.entries.filter((e) => !have.has(e.n)), ...state.entries].sort((a, b) => a.n - b.n);
      sessionSaved = !!saved.session;
      setState({
        entries: merged,
        // The stored session wins for `started` (a reload keeps the original start), the live options win otherwise.
        session: saved.session ? { ...state.session, started: saved.session.started } : state.session,
        ready: true,
      });
    } catch {
      backend = null;
      setState({ ready: true });
    }
  })();

  const nextN = () => state.entries.reduce((m, e) => Math.max(m, e.n), 0) + 1;

  const updateEntry: EntryStore["update"] = async (id, rawPatch, who) => {
    await ready;
    const prev = state.entries.find((e) => e.id === id);
    if (!prev) return undefined;
    const { next, log } = describeChanges(prev, sanitizePatch(rawPatch));
    if (log.length === 0) return prev;
    const at = isoSeconds(now());
    const by = who ?? state.session.reviewer;
    const raw: Entry = {
      ...next,
      updated: at,
      activity: [...prev.activity, ...log.map((text) => ({ at, who: by, text }))],
    };
    const result = applyRedact(opts.plugins, raw);
    if (!result.ok) throw new RedactError(result.plugin, result.error);
    const entry = result.entry;
    setState({ entries: state.entries.map((e) => (e.id === id ? entry : e)) });
    emit({ type: "entry:updated", entry, previous: prev });
    persist(entry);
    return entry;
  };

  return {
    getState: () => state,
    subscribe(listener) {
      stateListeners.add(listener);
      return () => {
        stateListeners.delete(listener);
      };
    },
    on(listener) {
      eventListeners.add(listener);
      return () => {
        eventListeners.delete(listener);
      };
    },
    get: (id) => state.entries.find((e) => e.id === id),
    ready,

    async create(draft, o = {}) {
      await ready;
      await Promise.resolve(opts.beforeCreate?.()).catch(() => {});
      const plugins = o.plugins ?? opts.plugins;
      const created = isoSeconds(draft.created ?? now());
      const targets = draft.targets.length ? draft.targets : draft.target ? [draft.target] : [];
      const { created: _created, status, issue, snapshot, ...rest } = draft;
      void _created;
      const sessionId = state.session.id;
      const reviewer = state.session.reviewer;

      const hasImage = !!(snapshot?.element || snapshot?.viewport);
      const pickAssets = (n: number) => {
        const names = assetNames(n, draft.viewport);
        return {
          ...(snapshot?.element ? { element: names.element } : {}),
          ...(snapshot?.viewport ? { viewport: names.viewport } : {}),
        };
      };

      /** Build, number and redact the entry for number `n`. Throws `RedactError`; nothing is kept then. */
      const make = (n: number): Entry => {
        const raw: Entry = {
          ...rest,
          id: `PRO-${n}`,
          ref: `${sessionId}/PRO-${n}`,
          n,
          session: sessionId,
          status: status ?? "open",
          issue: issue ?? null,
          targets,
          ...(targets[0] ? { target: targets[0] } : {}),
          created,
          updated: created,
          activity: [{ at: created, who: reviewer, text: "created" } satisfies EntryActivity],
          ...(snapshot ? { snapshot: hasImage ? { ...snapshot, assets: pickAssets(n) } : snapshot } : {}),
        };
        if (!targets[0]) delete raw.target;
        const result = applyRedact(plugins, raw);
        if (!result.ok) throw new RedactError(result.plugin, result.error);
        return result.entry;
      };

      let entry: Entry | undefined;
      if (backend) {
        // The database decides the number (another tab may have filed entries we haven't seen).
        const r = await backend.addEntry(sessionId, nextN(), make);
        if (r && "entry" in r) {
          entry = r.entry;
          wrote(true);
        } else if (r && r.error instanceof RedactError) throw r.error;
        else wrote(false); // IndexedDB failed; fall through and keep it in memory
      }
      entry ??= make(nextN());

      const filed = entry;
      setState({ entries: [...state.entries, filed].sort((a, b) => a.n - b.n) });
      emit({ type: "entry:created", entry: filed });
      saveSessionOnce();
      return filed;
    },

    update: updateEntry,

    resolve: (id, who) => updateEntry(id, { status: "resolved" }, who),

    async hydrate(entries) {
      await ready;
      const have = new Set(state.entries.map((e) => e.n));
      const added: Entry[] = [];
      for (const e of entries) {
        if (e.session !== state.session.id || have.has(e.n)) continue;
        have.add(e.n);
        added.push(e);
      }
      if (added.length === 0) return added;
      setState({ entries: [...state.entries, ...added].sort((a, b) => a.n - b.n) });
      for (const e of added) persist(e);
      return added;
    },

    async flush() {
      await ready;
      await writes;
    },

    close() {
      backend?.close();
      backend = null;
    },
  };
}
