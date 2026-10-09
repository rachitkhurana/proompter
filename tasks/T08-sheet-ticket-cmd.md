# T08 Sheet, ticket and command menu

**Owns:** `src/ui/sheet/**`, `src/ui/ticket/**`, `src/ui/command/**`, `src/ui/proompter.tsx` (the root
component composing every part), stories and tests.

**Do:** DESIGN §7.
- **Sheet:** the Entries tab (grouped list) and the Publish tab (the file tree of pending writes; the
  issues section shows "v2").
- **Ticket:** every section in DESIGN §7, with every property editable from a menu.
  - Snapshot with an Element/Viewport toggle.
  - Console and Network tabs, Activity, and the markdown preview.
  - Footer: Show on page, Copy for agent, Resolve.
- **Command menu (`⌘K`):** search, arrow keys, sections.
- **Global shortcuts and the Esc order,** including inside the viewport iframe (forward key events
  from the frame).
- **`window.__proompter`:** open, close, toggle, entries.

**Done when:** there are stories for an empty list, a populated list, a ticket for each status, a
ticket without a snapshot ("Show on mobile"), the command menu filtered, and the publish tab. A
keyboard-only Playwright pass works.
