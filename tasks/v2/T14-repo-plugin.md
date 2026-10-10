# T14: Generic repo plugin (DESIGN D18)

**Goal:** any app links entries to its own task files and test plan without writing plugin code.

**Owns:**
- `src/plugins/` (new)
- `src/core/glob.ts` (new; `globToRegExp` moved from `src/next/loader.ts`, which re-exports it)
- `src/next/loader.ts` (that move only)
- `package.json` (the `./plugins` export)
- `tsup.config.ts` (the entry)
- `scripts/release-exports.mjs` and `src/internal/exports.test.ts` (add `./plugins` to the export list)
- README "Plugins" section

## API
```ts
import { repoPlugin } from "@rachitkay/proompter/plugins";
repoPlugin({
  tasks?: Record<string /* route glob, e.g. "/clips/**" */, string /* repo path, e.g. "tasks/T-clips.md" */>,
  testPlan?: string[],                  // section names for the Test plan menu
  context?: () => Record<string, unknown>,
  name?: string,                        // default "repo"
}): ProompterPlugin
```
- **`taskFor({ route })`:** the first matching glob's path, else null. Matching is on the pathname only. Order is
  insertion order.
- **`testPlan`:** passed through.
- **`context`:** passed through, wrapped so a throw returns `{}`.
- **Client-safe:** no node imports. This is part of the client bundle.

## Tests
Unit: glob matching (`*`, `**`, `?`, `{a,b}`, trailing names), first match wins, null on no match, context
throwing, and the loader's glob tests still passing after the move.

## Docs
README "Plugins": a worked example with `repoPlugin`, replacing or next to the raw-plugin example. Remove the
`docs/gamorite.md` reference if it points at app-specific code; keep the doc generic.
