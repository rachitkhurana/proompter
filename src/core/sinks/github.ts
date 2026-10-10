/**
 * The GitHub sink (DESIGN D16): sends entries to the host's GitHub route (`createGithubRoute` from
 * `@rachitkay/proompter/github`, mounted at e.g. `/api/proompter/github`) and brings issue state back.
 *
 * This file runs in the browser. It imports nothing from `src/github` or `src/server`, and it only ever sees the
 * review key (a shared secret the reviewer types once), never the GitHub token.
 *
 * `sync()`, one run at a time:
 * 1. `GET ?session=ID`. An issue that is closed on GitHub marks its entry resolved (`store.resolve(id, "github")`),
 *    unless the entry has local changes since the last sync (local wins, and the POST below reopens the issue).
 *    After a reload nothing is known to be local, so GitHub wins.
 * 2. `POST` every entry that changed since its last sync, one per request. The issue number the route answers is
 *    stored with `store.update(id, { issue }, "github")`. Image data is sent once per entry and page load.
 *
 * Errors never throw into the host: 401 sets `needsKey` (the UI asks for the key, stores it and syncs again),
 * 404 means "GitHub sync isn't set up on this server", anything else is the route's message.
 */
import type { Entry } from "../entry";
import { assetNames, serialize } from "../serialize";
import type { EntryStore } from "../store";

export const DEFAULT_GITHUB_ENDPOINT = "/api/proompter/github";
/** Where the UI keeps the review key (per origin). */
export const REVIEW_KEY_STORAGE = "proompter:review-key";
/** Must match `PROOMPTER_HEADER` in `src/server/validate.ts` (kept apart so this chunk never imports node code). */
const HEADER = "x-proompter";
const NOT_SET_UP = "GitHub sync isn't set up on this server";

export interface GithubSinkOptions {
  endpoint?: string;
  store: EntryStore;
  /** The review key, read for every request. */
  key: () => string | null;
  fetch?: typeof fetch;
}

export interface GithubSyncResult {
  ok: boolean;
  /** Entries sent. */
  synced: number;
  /** Entries marked resolved because their issue was closed on GitHub. */
  resolved: number;
  status?: number;
  error?: string;
  /** 401: the review key is missing or wrong. */
  needsKey?: boolean;
}

export interface GithubSink {
  sync(): Promise<GithubSyncResult>;
  /** Ids of entries not yet sent in their current state. Same array until it changes. */
  pending(): readonly string[];
  /** Issue URL per entry id, for the entries synced in this page load. Same object until it changes. */
  urls(): Readonly<Record<string, string>>;
  subscribe(listener: () => void): () => void;
  /** Message of the last failed `sync()`, else null. */
  readonly lastError: string | null;
  /** The last `sync()` was refused with 401. */
  readonly needsKey: boolean;
  dispose(): void;
}

type Outcome = { kind: "ok"; issue: string; url: string } | { kind: "skip"; error: string } | { kind: "stop"; status?: number; error: string };

