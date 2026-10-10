# T04b Keyboard picking (DESIGN §2 D8)

**Owns:** `src/core/pick.ts`, `src/ui/overlay/**` (an aria-live announcer), the pick wiring in
`src/ui/shell/ui.tsx`, the tests for these, and `e2e/keyboard-pick.spec.ts`.

**Do:** implement D8 exactly. Keys must work on the live page and inside device frames, where they are
forwarded. Nothing moves host focus or scroll. Never pick the kit's own UI.

**Done when:**
- Unit tests cover every key, the start target, sibling and parent/child walking, preventDefault, and the
  announcer.
- The e2e runs keyboard-only on Responsive and on Mobile: `P` → avatar → `Enter` → `⌘↵` →
  `reviews/<session>/entries/001-*.md` on disk with the avatar's `source`.
- The suite is green, axe is clean, and §11.4 isolation still passes.
