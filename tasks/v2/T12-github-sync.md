# T12: GitHub sync (DESIGN D16) + shared server helpers

**Goal:** a reviewer on dev or a preview presses "Sync to GitHub". Each entry lands as files on a `reviews` branch
(the same layout as the local files) and as a GitHub issue. Status syncs both ways.

**Owns:**
- `src/server/` (new)
- `src/next/route.ts` (refactor only, no behaviour change)
- `src/github/index.ts` (replaces the stub)
- `src/core/sinks/github.ts`
- `src/core/sinks/github.test.ts`
- `src/ui/shell/defaults.tsx` (sink wiring)
- `src/ui/proompter-deps.ts` (`github` prop and the store hooks)
- `src/ui/sheet/publish-panel.tsx` (+ story)
- `test/github/` (fake GitHub + route tests)
- `e2e/github.spec.ts`
- `examples/playground/app/api/proompter/github/route.ts`
- `scripts/e2e-servers.mjs` (env only)
- README "GitHub sync" section

## Step 1: refactor (no behaviour change)
Move these out of `src/next/route.ts` into `src/server/validate.ts` and `src/server/write.ts`, and export them:
- the validation and parsing: `Refusal`, `checkRequest`, `checkSession`, `checkEntry`, `readBody`
- the file writing: `guardPath`, `writeAtomic`, `withLock`, `readEntries`, `writeEntry`

`route.ts` imports them. Every existing route test must pass unchanged; this is what T15's CLI reuses.

## Step 2: server, `@rachitkay/proompter/github`

```ts
createGithubRoute({
  repo: "owner/name",
  token?: string,          // default process.env.PROOMPTER_GITHUB_TOKEN
  branch = "reviews",
  reviewKey?: string,      // default process.env.PROOMPTER_REVIEW_KEY
  allowedHosts?, api = "https://api.github.com",
}) → { GET, POST }
```
`api` is overridable for the fake. Plain `fetch`, with no Octokit.

- **Guard:**
  - Missing token or reviewKey answers 404.
  - Every request goes through `checkRequest`, the same-origin and `x-proompter` checks; non-loopback hosts are
    allowed here because a preview is not loopback.
  - A wrong or missing `Authorization: Bearer <reviewKey>` answers 401. Compare with `timingSafeEqual`.
- **`POST { session, entry }`:**
  - **Validate** with the shared `checkSession`/`checkEntry`.
  - **Branch:** create it if missing, from the default branch's HEAD.
  - **Files:** write `session.md`, `entries/NNN-slug.md` and the PNGs through the Contents API (`PUT
    /repos/{repo}/contents/{path}` with `sha` when updating). Skip a file whose content is unchanged.
  - **Rename:** when the title changed, delete the old `NNN-*.md`.
  - **Issue:** create it, or update it if `entry.issue` is set.
    - Title: `PRO-n: <title>`.
    - Labels: `proompter`, `kind:<k>`, `priority:<p>`. Create the labels if they are missing.
    - Body: the serialized entry, plus `![snapshot](<blob url>?raw=true)`.
    - State: closed if the entry is resolved, else open.
  - **Answer:** `{ ok, issue: "<number>", url, files: [...] }`.
- **`GET ?session=ID`:** `{ ok, issues: [{ n, issue, state, url }] }` for that session's entries. Find them by the
  `proompter` label plus a `ref` marker in the body, or by the entry files on the branch. KISS: list the issues
  with label `proompter` and parse `ref:` from the body.
- **Body cap:** the same 20 MB as the dev route.

## Step 3: client sink (`src/core/sinks/github.ts`)
- **API:** `createGithubSink({ endpoint, store, key: () => string | null })`, with `sync()`, `pending()`,
  `subscribe()`, `lastError`.
- **`sync()`:**
  1. For each entry changed since its last sync (track a per-entry hash in memory plus IndexedDB via the store's
     `extra`? KISS: memory plus "issue is null"), POST it, one per request.
  2. Store the issue number with `store.update(id, { issue }, "github")`.
  3. Then GET, and for each closed issue whose entry isn't resolved: `store.resolve(id, "github")`.
- **Errors:** 401 prompts for the key. The UI asks once, keeps it in `localStorage["proompter:review-key"]`, and
  retries once. 404 means "GitHub sync isn't set up on this server". It never throws into the host.

## Step 4: UI
- **Prop:** `github={{ endpoint: "/api/proompter/github" }}` on `<Proompter>` enables it. Without the prop, nothing
  changes.
- **Publish tab:**
  - a "Sync to GitHub" button with Button variant `sec`;
  - a status line with the count synced or the error;
  - each row's issue number as a link;
  - a small key field shown only after a 401, using the composer's input styles.
- **Visuals:** a story, and a visual baseline for the Publish tab in its synced state.

## Tests
- **Fake GitHub** (`test/github/fake.ts`): an in-process `fetch` handler (Request → Response) implementing only
  the endpoints the route calls (refs, contents, issues, labels), with state in memory. The route takes `api` plus
  an injectable `fetch`.
- **Unit:** the route against the fake.
  - files land in the right paths
  - an unchanged file is not rewritten
  - title rename
  - issue create, update and close
  - labels created
  - 404, 401 and 403 guards
  - body cap
  - The sink: sync, resolve-from-GitHub, a 401 key prompt (with a mocked prompt callback), and a 404 message.
- **e2e:** mount the route in the playground with `api` pointed at a fake served by the e2e servers script.
  Spawn the fake from `scripts/e2e-servers.mjs` as a tiny `node:http` server on `BASE + 5`, sharing its code with
  `test/github/fake.ts`.
  1. File an entry, sync: the issue exists in the fake, and the branch has the files.
  2. Close the issue in the fake (through its HTTP API), sync: the entry shows resolved.

## Docs
README "GitHub sync":
- the route file
- the env vars: `PROOMPTER_GITHUB_TOKEN` (a fine-grained PAT with Contents and Issues read/write on one repo) and
  `PROOMPTER_REVIEW_KEY`
- the prop
- what lands where
- the two-way status
