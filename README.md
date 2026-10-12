# Proompter

A review layer you turn on over your own app. Pick any element on any viewport, write what's wrong,
and get a markdown file in your repo with the source location, console, network and a snapshot. A human
can read the file and an AI agent can act on it.

> Status: 0.1 (v2 shared reviews + v3 agent tools). Works with Next.js and with plain React on Vite. The design is in [DESIGN.md](DESIGN.md), changes in [CHANGELOG.md](CHANGELOG.md).

## Install

```sh
npm i -D @rachitkay/proompter
```

### Requirements

- Node 22.18 or newer (the Next loader `require()`s ESM-only parsers)
- React 19
- Next 15.3 or newer (only for `@rachitkay/proompter/next`), or Vite 5 or newer (only for `@rachitkay/proompter/vite`)

## Setup: Next.js

Three steps. All of them are behind one environment flag, so a normal build contains none of it. Using Vite
instead? See [Setup: Vite](#setup-vite-plain-react).

**1. Config.** Stamp every element with its source location.

```ts
// next.config.ts
import { withProompter } from "@rachitkay/proompter/next";

const nextConfig = {};
export default withProompter(nextConfig, { enabled: process.env.NEXT_PUBLIC_PROOMPTER === "true" });
```

**2. Component.** Render the kit, inside `<body>`. Import it from inside the flag check, as below: a plain
top-level `import { Proompter }` with `{flag && <Proompter />}` can leave the client reference (and its
chunk) in a production bundle, while a dynamic import in a dead branch is removed before bundling.

```tsx
// app/layout.tsx (a server component)
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const Kit =
    process.env.NEXT_PUBLIC_PROOMPTER === "true" ? (await import("@rachitkay/proompter")).Proompter : null;
  return (
    <html lang="en">
      <body>
        {children}
        {Kit && <Kit session={{ reviewer: "rachit" }} />}
      </body>
    </html>
  );
}
```

**3. Route.** The dev-only file writer.

```ts
// app/api/proompter/route.ts   (URL: /api/proompter)
export { GET, POST } from "@rachitkay/proompter/next/route";
```

The client talks to `/api/proompter` by default. Mount the route somewhere else if you like and pass the
URL as the component's `endpoint`.

The route only answers in development (`NODE_ENV=development`) with `NEXT_PUBLIC_PROOMPTER=true`, and it
only writes inside `<cwd>/reviews/`. It refuses cross-site requests: the kit's requests carry an
`x-proompter: 1` header and a JSON body, and the `Host` must be `localhost`, `127.0.0.1` or `[::1]`. To review
from another device on your network (a real phone, say), list its host names:
`PROOMPTER_ALLOWED_HOSTS=192.168.1.20,my-mac.local`.

Start your app with `NEXT_PUBLIC_PROOMPTER=true next dev`, then press `⌘⇧.` (or call
`window.__proompter.open()`) to show the kit.

## Setup: Vite (plain React)

Two steps, behind `VITE_PROOMPTER`. One plugin does what `withProompter` and the route do in Next: it stamps
source locations and serves the file writer on the dev server.

**1. Plugin.** Put it before the React plugin, so it sees your source before JSX is compiled.

```ts
// vite.config.ts
import { proompter } from "@rachitkay/proompter/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({ plugins: [proompter(), react()] });
```

**2. Component.** Render the kit next to your app, imported from inside the flag check, so a normal build drops it.

```tsx
// src/main.tsx
import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app";

const Kit =
  import.meta.env.VITE_PROOMPTER === "true"
    ? lazy(() => import("@rachitkay/proompter").then((m) => ({ default: m.Proompter })))
    : null;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
    {Kit && (
      <Suspense fallback={null}>
        <Kit session={{ reviewer: "rachit" }} />
      </Suspense>
    )}
  </StrictMode>,
);
```

Start with `VITE_PROOMPTER=true vite` (or put `VITE_PROOMPTER=true` in `.env.development.local`), then press `⌘⇧.`.

- The route is on the Vite dev server only, at `/api/proompter`, and it writes inside `<cwd>/reviews/` with the
  same guards as in Next. `vite build` and `vite preview` have no route.
- Options: `proompter({ enabled, include, exclude, root, allowedHosts })`. `enabled` overrides the env var, and
  `include`/`exclude` take the same globs as `withProompter`.
- The flag is the plugin's decision: it defines `import.meta.env.VITE_PROOMPTER` as `"true"` or `""`, so your
  check and the stamping always agree.

## Preview builds

A production build with the flag on (`NEXT_PUBLIC_PROOMPTER=true`, or `VITE_PROOMPTER=true`) ships the kit
**dormant**: no capture, no UI code loaded, only `window.__proompter` and the `⌘⇧.` listener. Reviewers turn it
on in the browser:

- `window.__proompter.enable()` or `⌘⇧.` starts capture and opens the kit. The choice is kept in
  `localStorage["proompter:enabled"]` for that origin, so a reload stays on.
- `window.__proompter.disable()` closes the kit, stops capture and goes back to dormant.
- `window.__proompter.enabled()` tells you which it is. While dormant, `open()` and `toggle()` do nothing.

Dev is unchanged: always on. Entries stay in the reviewer's browser (IndexedDB) until GitHub sync. The files
sink is a dev-only feature, and the dev route still answers 404 in a production build. With the flag unset,
nothing ships at all.

## GitHub sync

On a dev server or a preview, a reviewer can press **Sync to GitHub** in the Publish tab. Each entry lands on a
`reviews` branch, as the same files you get locally, and as a GitHub issue. Status goes both ways.

**1. Mount the route** (Next: `app/api/proompter/github/route.ts`; any other server can mount the same Web
`GET` and `POST`):

```ts
import { createGithubRoute } from "@rachitkay/proompter/github";

const route = createGithubRoute({ repo: "owner/name" }); // also: branch = "reviews", allowedHosts, api
export const GET = route.GET;
export const POST = route.POST;
```

**2. Set two env vars on the server** (the route answers 404 until both exist):

- `PROOMPTER_GITHUB_TOKEN`: a fine-grained personal access token with **Contents** and **Issues** read and
  write on that one repo. It stays on the server and never reaches the browser.
- `PROOMPTER_REVIEW_KEY`: a secret you share with your reviewers, **at least 16 characters** (a shorter one is
  treated as unset and the route stays 404). Make one with `openssl rand -hex 24`. The browser sends it as
  `Authorization: Bearer`; a wrong or missing key is a 401. The Publish tab asks for it once and keeps it in
  `localStorage["proompter:review-key"]`.

**3. Turn it on in the app:** `<Proompter github={{ endpoint: "/api/proompter/github" }} />` (the endpoint is
optional when you use that path). Without the prop nothing changes.

**What lands where**

- Files, through the Contents API, on the `reviews` branch (created from the default branch if missing):
  `reviews/<session>/session.md`, `entries/NNN-slug.md` and `assets/*.png`, the same layout and serializer as the
  local files. A file that has not changed is not rewritten, and a renamed title deletes the old file.
- One issue per entry, titled `PRO-n: <title>`, labelled `proompter`, `kind:<kind>` and `priority:<priority>`
  (created when missing). The body is written to be read: the note first, then the element and full-viewport screenshots (linked from
  the branch), a table of the fields, and the rest (selector, console and network summary, session) folded into
  "Details". The last line is a hidden `proompter ref` comment that finds the issue again. The issue
  number is stored in the entry's `issue` field and shown as a link in the Publish tab.

**One session per browser.** With the `github` prop, the session id gets a random tag kept in this browser
(`2026-10-11_review-k3x9q2`, in `localStorage["proompter:browser"]`), so two reviewers on the same day never share
a folder or an issue, and a reload stays in the same session. In dev this also names the local `reviews/` folder.
The route refuses (409) any sync whose session id is already on the branch with another start time, before it
touches an issue or a file. Upgrade every reviewer's app to 0.1.1 or later: a 0.1.0 kit still uses the shared
`<date>_review` id.

**Status, both ways.** Resolving an entry closes its issue and reopening it reopens the issue. An issue closed on
GitHub marks the entry resolved, with one activity line, on the next sync. If the entry also changed locally,
the local change wins, but only within one page load: what was already synced is remembered in memory, so after a
reload GitHub wins.

Notes: syncing sends one request per changed entry. Each entry costs a handful of GitHub API calls, so a very
large review on a token with a low rate limit can be throttled; it picks up where it stopped on the next sync.
Large screenshots go through the Contents API (100 MB per file at most).

Things to know before you turn it on:

- **One server instance.** Concurrent syncs are serialised inside one server process. On serverless or several
  instances two syncs of the same entry at once can create two issues and clash on `session.md` (a clash is
  retried once).
- **Issue bodies carry the entry's Context lines**, the console and network summary, as the files do. On a
  public repo, read [What gets redacted?](#what-gets-redacted) first and add a `redact` hook if needed. Issue
  titles and bodies have `@` broken with a zero-width space, so a synced entry cannot ping people or teams;
  the files on the branch are unchanged.

## Where reviews are saved

The `save` prop picks the destination:

- `save="files"`: `./reviews/` only (dev server). No GitHub sync, even with the `github` prop.
- `save="both"`: files and GitHub. This is the default when you set `github`.
- `save="github"`: GitHub only. Nothing is written locally, and the Publish tab has no Files section.

Without the `github` prop, every value acts as `"files"`.

| | `files` | `both` | `github` |
|---|---|---|---|
| Local `reviews/` files | yes | yes | no |
| `reviews` branch files (entries, `session.md`, PNGs) | no | yes | no |
| `proompter-assets` branch (`session.md`, PNGs) | no | no | yes |
| Issues | no | yes | yes (body: note, screenshots, source, route, viewport, component, intent, tags, task and test plan, context summary; kind and priority are labels, status is the open or closed state) |
| PNG snapshots | local | `reviews` branch | `proompter-assets` branch |

GitHub has no public API to attach an image to an issue, so with `"github"` the screenshots go to an orphan
`proompter-assets` branch (set `assetsBranch` on the route to rename it). It is never merged. The CLI and MCP read
`./reviews/` only, so they do not see `"github"` reviews.

```tsx
<Proompter github={{ endpoint: "/api/proompter/github" }} save="github" />
```

An issue body is capped at about 60,000 characters (GitHub's limit is 65,536). With `save="github"` a longer entry
(a large console or network section) is cut and marked "(truncated)", and there is no other copy of it.

`save="github"` needs the client and the route both at 0.2.0 or later. An older route is refused with "The GitHub
route is older than 0.2.0 and can't save to GitHub only", before anything is sent.

## CLI

`proompter` works the `reviews/` folder from the terminal, with no UI. Run it in your repo (or pass `--dir <path>`).

```sh
npx -y @rachitkay/proompter list --status open        # <ref>  <status>  <priority>  <title>  <source>
npx -y @rachitkay/proompter show PRO-5                # the entry markdown, as on disk (--json for the parsed entry)
npx -y @rachitkay/proompter task PRO-5                # an agent-ready task: source, selector, description, context, snapshots
npx -y @rachitkay/proompter resolve PRO-5 --note "Cropped the avatar" [--require-test]
```

- `list` takes `--status open|progress|resolved`, `--priority`, `--route <glob>`, `--session <id>` and `--json`.
- `<ref>` is `<session>/PRO-n`, or `PRO-n` when only one session has it.
- `resolve` sets `status: resolved`, writes the note under `## Resolution`, and rebuilds `session.md`.
  `--require-test` refuses unless `test_plan` names a regular file inside the repo that looks like a test (for example `e2e/feed.spec.ts`; a README or a folder is refused).
- Exit codes: 0 ok, 1 not found, 2 usage or ambiguous ref (or a missing `--dir`, or an unknown `--status` / `--priority`), 3 unexpected error.

The agent loop: `list` -> `task` -> fix -> `resolve`.

## MCP

`proompter mcp` serves the same actions to an MCP client over stdio (newline-delimited JSON-RPC, no extra dependency).
For Claude Code:

```sh
claude mcp add proompter -- npx -y @rachitkay/proompter mcp
```

Add `--dir <path>` after `mcp` when the reviews folder is not `./reviews`. Tools:

- `list_entries { status?, priority?, route?, session? }`
- `show_entry { ref }`
- `entry_task { ref }`
- `reply_entry { ref, text, who? }` appends `- <who> (<ISO date>): <text>` under the entry's `## Replies`.
- `resolve_entry { ref, note?, requireTest? }`

A failed tool call comes back as a result with `isError: true`, not a protocol error.

## Shortcuts

| Key | Does |
| --- | --- |
| `P` `M` `B` `T` `N` | Pick, Multi, Box, Text and Note tools |
| `F` | Freeze the page (pauses animations) |
| `R` | Rotate the device |
| `1` `2` `3` `4` | Responsive, Desktop, Tablet, Mobile |
| `E` | Entries sheet |
| `⌘⇧K` or `Alt+K` | Command menu (`Alt+K` for Firefox, which owns `Ctrl+Shift+K`; not while typing in a field) |
| `⌘⇧.` | Show or hide the kit |
| `⌘↵` | Create the entry (in the composer) |
| `↑` `[` / `↓` `]` | While picking: parent / back down |
| `Esc` | Closes one layer: menu, composer, command menu, mode, ticket, sheet |

Letter shortcuts stay out of the way while you type in a field.

## Files

Entries are markdown files in your repo, one folder per review session. Proompter writes them while you
review (in dev) and never uses git: you commit them.

```
reviews/<YYYY-MM-DD>_<session-slug>/
  session.md                     # title, reviewer, branch, sha, env, started, entry index
  entries/<NNN>-<title-slug>.md  # one per entry
  assets/<NNN>-<viewport>.png    # element crop;  <NNN>-<viewport>-full.png = the viewport
```

An entry:

```markdown
---
id: PRO-5
ref: 2026-10-10_manual-test-pass/PRO-5
session: 2026-10-10_manual-test-pass
kind: element           # element | multi | box | text | note
status: open            # open | progress | resolved
intent: fix             # fix | change | question | approve
priority: important     # blocking | important | minor
viewport: mobile 390x844
route: /feeds
source: src/app/(app)/feeds/_components/post-card.tsx:48:7
source_inherited: true
selector: '[data-src="…post-card.tsx:48:7"] > div:nth-of-type(1) > div:nth-of-type(1)'
component: FeedPage › FeedList › PostCard › PostHeader › Avatar
task: T-feed-home       # from a plugin, else omitted
test_plan: §2 Feed and posts
tags: [ui]
issue: null
created: 2026-10-10T12:42:07Z
---

# Avatar is cropped on mobile

Description as written.

## Context
- Console: 2 lines, 1 error
  - error GET /api/v1/feeds/trending 500
- Network: 1 failed of 4
  - GET /api/v1/feeds/trending → 500 (911 ms)
- Build: migrate/main@611df0b

![mobile](../assets/005-mobile.png)
```

- `source_inherited: true` means the element itself isn't stamped and the source is its nearest stamped
  ancestor's. A missing source is written as `source: null` (page notes), never guessed.
- `ref` is `<session-slug>/PRO-n`. Numbering is per session, so two sessions can both have `PRO-1`; use
  `ref` wherever an entry leaves its session (Copy for agent, issue bodies).
- `kind` is always written. A parser that finds none infers element or note from whether `selector` is there.
- Multi and box entries add a `## Targets` section, and their frontmatter mirrors the first target. A text
  entry's quote is a `> ` block under the title.
- Plugin `extra` fields go after `created`. `session.md` carries `proompter: 1`, the format version.
- **Copy for agent** copies exactly this text.

## Plugins

Host-side only. Nothing app-specific lives in the package.

```tsx
<Proompter plugins={[myPlugin()]} />

type ProompterPlugin = {
  name: string;
  taskFor?(t: { source?: string; route: string }): string | null; // e.g. route → T-*.md
  context?(): Record<string, unknown>;                              // extra frontmatter fields
  testPlan?: string[];                                              // sections for the Test plan menu
  redact?(entry: Entry): Entry;
};
```

The Task and Test plan chips only show when a plugin supplies them. If your app keeps task files and a test
plan in its repo, you don't need to write a plugin. Use `repoPlugin`:

```tsx
import { repoPlugin } from "@rachitkay/proompter/plugins";

<Proompter
  plugins={[
    repoPlugin({
      tasks: { "/clips": "tasks/T-clips.md", "/": "tasks/T-home.md" }, // route glob -> repo path
      testPlan: ["Smoke", "Auth", "Billing"],                               // Test plan menu sections
      context: () => ({ build: process.env.NEXT_PUBLIC_BUILD }),            // extra frontmatter (optional)
    }),
  ]}
/>;
```

- `tasks`: the first glob (in the order you wrote them) that matches the route's pathname gives the entry's
  `task:`. A plain path matches that route and everything under it (`/clips` covers `/clips/42`), `/` matches only
  the home page, and globs support `*`, `**`, `?` and `{a,b}`. No match means no task.
- `testPlan` is passed through. `context` is passed through too, and a throw yields no extra fields.
- `name` defaults to `"repo"`. The entry point is client-safe: it imports nothing from node.

## FAQ

### Is it safe in production? Does it cost anything when off?

With `NEXT_PUBLIC_PROOMPTER` unset, `withProompter` returns your config untouched (no loader), the
`process.env` check in your layout is a build-time `false`, and the bundler drops the dynamic import with it. With
Vite and `VITE_PROOMPTER` unset, the plugin stamps nothing, adds no route, and `import.meta.env.VITE_PROOMPTER` is
`""`, so the same happens in `src/main.tsx`. The served
HTML has no `data-src`, no Proompter script and no listeners. The route answers `404` outside
`NODE_ENV=development` with the flag on, and it only ever writes inside `<repo>/reviews/`, so path
traversal is refused. End-to-end tests check all of this against a production build.

### What gets redacted?

Redaction of the captured **console and network text** runs before anything is stored, and it's on by
default. It covers:

- the `authorization`, `proxy-authorization`, `cookie` and `set-cookie` headers (dropped)
- query-string parameters, JSON keys, headers and `key=value` text whose key name looks sensitive: `token`,
  `secret`, `password`/`passwd`/`pwd`, `api_key`/`api-key`, `authorization`, `credential`, `cookie`,
  `signature`, `jwt`, `session`, an `auth` word, and the bare keys `key`, `sig` and `code`
- `Bearer`, `Basic` and `Token` values
- JWTs and email addresses anywhere in the text
- anything your own `redact(entry)` hook removes. A plugin's `redact` runs after the built-in pass, on the
  same terms.

**PNG snapshots are masked too.** Each snapshot is rendered from a copy of your page, and in that copy (never
on the live page) these elements are painted solid black, with everything inside them:

- every element with `data-proompter-redact`
- every `input`, `textarea`, `select`, `output`, `[contenteditable]`, `[role="textbox"]` and `[role="combobox"]`,
  except buttons, checkboxes, radios, range and color inputs
- every element matching a selector in a plugin's `redactSnapshot: string[]`

Typed values are cleared from the copy too. Mark anything else with `data-proompter-redact`. It **fails closed**
here as well: if masking or drawing fails, that picture is dropped, the entry is saved without it, and a toast says
"Snapshot hidden: it couldn't be redacted." Not masked: content inside shadow roots or nested iframes, and text
that is not in a field or marked. Still, don't file entries on screens that show production data you don't want
committed into `reviews/assets/`.

A `<video>` or `<canvas>` the browser won't let the page read (a cross-origin video without CORS, a canvas drawn with
a cross-origin image) can't be captured. It is replaced by a grey "video" or "canvas" box where it sat, so the rest of
the screenshot still comes out. If no screenshot can be taken at all, a toast says so; in development the reason is
also logged as `[proompter] snapshot:...` in the console.

It **fails closed**: if a plugin's `redact` throws or returns a different entry, nothing is stored or
written, the number isn't used, and the composer says "Plugin <name> failed to redact this entry. Nothing
was saved."

### What are the viewports?

Responsive (default) reviews the live page, with pins on top of it. Desktop 1440×900, Tablet 834×1194 and
Mobile 390×844 (plus rotate) review a same-origin `<iframe>` of the current URL with
`?__proompter_frame=1`, scaled to fit a device bezel. Only one viewport shows at a time and every tool works
inside the frame. Entries record the viewport and its exact size, and a pin shows only on the viewport it was
filed on; "Show on page" switches to it first. A page that refuses to be framed (`X-Frame-Options`, CSP)
gets an inline notice instead.

### My app mounts twice in device viewports

The Responsive, Tablet and Mobile views load your page in an iframe (with `?__proompter_frame` in the URL), so
app-level side effects run twice: analytics, websockets, a toast provider. `isProompterFrame()` tells you which
one you are in. It is tiny and safe to call anywhere (it returns `false` on the server):

```tsx
import { isProompterFrame } from "@rachitkay/proompter";

export function Providers({ children }: { children: React.ReactNode }) {
  return isProompterFrame() ? children : <Analytics>{children}</Analytics>;
}
```

### Will it touch my styles?

No. The whole UI lives in one shadow root with its own CSS, and your CSS can't reach it. The only change to
your document is one `<style data-proompter-fonts>` tag while the kit is shown.

## Licenses

MIT. The kit embeds Geist and Geist Mono (SIL Open Font License 1.1), see
[licenses/Geist-OFL.txt](licenses/Geist-OFL.txt).

## Develop

```sh
pnpm i
pnpm typecheck && pnpm lint && pnpm test && pnpm build
pnpm storybook   # UI kit
pnpm e2e         # Playwright; starts the playground itself (see below)
```

The playground (`examples/playground`) is a Next 16 app with a mock feed ported from `design/prototype.html`.
`pnpm e2e` starts it twice: `next dev` with `NEXT_PUBLIC_PROOMPTER=true` on :3100 for most specs, and a
production build with the flag unset on :3101 for the zero-cost check. The Vite example (`examples/vite`) runs
as `vite` dev with the flag on at :3102 and as `vite preview` of a flag-unset build at :3103. The specs write under
each example's `reviews/` (gitignored) and clean up after themselves.

Visual baselines live in `e2e/__screenshots__/visual.spec.ts/<platform>/`, one set per OS because rendering
differs. The macOS set is committed. A platform with no baselines (CI runs on Linux) uses
`pnpm e2e --update-snapshots=missing`: it writes its own on the first run and compares on later ones. Regenerate
on purpose with `pnpm e2e --update-snapshots`, and commit the result for your platform.

### Releasing

See [RELEASING.md](RELEASING.md) for the steps.

`./internal/fixtures` is a private export the playground's e2e routes use. `npm pack` and `npm publish` run
`scripts/release-exports.mjs`, which builds without it and strips it from `exports`, so the published
package exposes exactly `.`, `./next`, `./next/route`, `./vite`, `./github` and `./package.json`. CI checks that with
`PROOMPTER_RELEASE=1`.

MIT
