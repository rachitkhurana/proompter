/**
 * A tiny in-memory stand-in for `indexedDB`, just the part `store.ts` uses: `open` with an upgrade step,
 * `createObjectStore` with a `keyPath`, and `put` / `getAll` inside transactions. Events fire from microtasks, so
 * handlers assigned right after the call are seen, like the real thing. Data survives `close()` and re-`open()` on
 * the same fake, which is what a page reload looks like.
 */

type Row = Record<string, unknown>;

interface StoreData {
  keyPath: string;
  rows: Map<unknown, Row>;
}
interface DbData {
  version: number;
  stores: Map<string, StoreData>;
}

export interface FakeIdbOptions {
  /** `open()` fires `onerror`. */
  failOpen?: boolean;
  /** `open()` throws synchronously (some browsers do, in private mode). */
  throwOnOpen?: boolean;
  /** `put()` aborts the transaction. */
  failWrites?: boolean;
  /** `open()` never answers (a blocked upgrade). */
  hang?: boolean;
}

const clone = <T>(v: T): T => (typeof structuredClone === "function" ? structuredClone(v) : (JSON.parse(JSON.stringify(v)) as T));

export interface FakeIdb {
  factory: IDBFactory;
  /** Rows currently stored: `rows("proompter", "entries")`. */
  rows(db: string, store: string): Row[];
  options: FakeIdbOptions;
  opens: number;
}

export function createFakeIdb(options: FakeIdbOptions = {}): FakeIdb {
  const dbs = new Map<string, DbData>();
  let lock: Promise<void> = Promise.resolve();
  const fake: FakeIdb = {
    options,
    opens: 0,
    rows: (db, store) => [...(dbs.get(db)?.stores.get(store)?.rows.values() ?? [])].map(clone),
    factory: {
      open(name: string, version = 1) {
        fake.opens++;
        if (fake.options.throwOnOpen) throw new Error("indexedDB is not available");
        const req: Record<string, unknown> = { result: undefined, error: null };
        if (fake.options.hang) return req as unknown as IDBOpenDBRequest;
        queueMicrotask(() => {
          if (fake.options.failOpen) {
            (req.onerror as (() => void) | undefined)?.();
            return;
          }
          let data = dbs.get(name);
          const upgrading = !data || data.version < version;
          if (!data) {
            data = { version, stores: new Map() };
            dbs.set(name, data);
          }
          const d = data;
          const db = {
            objectStoreNames: { contains: (s: string) => d.stores.has(s) },
            createObjectStore(s: string, opts: { keyPath: string }) {
              d.stores.set(s, { keyPath: opts.keyPath, rows: new Map() });
            },
            close() {},
            transaction(storeName: string, mode = "readonly") {
              const store = d.stores.get(storeName);
              if (!store) throw new Error(`NotFoundError: no object store '${storeName}'`);
              const tx: Record<string, unknown> = {};
              let pending = 0;
              let aborted = false;
              let finished = false;
              // Readwrite transactions run one at a time, like the real thing (this is what makes two "tabs" safe).
              let release: () => void = () => {};
              const done = new Promise<void>((r) => (release = r));
              const gate = mode === "readwrite" ? lock : Promise.resolve();
              if (mode === "readwrite") lock = gate.then(() => done);
              const finish = () => {
                if (finished) return;
                finished = true;
                release();
                (aborted ? (tx.onabort as (() => void) | undefined) : (tx.oncomplete as (() => void) | undefined))?.();
              };
              tx.abort = () => {
                aborted = true;
                queueMicrotask(finish);
              };
              /** Requests run their work now, answer from a microtask, and the transaction ends when none are left. */
              const request = (work: () => unknown) => {
                const r: Record<string, unknown> = { result: undefined };
                pending++;
                void gate.then(() => {
                  if (!aborted) {
                    try {
                      r.result = work();
                      (r.onsuccess as (() => void) | undefined)?.();
                    } catch {
                      aborted = true;
                    }
                  }
                  pending--;
                  if (pending === 0) queueMicrotask(() => queueMicrotask(finish));
                });
                return r;
              };
              tx.objectStore = () => ({
                put: (value: Row) =>
                  request(() => {
                    if (fake.options.failWrites) throw new Error("write failed");
                    const key = value[store.keyPath];
                    store.rows.set(key, clone(value));
                    return key;
                  }),
                add: (value: Row) =>
                  request(() => {
                    if (fake.options.failWrites) throw new Error("write failed");
                    const key = value[store.keyPath];
                    if (store.rows.has(key)) throw new Error("ConstraintError: key exists");
                    store.rows.set(key, clone(value));
                    return key;
                  }),
                getAll: () => request(() => [...store.rows.values()].map(clone)),
              });
              return tx;
            },
          };
          req.result = db;
          if (upgrading) {
            d.version = version;
            (req.onupgradeneeded as (() => void) | undefined)?.();
          }
          (req.onsuccess as (() => void) | undefined)?.();
        });
        return req as unknown as IDBOpenDBRequest;
      },
    } as unknown as IDBFactory,
  };
  return fake;
}
