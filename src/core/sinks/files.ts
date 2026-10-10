/**
 * The files sink (DESIGN §8): mirrors the store's entries to `reviews/<session>/` through the dev route
 * (`src/next/route.ts`, mounted by the host at `app/api/proompter/route.ts`, URL `/api/proompter`).
 *
 * - `entry:created` / `entry:updated` POST the entry, one entry per request (a big review must never build one
 *   oversized body). Anything not yet written is `pending()` (paths relative to `reviews/<session>/`), which is
 *   what the Publish tab lists. Image data is only sent for assets that are not on disk yet.
 * - Nothing is posted automatically until `rehydrate()` has finished, so a stale copy in the store cannot
 *   overwrite a hand edit on disk. `write()` always works.
 * - A 404, or a 2xx that is not the route's JSON `{ ok: true }`, means "no route here" (preview, prod, or some
 *   other server answering): entries stay pending and auto-posting stops until `write()`. A 4xx for one entry
 *   (the route refused it) leaves that entry pending and the others are still written. Other failures stop the
 *   run and leave everything pending. Nothing retries by itself; the next event or `write()` is the retry.
 * - The sink never throws into the host: every failure becomes a `WriteResult` / stays pending.
 *
 * ## Merge rule (disk vs IndexedDB), applied by `rehydrate()`
 * The file carries less than the in-memory entry (no console arrays, activity or image data), so the two are
 * merged per entry number, never replaced:
 * - On disk and in the store: the store's entry is the base (activity, full context and images are kept) and
 *   the fields the file does carry (title, description, status, intent, priority, tags, test plan, task,
 *   issue) **come from disk**, applied through `store.update` (one activity line per changed field). This is
 *   how an agent or human editing the markdown wins over a stale IndexedDB copy.
 * - Only in the store: kept, and shown as pending (or auto-written in dev).
 * - Only on disk (IndexedDB was cleared): adopted into the store with `store.hydrate` (numbers kept, no
 *   `entry:created`), as parsed from the file.
 *
 * ## Preview and prod
 * `enabled: false` (the default root passes `NODE_ENV === "development"`) makes `rehydrate()` skip its GET, so
 * production pages never show a failing request in the console: entries just stay pending until `write()`.
 */
import type { Entry, Session } from "../entry";
import { assetNames, cleanDescription, entryPath, pad, serialize } from "../serialize";
import type { EntryPatch, EntryStore } from "../store";

/** One file the next write creates or changes, relative to `reviews/<session>/`. */
export interface PendingFile {
  path: string;
  change: "add" | "modify";
}

export interface WriteResult {
  ok: boolean;
  /** HTTP status, when the route answered. 404: preview or prod (no route). */
  status?: number;
  /** Number of files that were pending when the write started. */
  files: number;
  error?: string;
}

export interface RehydrateResult {
  /** The route answered and the session exists on disk. */
  found: boolean;
  /** Entries whose fields were taken from disk. */
  updated: number;
  /** Entries that were only on disk and are now in the store. */
  adopted: Entry[];
}

export interface FilesSinkOptions {
  /** Default `/api/proompter`. */
  endpoint?: string;
  fetch?: typeof fetch;
  store: EntryStore;
  /** Default true. False: `rehydrate()` does not call the route (preview/prod); `write()` still tries. */
  enabled?: boolean;
}

export interface FilesSink {
  /** Same array until something changes (it feeds `useSyncExternalStore`). */
  pending(): readonly PendingFile[];
  subscribe(listener: () => void): () => void;
  /** Flush everything pending, even after a 404 (that re-arms auto-posting if the route answers now). */
  write(): Promise<WriteResult>;
  /** Read the disk, merge it into the store, then start auto-posting. Call once after creating the sink. */
  rehydrate(): Promise<RehydrateResult>;
  /** True after a 404: auto-posting is off until `write()`. */
  paused(): boolean;
  /** Resolves when no request is in flight or queued. */
  idle(): Promise<void>;
  dispose(): void;
}

export const DEFAULT_ENDPOINT = "/api/proompter";
/** Must match `PROOMPTER_HEADER` in `src/next/route.ts` (kept separate so the client chunk never imports node code). */
const HEADER = "x-proompter";

const oneLine = (s: string) => s.replace(/[\r\n\u0085\u2028\u2029]+/g, " ").trim();

