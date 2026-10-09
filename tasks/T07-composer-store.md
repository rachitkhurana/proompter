# T07 Composer, store and serializer

**Owns:** `src/core/store.ts` (entries plus IndexedDB persistence), `src/core/serialize.ts`
(markdown in and out, DESIGN §8), `src/core/plugins.ts`, `src/ui/composer/**`, tests and stories.

**Do:**
- Entry and Session types, exactly as in the DESIGN §8 frontmatter.
- `serialize` and `parse` must round-trip.
- Composer (DESIGN §7):
  - anchored to the target and growing out of it, kept clear of the dock
  - title is required, with an inline error
  - property chips with menus: Intent, Priority, Tags (multi), Test plan (from plugins), and a
    read-only Task chip from plugins
  - a collapsible context block
  - `⌘↵` saves, Esc discards
- **On save:**
  - capture context and a snapshot
  - persist to IndexedDB
  - emit `entry:created` for the files sink (T09)
  - show the toast "PRO-n saved on <viewport> · entries/NNN-slug.md"

**Done when:** serializer tests cover every field and the round trip, and there are composer stories
for the element, inherited, multi, box, text and note cases.
