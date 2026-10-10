# Handoff: Proompter v1 (close-out, 2026-10-10)

All v1 tasks are merged into `v1`, locally only: nothing has been pushed, no PR has been opened and nothing has been published.

## State

- **Integration branch:** `v1`. Its tip is the commit that adds this file, on top of `42be86b` (the merged simplification pass).
- **Last full green run** (the simplification branch, merged as-is):

  | Check | Result |
  | --- | --- |
  | Typecheck, lint, build | pass |
  | Unit tests | 813 pass (2 skipped, both release-only) |
  | Playwright e2e | 53 pass, one worker |
  | Storybook build | pass |
  | Release sequence | pass (see below) |
  | Special-character scan | clean |

  The release sequence is: strip, then the exports test, then `prepack`, then `npm pack --dry-run`, then `check-pack`. The tarball has 42 files and exactly `.`, `./github`, `./next`, `./next/route` and `./package.json`. It includes `licenses/Geist-OFL.txt` and has no `dist/internal`.

| Task | Merged |
| --- | --- |
| T01 scaffold | `7ac249a` |
| T02 UI kit | `cc1cc60` |
| T03 loader | `ee4ce6e` |
| T06 capture | `d0ecbb6` |
| T05 dock | `521d303` |
| T04 surface, viewports, pick | `96d9ef9` |
| T07 composer, store, serializer | `f859830` |
| T08 sheet, ticket, command, root | `d4241de` |
| T02b hand-built Menu (no Radix) | `badc308` |
| T09 dev route + files sink | `eeca4d2` |
| T10 playground, e2e, docs, release gate | `0920721` |
| T04b keyboard picking | `3225a28` |
| Simplification pass (D9) | `42be86b` |

## DESIGN §11 acceptance

| # | Proof |
| --- | --- |
| 1 | `e2e/production.spec.ts`, against a production build with the flag unset. It checks no `data-src` and no Proompter marker anywhere in the transitive chunk closure of "/", and `/api/proompter` returns 404 and writes nothing. |
| 2 | `e2e/flow.spec.ts` 11.2, using the real store, serializer and route. Pick → ⌘↵ → `entries/001-*.md` plus both PNGs, parsed back with `parse()`. |
| 3 | `flow.spec` 11.3 on Tablet and Mobile. The pin shows only on its own viewport. |
| 4 | `e2e/isolation.spec.ts` covers both directions. |
| 5 | `e2e/a11y.spec.ts` runs axe and the reduced-motion check. `keyboard.spec.ts` and `keyboard-pick.spec.ts` cover keyboard-only use. `src/ui/contrast.test.ts` proves token contrast where axe can't judge. |
| 6 | Unit tests for the resolver, selector uniqueness, redaction (including an exhaustive secret test), serializer round-trips, and loader plus source maps. |
| 7 | `src/internal/exports.test.ts` under `PROOMPTER_RELEASE=1`, plus `release-exports.mjs check-pack` in CI. |

## Dependencies (final)

- **Runtime (5):**
  - `@babel/parser` 8.0.7
  - `@jridgewell/remapping` 2.3.5
  - `bippy` 0.7.3
  - `html-to-image` 1.11.13
  - `magic-string` 1.4.3
- **Peer:** `react >=19`, `react-dom >=19`, `next >=15.3` (optional).
- **Engines:** `node >=22.18`.
- **Dev:** see `package.json`. Additions beyond T01's set:
  - `@axe-core/playwright` 4.13.0
  - `@storybook/addon-a11y` 10.6.1
  - `@fontsource-variable/geist` and `@fontsource-variable/geist-mono` 5.3.0
  - `@jridgewell/trace-mapping` 0.3.31
- No `motion` and no Radix (D1, D5).

## Rulings (all in DESIGN.md)

| Ruling | Summary |
| --- | --- |
| D1 | No `motion`. |
| D1.3 | Remapping dependency, Node >=22.18, loader guard, TS 5.9. |
| D2 | UI kit: tokens, namespaced fonts as the only host change, toasts, priority vocabulary. |
| D3 | File format v1: `kind`, `ref`, targets, redaction fails closed. |
| D4 | Read-only viewport, capture from mount, non-modal ⌘K. |
| D5 | No Radix. |
| D6 | Route at `app/api/proompter`. |
| D7 | Contrast beats the prototype: `--fg-3` #9a9aa3, `--acc-solid` #d63c3c with white text. |
| D8 | Keyboard picking. |
| D9 | Keep it simple (principle 6). |
| §11.7 | Published exports are exact. |

## Simplification pass (D9)

- Non-test source went from 13,419 to 13,348 lines (−71). Behaviour is unchanged and every test stayed green.
- The code was already tight. The pass removed:
  - the unused TS token table;
  - options nobody passes (composer `build`; tooltip `delay`, `cooldownMs` and `warmAfterMs`; spring `response`; hover `containerWidth`);
  - stale Radix and integration comments.
- **Suggested, not done:** one shared `clamp`. The guarded variant would change behaviour at the raw call sites.

## Open items (not blocking v1)

- The Linux visual baselines get created on the first CI run (`--update-snapshots=missing`). Commit them after that run. The darwin baselines are already committed.
- `package.json` is still `0.0.0`, and the README status line says "v1 in progress". Bump both before any release (v3: CI publishing).
- PNG snapshots are not redacted. This is documented in the README FAQ.

## Process notes

- **Worker worktrees:** create them with `git worktree add .claude/worktrees/<t> -b <t> v1` and check HEAD first. `isolation: "worktree"` cuts from `main`. `.claude/` is ignored by eslint.
- **Unicode in sub-agent edits:** escapes can turn into raw U+2028/2029/0085/FEFF. Run `grep -rnP '[\x{2028}\x{2029}\x{0085}\x{FEFF}]' src e2e` before merging.
- **e2e workers:** e2e runs with `workers: 1`, because the flow specs share `examples/playground/reviews/`.
- **Commits and pushes:** only the orchestrator commits, one commit per file. Never push.
