/**
 * The default dependencies of `<Proompter>`: where the real store, serializer and composer plug in.
 * Only the lazy UI chunk imports this file.
 */
import type { ProompterDeps, ProompterProps } from "../proompter-deps";
import { createFakeDeps, SEED_SESSION } from "./fake";

/**
 * INTEGRATION(T07): replace the body with T07's real modules, e.g.
 *
 *   const store = createEntryStore({ session: options.session, plugins: options.plugins, ... });
 *   return {
 *     store,                                        // must satisfy EntryStore (see proompter-deps.ts)
 *     serialize,                                    // (entry, session) => markdown, from core/serialize
 *     entryPath: (e, s) => `reviews/${s.id}/entries/${entryFileName(e)}`,
 *     composer: (p) => <Composer {...adapt(p)} store={store} />,
 *   };
 *
 * Until then the in-memory fake keeps the kit usable end to end (entries last until the page reloads).
 */
export function createDefaultDeps(options: ProompterProps): ProompterDeps {
  const { reviewer, title } = options.session ?? {};
  const session = {
    ...SEED_SESSION,
    ...(reviewer ? { reviewer } : {}),
    ...(title ? { title } : {}),
  };
  return createFakeDeps({ entries: [], session });
}
