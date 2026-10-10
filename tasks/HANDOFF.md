# Handoff: Proompter v1 (paused 2026-10-10)

Paused on request (Rachit is going to sleep). Nothing is running. Nothing has been pushed and no PR is open.

## Where things are

- **Integration branch:** `v1`. Its tip is the commit that adds this file, on top of `d4241de` (Merge T08).
- **Last full-suite run on the `v1` code (batch-3 merge):**
  - typecheck and lint: green
  - 628 unit tests: green (1 skipped, the §11.7 release check)
  - build: green. The entry `dist/index.js` is 152 B, and fonts are only in a lazy chunk.
  - 26 e2e (dock, pick, smoke, keyboard): green
  - storybook build: green

| Task | State | Merged at |
| --- | --- | --- |
| T01 scaffold | merged | `7ac249a` |
| T02 UI kit | merged | `cc1cc60` |
| T03 loader | merged | `ee4ce6e` |
| T06 capture | merged | `d0ecbb6` |
| T05 dock | merged | `521d303` |
| T04 surface, viewports, pick | merged | `96d9ef9` |
| T07 composer, store, serializer | merged | `f859830` |
| T08 sheet, ticket, command, root, plus the T07 integration | merged | `d4241de` |
| **T02b** hand-built Menu (drop Radix) | **in progress, NOT merged** | branch `t02b` |
| T09 dev route and files sink | not started | |
| T10 playground, e2e, docs | not started | |

## T02b state

- **Branch:** `t02b`. Worktree: `.claude/worktrees/t02b`. Last commit: `2dbd44d` (a WIP commit).
- **Done:**
  - Radix is replaced by a hand-built `Menu` in `src/ui/primitives/menu.tsx`, with the same API.
  - `@radix-ui/react-dropdown-menu` is removed from `package.json` and the lockfile, and nothing references `@radix-ui`.
  - The focus-guard workaround is deleted.
- **Last checks on that branch:**
  - typecheck, lint: green
  - 635 unit tests: green
  - 26 e2e: green
  - storybook build: green
- **Left: the Sonnet critic's findings. None of these is started.**
  1. **Tab:** close, then focus the trigger *without* `preventDefault`, so the browser's own Tab moves on. Invert the test at `menu.test.tsx:173-180`.
  2. **`closeMenu` in `src/ui/shell/ui.tsx:267`:** use `[role="menu"]:not([data-state="closed"])`. This is a one-line ownership exception in T08's file, already granted.
  3. **Scrolling:** add a capture `scroll` listener on the shadow root while the menu is open, and a `ResizeObserver` on the menu to reposition it.
  4. **Placement:** use `documentElement.clientWidth/clientHeight` instead of `innerWidth/innerHeight`.
  5. **Stronger tests:**
     - Host-untouched: check `head`, the `body`/`html` attributes and styles, and the `document`/`window` listeners. Exclude React's own `selectionchange` listener.
     - Cover open→close, unmount while open, unmount mid-exit, and StrictMode.
     - Add a listener-removal test that matches the handler and the capture flag.
     - Add a real exit-animation test: stub `getComputedStyle`, plus the 250ms fallback.
     - Cover typeahead timeout and cycling, skipping disabled items, Esc's `defaultPrevented`, unique ids, flip and clamp. Mock the client and offset sizes; they are 0 in happy-dom.
  6. **Small items:**
     - ignore `e.repeat` for Enter and Space;
     - `stopPropagation` handled keys, and `preventDefault` a Space that misses the typeahead;
     - `.mh` gets `role="presentation"`;
     - fall back to another focus target if the trigger is gone;
     - when neither side fits, use the side with more room plus `max-height`.
- **To finish:** apply 1–6, run the full suite, then merge `t02b` → `v1`.

## Next steps (in order)

1. **T02b:** finish the critic fixes above, run the full suite, merge.
2. **T09:** the dev route (`src/next/route.ts`) and the files sink (`src/core/sinks/files.ts`).
   - Wire the Publish tab's `pending`/`write()` at the single `// INTEGRATION(T09)` marker in `src/ui/shell/defaults.tsx`.
   - Use T07's `entryPath`, `snapshot.assets` and `serialize`/`parse`.
3. **T10:**
   - Port the prototype's mock page into the playground.
   - Write the §11 e2e, including the real store end to end. The keyboard fixture uses the fake store.
   - Add visual snapshots.
   - Write the README, with a "Node 22.18+" requirements line and the Geist OFL note, and `docs/gamorite.md`.
   - Remove or gate `./internal/fixtures` so §11.7 passes.

## Rulings to carry (all in `DESIGN.md`)

- **D1** dependencies: no `motion`, plus the in-house spring (`src/core/spring.ts`). Its Radix part is superseded by D5.
- **D1.3**
  - `@jridgewell/remapping` is a runtime dependency.
  - `engines.node >=22.18`.
  - The loader guard for `ERR_REQUIRE_ESM`.
  - TypeScript is pinned to 5.9.x.
- **D2** UI kit:
  - tokens on `.pp`;
  - namespaced Geist fonts through the single `<style data-proompter-fonts>`, the only change allowed to the host (§1.2);
  - toasts pause on hover;
  - priorities are `blocking | important | minor`;
  - `@storybook/addon-a11y`.
- **D3** file format v1:
  - `kind:` is always written;
  - `ref: <session>/PRO-n`;
  - a Targets section, quotes, and `source: null` for notes;
  - every console line is listed;
  - chips are hidden when no plugin supplies them;
  - redaction fails closed, with the built-in pass running first.
- **D4**
  - the ticket's Viewport is read-only;
  - capture starts at mount, after idle;
  - ⌘K is non-modal.
- **D5** no Radix at all (task T02b). Runtime dependencies end at five: `@babel/parser`, `magic-string`, `@jridgewell/remapping`, `html-to-image`, `bippy`.
- **§11.7** published `exports` are exactly `.`, `./next`, `./next/route`, `./github`, `./package.json` under `PROOMPTER_RELEASE=1`. `src/internal/exports.test.ts` enforces this, and T10 makes it pass.

## Process notes

- **Worker worktrees:** `isolation: "worktree"` cuts from `main`, not from `v1`. Create worktrees by hand with `git worktree add .claude/worktrees/<t> -b <t> v1` and check HEAD before dispatching work.
- **Unicode in sub-agent edits:** escapes like `\uXXXX` can turn into raw characters. Run `grep -rnP '[\x{2028}\x{2029}\x{0085}\x{FEFF}]' src` before merging.
- **Commits:** only the orchestrator commits, one commit per file with the `T0N:` prefix. Runners only run checks. Never push.
