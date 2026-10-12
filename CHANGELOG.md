# Changelog

## 0.2.1

- **Readable issue bodies:** note and screenshots first, a field table, details collapsed. Fixed a broken image link
  in every issue (since 0.1.0); the full-viewport screenshot is now shown too.
  - Issues made by earlier versions are found by their old `ref:` line and updated in place.

## 0.2.0

- **`save` prop:** pick where reviews are saved: `"files"`, `"github"` or `"both"`. The default is unchanged (`"both"`
  with the `github` prop, else `"files"`).
  - `save="github"` keeps no local files: no dev-route requests, and the Publish tab has no Files section. The issue
    body holds the whole entry, and the screenshots go to an orphan `proompter-assets` branch (route option
    `assetsBranch`) that is never merged. `session.md` stays the session lock, on that branch.
  - It needs the route and the client both at 0.2.0 or later. An older route is refused with a message before
    anything is sent.
  - The CLI and MCP read ./reviews/ only, so they see nothing in this mode.

## 0.1.1 (2026-10-11)

- **GitHub sync, two reviewers on one day:** both browsers used the session id `<date>_review`, so the second
  reviewer's PRO-1 overwrote the first one's issue and files on the branch, and could mark their own new entry
  resolved from the other's closed issue. With the `github` prop the session id now ends in a per-browser tag
  (`2026-10-11_review-k3x9q2`), and the route refuses (409) a sync whose session on the branch was started by
  another review, before touching anything. A new session's `session.md` is created first, so a race between
  server instances has one winner. Found in the live smoke test. Upgrade every reviewer's app: a 0.1.0 kit still
  uses the shared id.
- **GitHub sync:** syncing an entry again within a few seconds of its first sync (say, resolving it right away) could
  open a second issue, because GitHub's label listing lags behind a new issue. The route now reads the issue number
  the client already holds directly, and trusts it only when that issue is a `proompter` issue carrying the entry's
  `ref`. Found in the live smoke test against github.com.

## 0.1.0 (2026-10-10)

Shared reviews (v2) and agent tools (v3).

- **Preview builds:** a production build with the flag on ships the kit dormant: no capture, no UI. A reviewer turns
  it on with `window.__proompter.enable()` or `⌘⇧.`, and the choice is remembered per browser. `disable()` turns
  it off.
- **GitHub sync:** new `@rachitkay/proompter/github` route, plus the `github` prop and a "Sync to GitHub" action in
  the Publish tab.
  - Entries land on a `reviews` branch in the same layout as the local files, and as one issue each, labelled by
    kind and priority.
  - Status syncs both ways.
  - The token stays on the server, and every request needs a review key.
- **Snapshot redaction:** PNG snapshots black out inputs, text areas, selects, editable areas and
  `[data-proompter-redact]` elements, plus your plugins' `redactSnapshot` selectors. Masking happens inside the
  rendered copy, never on the page, and a snapshot that can't be masked is dropped.
- **Repo plugin:** new `@rachitkay/proompter/plugins` with `repoPlugin({ tasks, testPlan, context })`. It maps
  routes to task files and fills the Test plan menu, with no plugin code.
- **CLI:** `npx -y @rachitkay/proompter list | show | task | resolve` works on your `reviews/` folder. `task`
  prints an agent-ready brief. `resolve --note` records a resolution, and `--require-test` insists on a linked test
  file.
- **MCP server:** `npx -y @rachitkay/proompter mcp` lets agents list, read, reply to and resolve entries.
- **File format:** two optional sections, `## Resolution` and `## Replies`. An open page now merges changes made on
  disk before it saves, so it doesn't overwrite an agent's edit.
- **Fixes:**
  - `isProompterFrame()` for apps that mount twice in device viewports.
  - Esc during the composer's closing animation no longer reaches the app.
  - App inputs keep their blur events.
  - `Alt+K` opens the command menu where the browser owns `⌘⇧K`/`Ctrl+Shift+K` (Firefox).

## 0.0.3 (2026-10-10)

- **Vite and plain React:** new `@rachitkay/proompter/vite` export with a `proompter()` plugin. It stamps source
  locations and serves the file writer on the Vite dev server, so the kit works in any React 19 app built with
  Vite, not just Next.js. See "Setup: Vite" in the README.
- The npm page no longer lists the private `./internal/fixtures` export (0.0.1 and 0.0.2 did).

## 0.0.2 (2026-10-10)

- **Accessibility:** the publish view's list of pending files can now take keyboard focus, so long paths that
  scroll sideways can be read without a mouse.
- **npm page:** the package page no longer lists the private `./internal/fixtures` export. Installs were never
  affected.
- Published from GitHub Actions with npm trusted publishing and provenance.

## 0.0.1 (2026-10-10)

First release.

- **Review layer** in a shadow root over your own Next app, behind `NEXT_PUBLIC_PROOMPTER=true`. With the flag
  unset, nothing reaches the production bundle.
- **Pick tools:** element, several elements, box, text and page note. Pick with the mouse or the keyboard
  (`↑`/`↓` walk parents and children).
- **Viewports:** Responsive (the live page) plus Desktop, Tablet and Mobile device frames, with rotate. Pins show
  on the viewport they were filed on.
- **Entries:** a composer with intent and priority, an entries sheet, tickets, and a command menu (`⌘⇧K`).
- **Context:** the source location (`withProompter` stamps `data-src` at build time), the component stack,
  console and network logs (redacted), an element crop and a viewport snapshot.
- **Files:** each entry is a markdown file under `reviews/<date>_<session>/`, written by a dev-only route
  (`@rachitkay/proompter/next/route`) and readable by people and AI agents. Redaction fails closed.
- **Works inside host modals:** an open app dialog (Radix and similar) stays open while you use the kit.
- **Plugins** for task links, test-plan sections, extra fields and redaction.
