# T15: `proompter` CLI + test-plan linking (DESIGN D19)

**Goal:** an agent or a human works the `reviews/` tree from the terminal, with no UI.

**Owns:**
- `src/cli/` (new: `index.ts` bin entry, `core.ts` pure logic)
- `package.json` (`bin: { "proompter": "./dist/cli/index.js" }`; check that the file is executable after the build)
- `tsup.config.ts` (the entry, with a `#!/usr/bin/env node` banner on that entry only)
- `test/cli/`
- README "CLI" section

## Commands
Commands run in cwd. `--dir <path>` overrides `./reviews`.
- **`proompter list [--status open|progress|resolved] [--priority …] [--route <glob>] [--session <id>] [--json]`:**
  one line per entry, `<ref>  <status>  <priority>  <title>  <source>`.
- **`proompter show <ref> [--json]`:** the entry markdown, as on disk.
- **`proompter task <ref>`:** an agent-ready task to stdout. It contains:
  - title, ref, intent and priority
  - the source file:line and selector, the component and the route/viewport
  - the description and the quote
  - the context summary
  - the snapshot paths
  - acceptance: "Fix it, then run `proompter resolve <ref> --note "…"`". If `test_plan` names a file, add "make
    `<file>` pass".
- **`proompter resolve <ref> [--note "<text>"] [--require-test]`:**
  - Sets the status to resolved, appends an activity line `resolved (cli)`, and puts the note under
    `## Resolution`. Reuse the serializer; if the format can't hold that section, report it instead of inventing
    a format.
  - Rewrites the file atomically and rebuilds `session.md` with the shared `src/server/write.ts` helpers from T12.
  - `--require-test`: refuse with exit 2 unless `test_plan` is set and that path exists relative to the repo root
    (the nearest `.git` ancestor).
- **`ref`:** `<session>/PRO-n`, or `PRO-n` if exactly one session has it (else exit 2 and list the candidates).
- **Exit codes:** 0 ok, 1 not found, 2 usage or ambiguous.
- **Arguments:** use `node:util` `parseArgs`. No dependency.

## Tests
`test/cli/`: drive `core.ts` against a temp `reviews/` fixture written with the real serializer. Spawn the built
bin for one smoke test (`node dist/cli/index.js list`).

## Docs
README "CLI": the commands, `ref`, the exit codes, and the agent loop (`list` → `task` → fix → `resolve`).
