# v2/v3 tasks

Read `../../DESIGN.md` first, especially D9 (KISS), D13, D14 and D15–D20, then your task file. The plan is
`specs/ROADMAP-v2-v3.md` as amended by DESIGN.

## Order

| Wave | Tasks | Notes |
| --- | --- | --- |
| A | T11 preview mode, T13 snapshot redaction | Disjoint |
| B | T12 GitHub sync (+ `src/server/` refactor), T14 repo plugin | Disjoint |
| C | T15 CLI | Needs T12's `src/server/` |
| D | T16 MCP, T17 v1 gaps | T16 needs T15 |

## Rules for every task
- **Where:** work only in your worktree (`.claude/worktrees/<task>`, branch `<task>` cut from `v2`). Own only the
  paths listed under **Owns**. If you need something elsewhere, put it in your hand-back.
- **Commits:** don't commit. The orchestrator reviews and commits.
- **Ports:** run e2e with the port base your brief gives you (`E2E_PORT_BASE=3200 pnpm e2e`). Two worktrees share
  the machine, and new servers take `BASE + 4`, `BASE + 5`, ….
- **Install:** in a fresh worktree, run `pnpm install --frozen-lockfile` once.
- **Servers:** never start a dev server by hand. Playwright's webServer (`scripts/e2e-servers.mjs`) owns every
  server, and you may extend that script.
- **Dependencies:** none new without a reason in the hand-back. None are expected.
- **KISS (D9):** the smallest code that meets the acceptance. No speculative options, no new abstractions without
  a second user.
- **UI:** new UI uses only existing primitives (`src/ui/primitives`), tokens and styles. It adds no new visual
  language. Add a story for any new UI.
- **Before handing back,** all of these must be green and pasted in the hand-back:
  - `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`
  - `pnpm e2e` (one worker; it takes ~2 min)
- **Special characters:** scan with `grep -rnP '[\x{2028}\x{2029}\x{0085}\x{FEFF}]' src e2e test scripts`. Write
  such characters as escapes, never raw.
- **Hand-back:** the files changed, what each does, the test results, anything you did NOT do, and the open
  questions.
