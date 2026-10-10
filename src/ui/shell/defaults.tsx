/**
 * The default dependencies of `<Proompter>`: T07's store, serializer and composer, behind the small
 * `EntryStore` seam the sheet, ticket and command menu use (`../proompter-deps.ts`).
 * Only the lazy UI chunk imports this file.
 */
import { serialize, entryPath as entryFile } from "../../core/serialize";
import { createStore, type EntryStore as CoreStore, type StoreState as CoreState } from "../../core/store";
import { Composer } from "../composer";
import type { EntryStore, PendingFile, ProompterDeps, ProompterProps, StoreState } from "../proompter-deps";

/**
 * INTEGRATION(T09): the files sink knows what has not been written yet. Until it is wired in, nothing is
 * pending and the Publish tab says so (`write` is absent, so its button stays disabled).
 */
const PENDING: readonly PendingFile[] = [];

/** T07's store as the root's `EntryStore`: same data, `pending` added, and `update`/`resolve` fire and forget. */
export function adaptStore(store: CoreStore): EntryStore {
  let last: CoreState | undefined;
  let snap: StoreState | undefined;
  return {
    getSnapshot() {
      const s = store.getState();
      if (!snap || s !== last) {
        last = s;
        snap = { session: s.session, entries: s.entries, pending: PENDING };
      }
      return snap;
    },
    subscribe: store.subscribe,
    // The store logs the change in `activity` itself, so nothing is added here.
    update(id, patch, who) {
      void store.update(id, patch, who);
    },
    resolve(id, who) {
      void store.resolve(id, who);
    },
  };
}

export function createDefaultDeps(options: ProompterProps): ProompterDeps {
  const core = createStore({
    session: { title: options.session?.title ?? "Review", reviewer: options.session?.reviewer ?? "reviewer" },
    plugins: options.plugins,
  });
  return {
    store: adaptStore(core),
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
