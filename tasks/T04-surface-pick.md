# T04 Surface, viewports and pick engine

**Owns:** `src/core/surface.ts`, `src/core/resolve.ts`, `src/core/pick.ts`, `src/ui/overlay/**`
(hover box, label, selection boxes, box-select catcher, pins), `src/ui/viewports/**`, tests.

**Do:**
- `Surface` (DESIGN §6): it's responsive by default (the live page). Device modes use a same-origin
  iframe with `?__proompter_frame=1`, a bezel, fit-scale and rotate. Expose `toScreen()`.
- `resolveTarget` (DESIGN §4): deepest element, inherited source, unique selector, label and crumb.
- Pick modes:
  - pick
  - multi (numbered selections plus the "N selected · Add entry" bar)
  - box (only the topmost matches)
  - text (quote)
  - note (page level)
  - Esc exits
- Tree walk with `↑`/`[` and `↓`/`]`, plus Alt-wheel. The label shows `↳` for an inherited source.
- Freeze: pause animations and videos inside the surface.
- Pins: anchored by selector, shown on their own viewport only, offset when several share a spot, pop
  in only once, pulse on "Show on page".

**Done when:**
- Unit tests cover the resolver and the selector's uniqueness (including duplicate stamped components
  and nth-of-type).
- A Playwright test picks an avatar inside a card on Responsive and on Mobile.
