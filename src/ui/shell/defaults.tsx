/**
 * The default dependencies of `<Proompter>`: T07's store, serializer and composer, behind the small
 * `EntryStore` seam the sheet, ticket and command menu use (`../proompter-deps.ts`).
 * Only the lazy UI chunk imports this file.
 */
import { createFilesSink, DEFAULT_ENDPOINT, type FilesSink } from "../../core/sinks/files";
import { serialize, entryPath as entryFile } from "../../core/serialize";
import { createStore, type EntryStore as CoreStore, type StoreState as CoreState } from "../../core/store";
import { Composer } from "../composer/composer";
import type { EntryStore, PendingFile, ProompterDeps, ProompterProps, StoreState } from "../proompter-deps";

const NO_PENDING: readonly PendingFile[] = [];
const HYDRATE_WAIT_MS = 2000;

/**
 * T07's store as the root's `EntryStore`: same data, `update`/`resolve` fire and forget.
 * With a files sink, `pending` is the sink's list and `write` flushes it; without one
 * nothing is pending and `write` is absent (the Publish button stays disabled).
 */
export function adaptStore(store: CoreStore, sink?: FilesSink): EntryStore {
  let last: CoreState | undefined;
  let lastPending: readonly PendingFile[] | undefined;
  let snap: StoreState | undefined;
  return {
    getSnapshot() {
      const s = store.getState();
      const pending = sink ? sink.pending() : NO_PENDING;
      if (!snap || s !== last || pending !== lastPending) {
        last = s;
        lastPending = pending;
        snap = { session: s.session, entries: s.entries, pending };
      }
      return snap;
    },
    subscribe(listener) {
      const offStore = store.subscribe(listener);
      const offSink = sink?.subscribe(listener);
      return () => {
        offStore();
        offSink?.();
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
  };
}

export function createDefaultDeps(options: ProompterProps): ProompterDeps {
  // A new entry is numbered only after the disk has been read (`sink.hydrated`), so it can never take a number
  // that already exists in `reviews/`. Capped at 2 s in case the route hangs.
  // eslint-disable-next-line prefer-const -- assigned after the store exists; the store's beforeCreate closure reads it
  let sink: FilesSink | undefined;
  const core = createStore({
    session: { title: options.session?.title ?? "Review", reviewer: options.session?.reviewer ?? "reviewer" },
    plugins: options.plugins,
    beforeCreate: () => (sink ? Promise.race([sink.hydrated, new Promise<void>((r) => setTimeout(r, HYDRATE_WAIT_MS))]) : undefined),
  });
  // Outside dev there is no route: `enabled: false` skips the GET (no failing request in the host's console).
  sink = createFilesSink({
    endpoint: options.endpoint ?? DEFAULT_ENDPOINT,
    store: core,
    enabled: process.env.NODE_ENV === "development",
  });
  void sink.rehydrate();
  return {
    store: adaptStore(core, sink),
    serialize: (entry, session) => serialize(entry, session),
    entryPath: (entry, session) => `reviews/${session.id}/${entryFile(entry)}`,
    composer: (p) =>
      p.surface ? (
        <Composer
          ref={p.discardRef}
          handleEscape={false}
          toast={false}
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
