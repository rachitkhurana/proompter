# Proompter v2 / v3 brief

Status: v1 shipped as @rachitkay/proompter 0.0.2 (D1–D13). This brief records direction only. Build nothing until Rachit says go; the PLAN session then writes the task files.

## Original intent (Rachit, brainstorm)
- **Storage:**
  - Local: session-based files in the repo (`reviews/<date>_<slug>/`), git-tracked. Done in v1.
  - GitHub: issues opened alongside the local files.
- **Environments:** local, preview and prod data. It's switched on by an env var OR a function on `window` (so no rebuild is needed on a deployed preview).
- **Consumers:** AI agents and humans equally. Every entry must be actionable by an agent without the UI.
- **Reusable across apps:** Gamorite, Ultrahuman, the portfolio. Anything app-specific belongs in plugins inside the consumer repo, never in the package.
- **KISS:** the smallest code that meets each item. No speculative layers. Critics fix real defects only.

## v2: shared reviews
1. **Preview builds:**
   - The kit runs on a deployed preview, where there is no dev route and no filesystem.
   - Enabled by `NEXT_PUBLIC_PROOMPTER` at build time, or at runtime by `window.__proompter.enable()` when the build stamped `data-src`.
   - Entries go to the IndexedDB sink.
   - The prod-off guarantee (D13) must still hold when the flag is unset.
2. **GitHub sync (`./github`, server-only token):**
   - Push IndexedDB/session entries to a `reviews` branch through the Contents API, in the same file layout as the local files sink, so local and remote reviews are interchangeable.
   - Open one issue per entry: labels from kind and priority; the body is the entry markdown plus the snapshot.
   - Two-way status: resolving locally closes the issue, and closing the issue marks the entry resolved on the next sync.
   - Token handling: a route handler in the consumer app holds the token, and the client never sees it. Start with a PAT; a GitHub App comes later if needed.
3. **Prod-data redaction:**
   - PNG snapshots are not redacted today, which is the open gap.
   - Apply the redact plugin to the DOM before html-to-image, e.g. masking `[data-proompter-redact]` and inputs by default.
   - Fail closed, as in D3.
4. **Gamorite plugin** (lives in the Gamorite repo):
   - `taskFor`: route → task/spec file
   - a Task chip and a Test plan menu
   - `context`: the active game/session id

## v3: agents
1. **`proompter` CLI (bin):**
   - `list` (filter by status/priority/route), `show <ref>`, `task <ref>` (prints an agent-ready task), `resolve <ref> [--note]`, `import <zip>`
   - Works on the local `reviews/` tree. It reuses the v1 format parser and adds no new format.
2. **MCP server:**
   - Agents can list, show, reply to and resolve entries.
   - It shares the CLI's core, so it is a thin wrapper.
3. **Test-plan linking:** an entry's `test_plan` points at the test that proves the fix, and `resolve` can require it.
4. Done already: npm publishing through CI with provenance (0.0.1/0.0.2).

## Known v1 gaps to fold in (small)
- Device-viewport iframes mount the host app twice: VoiceProvider and websockets run twice. Possible fixes: a `__proompter_frame` hint to consumers, or a plugin hook.
- An app input's blur/focusout is skipped when focus moves into the kit (D11).
- Esc pressed during the composer's ~200ms exit animation can reach the app.
- Firefox's Ctrl+Shift+K (web console) collides with the command menu.