async function readJson(res: Response): Promise<Record<string, unknown> | null> {
  if (!(res.headers.get("content-type") ?? "").toLowerCase().includes("json")) return null;
  try {
    const body: unknown = await res.json();
    return typeof body === "object" && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function createGithubSink(opts: GithubSinkOptions): GithubSink {
  const endpoint = opts.endpoint ?? DEFAULT_GITHUB_ENDPOINT;
  const store = opts.store;
  const doFetch: typeof fetch = (input, init) => (opts.fetch ?? globalThis.fetch).call(globalThis, input, init);
  /**
   * entry id -> the entry's file text as last sent. (`updated` only has second resolution, and the file text is
   * what the branch and the issue are made of: it changes exactly when there is something to send.)
   */
  const synced = new Map<string, string>();
  const mark = (e: Entry): string => {
    try {
      return serialize(e, store.getState().session);
    } catch {
      return `${e.id}@${e.updated}`;
    }
  };
  const imagesSent = new Set<string>();
  let urlMap: Readonly<Record<string, string>> = {};
  let pendingList: readonly string[] = [];
  let error: string | null = null;
  let needsKey = false;
  let running: Promise<GithubSyncResult> | null = null;
  const listeners = new Set<() => void>();

  const notify = () => {
    for (const l of [...listeners]) {
      try {
        l();
      } catch {
        // a broken subscriber must not break the sink
      }
    }
  };

  function recompute(): void {
    const next = store.getState().entries.filter((e) => synced.get(e.id) !== mark(e)).map((e) => e.id);
    if (next.length === pendingList.length && next.every((id, i) => id === pendingList[i])) return;
    pendingList = next;
    notify();
  }
  const offStore = store.subscribe(recompute);
  recompute();

  const headers = (json: boolean): Record<string, string> => {
    const key = opts.key();
    return { [HEADER]: "1", ...(json ? { "content-type": "application/json" } : {}), ...(key ? { authorization: `Bearer ${key}` } : {}) };
  };

  /** The entry as sent: image data only the first time (the names stay in `assets`). */
  function slim(e: Entry): Entry {
    if (!e.snapshot) return e;
    const names = assetNames(e.n, e.viewport);
    const { element, viewport, ...rest } = e.snapshot;
    const send = !imagesSent.has(e.id);
    return {
      ...e,
      snapshot: {
        ...rest,
        assets: {
          ...(element || rest.assets?.element ? { element: names.element } : {}),
          ...(viewport || rest.assets?.viewport ? { viewport: names.viewport } : {}),
        },
        ...(send && element ? { element } : {}),
        ...(send && viewport ? { viewport } : {}),
      },
    };
  }

  /** Map a failed response to what the caller should do. */
  async function failure(res: Response): Promise<{ status: number; error: string; scope: string | undefined }> {
    const body = await readJson(res);
    const scope = body?.ok === false && typeof body.scope === "string" ? body.scope : undefined;
    if (res.status === 404) return { status: 404, error: NOT_SET_UP, scope };
    if (res.status === 401) return { status: 401, error: "Enter the review key to sync with GitHub", scope };
    return { status: res.status, error: typeof body?.error === "string" ? body.error : `The route answered ${res.status}`, scope };
  }

  async function postOne(e: Entry): Promise<Outcome> {
    try {
      const res = await doFetch(endpoint, { method: "POST", headers: headers(true), body: JSON.stringify({ session: store.getState().session, entry: slim(e) }) });
      if (!res.ok) {
        const f = await failure(res);
        return f.scope === "entry" ? { kind: "skip", error: f.error } : { kind: "stop", status: f.status, error: f.error };
      }
      const body = await readJson(res);
      if (body?.ok !== true || typeof body.issue !== "string") return { kind: "stop", status: res.status, error: NOT_SET_UP };
      return { kind: "ok", issue: body.issue, url: typeof body.url === "string" ? body.url : "" };
    } catch (err) {
      return { kind: "stop", error: err instanceof Error ? err.message : "network error" };
    }
  }

  async function run(): Promise<GithubSyncResult> {
    const result: GithubSyncResult = { ok: true, synced: 0, resolved: 0 };
    const stop = (status: number | undefined, message: string): GithubSyncResult => {
      error = message;
      needsKey = status === 401;
      return { ...result, ok: false, ...(status !== undefined ? { status } : {}), error: message, ...(needsKey ? { needsKey: true } : {}) };
    };
    try {
      await store.ready;
      const sid = store.getState().session.id;

      // 1. Issues closed on GitHub resolve their entries.
      const res = await doFetch(`${endpoint}?session=${encodeURIComponent(sid)}`, { headers: headers(false) });
      if (!res.ok) {
        const f = await failure(res);
        return stop(f.status, f.error);
      }
      const listing = await readJson(res);
      if (listing?.ok !== true || !Array.isArray(listing.issues)) return stop(res.status, NOT_SET_UP);
      const nextUrls = { ...urlMap };
      for (const raw of listing.issues as unknown[]) {
        if (typeof raw !== "object" || raw === null) continue;
        const i = raw as { n?: unknown; state?: unknown; url?: unknown };
        const entry = store.getState().entries.find((e) => e.n === i.n);
        if (!entry) continue;
        if (typeof i.url === "string") nextUrls[entry.id] = i.url;
        const changedLocally = synced.has(entry.id) && synced.get(entry.id) !== mark(entry);
        if (i.state === "closed" && entry.status !== "resolved" && !changedLocally) {
          await store.resolve(entry.id, "github");
          result.resolved++;
        }
      }
      urlMap = nextUrls;

      // 2. Entries that changed since their last sync go up, one request each.
      const todo = store.getState().entries.filter((e) => synced.get(e.id) !== mark(e));
      let skipped: string | null = null;
      for (const e of todo) {
        const out = await postOne(e);
        if (out.kind === "stop") return stop(out.status, out.error);
        if (out.kind === "skip") {
          skipped ??= out.error;
          continue;
        }
        if (e.issue !== out.issue) await store.update(e.id, { issue: out.issue }, "github");
        // What was sent (plus its issue number), not the store's entry as it is now: an edit made while the
        // request was in flight differs from this and stays pending.
        synced.set(e.id, mark({ ...e, issue: out.issue }));
        imagesSent.add(e.id);
        if (out.url) urlMap = { ...urlMap, [e.id]: out.url };
        result.synced++;
      }
      error = skipped;
      needsKey = false;
      return skipped ? { ...result, ok: false, error: skipped } : result;
    } catch (err) {
      return stop(undefined, err instanceof Error ? err.message : "sync failed");
    }
  }

  return {
    sync() {
      running ??= run().finally(() => {
        running = null;
        recompute();
        notify();
      });
      return running;
    },
    pending: () => pendingList,
    urls: () => urlMap,
    subscribe(l) {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    get lastError() {
      return error;
    },
    get needsKey() {
      return needsKey;
    },
    dispose() {
      offStore();
      listeners.clear();
    },
  };
}
