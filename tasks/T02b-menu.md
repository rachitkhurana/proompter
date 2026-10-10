# T02b Hand-built Menu (drop Radix)

**Owns:** `src/ui/primitives/menu.tsx`, `src/ui/primitives/menu.test.tsx`, `src/ui/primitives/menu.stories.tsx`,
`package.json` (removing `@radix-ui/react-dropdown-menu` only).

**Why:** DESIGN §2 D5. Radix Menu inserts focus guards into the host `document.body`, which breaks §1.2.

**Do:**
- Replace the Radix DropdownMenu inside `Menu` with a hand-built menu. Keep the **same public API**, so T07
  (composer) and T08 (ticket, root) don't change.
- Roles: `menu`, `menuitem` and `menuitemcheckbox` (multi), and `aria-expanded`/`aria-haspopup` on the trigger.
- Keyboard: arrows, Home/End, typeahead, Enter/Space select, Esc and Tab close, focus returns to the trigger.
- Dismiss on an outside pointerdown inside the shadow root (and on the host page).
- Side-aware placement with flip, and origin-aware scale-in, matching the prototype's numbers. Portal into
  the shadow container.
- Single and multi select (a multi menu stays open).
- Remove the focus-guard removal code. The host-untouched test in `proompter.test.tsx` must pass without it.

**Done when:**
- All existing Menu tests and stories pass, plus composer, ticket and root tests.
- axe is clean, and the e2e suite passes.
- `@radix-ui/react-dropdown-menu` is gone from `package.json` and the lockfile, and nothing imports
  `@radix-ui`.
