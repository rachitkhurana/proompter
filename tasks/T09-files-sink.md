# T09 Dev route and files sink

**Owns:** `src/next/route.ts` (exported as `@rachitkay/proompter/next/route`), `src/core/sinks/files.ts`, tests.

**Do:** DESIGN §8.
- `POST` writes or updates `session.md`, `entries/NNN-slug.md` and `assets/*.png` under `<cwd>/reviews/`.
  - It refuses unless `NODE_ENV === "development"`, and refuses any path outside `reviews/`.
  - A renamed title moves the file (and rewrites the asset links).
- `GET` lists the sessions and entries on disk, so a reload rehydrates the store. Disk wins over
  IndexedDB for anything already written.
- The client sink calls the route on `entry:created` and `entry:updated`.
  - The Publish tab's "Write N files" flushes anything pending.
  - If the route returns 404 (preview or prod), entries stay pending.

**Done when:**
- Tests cover path traversal, the dev-only guard, rename, and rehydrate.
- In the playground, saving an entry produces the files on disk, and they parse back.