/** The fields the file carries that differ between the store's entry and the one on disk (disk wins). */
export function diskPatch(local: Entry, disk: Entry): EntryPatch {
  const p: EntryPatch = {};
  if (disk.status !== local.status) p.status = disk.status;
  if (disk.intent !== local.intent) p.intent = disk.intent;
  if (disk.priority !== local.priority) p.priority = disk.priority;
  if (disk.title !== oneLine(local.title)) p.title = disk.title;
  if (disk.description !== cleanDescription(local.description)) p.description = disk.description;
  if (JSON.stringify(disk.tags) !== JSON.stringify(local.tags)) p.tags = disk.tags;
  if ((disk.testPlan ?? null) !== (local.testPlan ?? null)) p.testPlan = disk.testPlan ?? null;
  if ((disk.task ?? null) !== (local.task ?? null)) p.task = disk.task ?? null;
  if (disk.issue !== local.issue) p.issue = disk.issue;
  return p;
}

type PostOutcome =
  | { kind: "ok" }
  /** The route refused this entry (4xx JSON): skip it, carry on with the others. */
  | { kind: "rejected"; status: number; error: string }
  /** Stop the run (route unavailable, network or server error). */
  | { kind: "stop"; status?: number; error: string };

/** The route's JSON body, or null when the response is not JSON. */
async function readJson(res: Response): Promise<Record<string, unknown> | null> {
  if (!(res.headers.get("content-type") ?? "").toLowerCase().includes("json")) return null;
  try {
    const body: unknown = await res.json();
    return typeof body === "object" && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function createFilesSink(opts: FilesSinkOptions): FilesSink {
  const endpoint = opts.endpoint ?? DEFAULT_ENDPOINT;
  const store = opts.store;
  const doFetch: typeof fetch = (input, init) => (opts.fetch ?? globalThis.fetch).call(globalThis, input, init);

  /** Latest unwritten entry per number. */
  const dirty = new Map<number, Entry>();
  /** What we believe is on disk: file path -> markdown, plus asset file names. */
  const known = new Map<string, string>();
  const knownAssets = new Set<string>();
  let isPaused = false;
  /** Auto-posting waits for `rehydrate()` so stale store copies cannot overwrite the disk. */
  let hydrated = false;
  let pendingList: readonly PendingFile[] = [];
  const listeners = new Set<() => void>();
  let queue: Promise<unknown> = Promise.resolve();

  const hasNumber = (n: number) => [...known.keys()].some((k) => k.startsWith(`entries/${pad(n)}-`));

  /** Rebuild `pendingList` from `dirty` (dropping entries that already match disk); notify on change. */
  function recompute(): void {
    const session = store.getState().session;
    const files: PendingFile[] = [];
    for (const [n, e] of [...dirty]) {
      try {
        const rel = entryPath(e);
        const names = assetNames(e.n, e.viewport);
        const before = files.length;
        if (known.get(rel) !== serialize(e, session)) files.push({ path: rel, change: hasNumber(e.n) ? "modify" : "add" });
        if (e.snapshot?.element && !knownAssets.has(names.element)) files.push({ path: `assets/${names.element}`, change: "add" });
        if (e.snapshot?.viewport && !knownAssets.has(names.viewport)) files.push({ path: `assets/${names.viewport}`, change: "add" });
        if (files.length === before) dirty.delete(n);
      } catch {
        // an entry that cannot be serialized is not ours to list
        dirty.delete(n);
      }
    }
    if (files.length) files.push({ path: "session.md", change: known.has("session.md") ? "modify" : "add" });
    const same = files.length === pendingList.length && files.every((f, i) => f.path === pendingList[i]?.path && f.change === pendingList[i]?.change);
    if (same) return;
    pendingList = files;
    for (const l of [...listeners]) {
      try {
        l();
      } catch {
        // a broken subscriber must not break the sink
      }
    }
  }

  /** Record that `entry` is now on disk. */
  function markWritten(e: Entry, session: Session): void {
    const rel = entryPath(e);
    for (const k of [...known.keys()]) if (k.startsWith(`entries/${pad(e.n)}-`)) known.delete(k); // renamed away
    known.set(rel, serialize(e, session));
    const names = assetNames(e.n, e.viewport);
    if (e.snapshot?.element) knownAssets.add(names.element);
    if (e.snapshot?.viewport) knownAssets.add(names.viewport);
    if (dirty.get(e.n) === e) dirty.delete(e.n);
    known.set("session.md", "");
  }

  /** The entry as sent: image data only for assets the disk does not have yet (the names stay in `assets`). */
  function slim(e: Entry): Entry {
    if (!e.snapshot) return e;
    const names = assetNames(e.n, e.viewport);
    const { element, viewport, ...rest } = e.snapshot;
    return {
      ...e,
      snapshot: {
        ...rest,
        ...(element && !knownAssets.has(names.element) ? { element } : {}),
        ...(viewport && !knownAssets.has(names.viewport) ? { viewport } : {}),
      },
    };
  }

  async function postOne(e: Entry, session: Session): Promise<PostOutcome> {
    try {
      const res = await doFetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", [HEADER]: "1" },
        body: JSON.stringify({ session, entry: slim(e) }),
      });
      if (res.status === 404) {
        isPaused = true;
        return { kind: "stop", status: 404, error: "The Proompter route is not available here (dev only)" };
      }
      const body = await readJson(res);
      if (res.ok) {
        if (body?.ok !== true) {
          // Some other server answered 2xx: not our route.
          isPaused = true;
          return { kind: "stop", status: res.status, error: "Unexpected response from the Proompter route" };
        }
        return { kind: "ok" };
      }
      const error = typeof body?.error === "string" ? body.error : `The route answered ${res.status}`;
      if (res.status >= 400 && res.status < 500 && body?.ok === false) return { kind: "rejected", status: res.status, error };
      return { kind: "stop", status: res.status, error };
    } catch (err) {
      return { kind: "stop", error: err instanceof Error ? err.message : "network error" };
    }
  }

  async function post(): Promise<WriteResult> {
    const files = pendingList.length;
    const todo = [...dirty.values()].sort((a, b) => a.n - b.n);
    if (todo.length === 0) return { ok: true, status: 200, files: 0 };
    const session = store.getState().session;
    let rejected: { status: number; error: string } | undefined;
    for (const e of todo) {
      const r = await postOne(e, session);
      if (r.kind === "ok") {
        isPaused = false;
        markWritten(e, session);
        recompute();
      } else if (r.kind === "rejected") {
        rejected ??= r;
      } else {
        return { ok: false, files, ...(r.status !== undefined ? { status: r.status } : {}), error: r.error };
      }
    }
    return rejected ? { ok: false, files, status: rejected.status, error: rejected.error } : { ok: true, status: 200, files };
  }

  const enqueue = (): Promise<WriteResult> => {
    const run = queue.then(post, post);
    queue = run.catch(() => {});
    return run;
  };

  const autoPost = () => {
    if (hydrated && !isPaused && pendingList.length) void enqueue();
  };

  const off = store.on((event) => {
    try {
      dirty.set(event.entry.n, event.entry);
      recompute();
      autoPost();
    } catch {
      // never throw into the store
    }
  });

  return {
    pending: () => pendingList,
    subscribe(l) {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    async write() {
      isPaused = false;
      try {
        return await enqueue();
      } catch (e) {
        return { ok: false, files: pendingList.length, error: e instanceof Error ? e.message : "write failed" };
      }
    },
    paused: () => isPaused,
    async idle() {
      let q: Promise<unknown>;
      do {
        q = queue;
        await q;
      } while (q !== queue);
    },
    dispose() {
      off();
      listeners.clear();
    },

    async rehydrate() {
      const result: RehydrateResult = { found: false, updated: 0, adopted: [] };
      try {
        await store.ready;
        if (opts.enabled === false) {
          isPaused = true; // preview/prod: no request until the user asks for one
        } else {
          const sid = store.getState().session.id;
          const res = await doFetch(`${endpoint}?session=${encodeURIComponent(sid)}`, { headers: { [HEADER]: "1" } });
          const body = res.status === 404 ? null : await readJson(res);
          if (!res.ok || body?.ok !== true) {
            isPaused = true; // 404, or not our route
          } else {
            const sessions = body.sessions as
              | { session: Session; assets?: string[]; entries: { path: string; markdown: string; entry: Entry }[] }[]
              | undefined;
            const found = sessions?.find((s) => s.session.id === sid);
            if (found) {
              result.found = true;
              known.set("session.md", "");
              for (const a of found.assets ?? []) knownAssets.add(a);
              for (const f of found.entries) known.set(f.path, f.markdown);
              const diskOnly: Entry[] = [];
              for (const f of found.entries) {
                const local = store.getState().entries.find((e) => e.n === f.entry.n);
                if (!local) {
                  diskOnly.push(f.entry);
                  continue;
                }
                const patch = diskPatch(local, f.entry);
                if (Object.keys(patch).length === 0) continue;
                await store.update(local.id, patch, "file");
                result.updated++;
              }
              if (diskOnly.length) result.adopted = await store.hydrate(diskOnly);
            }
          }
        }
      } catch {
        // offline or no route: stay as we are
      }
      // Everything the store has that disk does not match is pending (and auto-written in dev).
      for (const e of store.getState().entries) dirty.set(e.n, e);
      recompute();
      hydrated = true;
      autoPost();
      return result;
    },
  };
}
