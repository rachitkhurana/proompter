# v1 tasks

Each file is one unit of work for one agent. Read `../DESIGN.md` first; `../design/prototype.html` is the
visual source of truth (open it in a browser, and read its CSS and JS for exact values and behaviour).

## Order

| Batch | Tasks | Notes |
| --- | --- | --- |
| 0 | T01 scaffold | Alone. Everything depends on it |
| 1 | T02 ui-kit, T03 loader, T06 capture | Disjoint folders, can run in parallel |
| 2 | T04 surface+pick, T05 dock | T04 needs T02; T05 needs T02 |
| 3 | T07 composer+store, T08 sheet+ticket+cmd | Need T04 + T05 |
| 3b | T02b hand-built Menu | After batch 3 merges; drops Radix (DESIGN §2 D5) |
| 4 | T09 next route + files sink, T10 playground e2e + docs | Close-out |

## Rules for every task
- Own only the paths listed under **Owns**. Need something elsewhere? Write it in your hand-back, don't edit it.
- Commit per file, with the message prefix `T0N:`.
- Before handing back:
  - `pnpm typecheck`, `pnpm test` and `pnpm build` are green
  - the stories for your UI exist
- **Never start a dev server by hand.** Playwright's webServer runs the playground.
- **No new dependency without saying why** in the hand-back.
- Match the prototype's numbers (sizes, radii, colours, durations, easings) exactly. If you can't, say so.
