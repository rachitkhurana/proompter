# T05 Dock

**Owns:** `src/ui/dock/**`, `src/core/spring.ts`, its stories and tests.

**Do:** DESIGN §7, Dock, matching the prototype exactly.
- **Dragging:** 1:1 under the pointer from the grab offset, rubber-banding past the edges, velocity
  projection on release, snapping to an edge as a vertical bar.
- **Keyboard:** arrow-key steps on the grip; double-click resets.
- **Collapse:** click the brand (a click is under 4px of movement) to collapse or expand, with grid
  0fr↔1fr width/height animation, a corner badge when vertical, and Enter/Space on the brand.
- **Saved:** position and collapsed state in `localStorage`. Wrap every read and write in try/catch.
- **Layout follows the dock:**
  - tooltips open away from the edge
  - toasts move to the opposite end of the screen
  - the multi-select bar sits next to the dock
  - the sheet opens on the side away from the dock
- **Reduced motion:** opacity only.
- **Spring (DESIGN §2 D1, no `motion` dependency):** `src/core/spring.ts`, ~50 lines: damping 1.0,
  response 0.35, velocity handoff from the drag, rAF-driven, cancellable, honours reduced motion.
  Unit-tested. Use it for release and edge snap; everything else uses CSS transitions or WAAPI.

**Done when:** there are stories for horizontal, vertical-left, vertical-right, collapsed and
collapsed-vertical (with a badge), and a Playwright test covers drag, edge snap and collapse.
