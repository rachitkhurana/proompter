# Proompter

A review layer you turn on over your own app. Pick any element on any viewport, write what's wrong,
and get a markdown file in your repo with the source location, console, network and a snapshot. A human
can read the file and an AI agent can act on it.

> Status: v1 in progress. The design is in [DESIGN.md](DESIGN.md), the work in [tasks/](tasks/).

## Install

```sh
pnpm add -D @rachitkay/proompter
```

### Requirements

- Node 22.18 or newer (the Next loader `require()`s ESM-only parsers)
- React 19
- Next 15.3 or newer (only for `@rachitkay/proompter/next`)

## Setup

Three steps. All of them are behind one environment flag, so a normal build contains none of it.

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

Start your app with `NEXT_PUBLIC_PROOMPTER=true next dev`, then press `⌘⇧.` (or call
`window.__proompter.open()`) to show the kit.

## Shortcuts

| Key | Does |
| --- | --- |
| `P` `M` `B` `T` `N` | Pick, Multi, Box, Text and Note tools |
| `F` | Freeze the page (pauses animations) |
| `R` | Rotate the device |
| `1` `2` `3` `4` | Responsive, Desktop, Tablet, Mobile |
| `E` | Entries sheet |
| `⌘K` | Command menu |
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

The Task and Test plan chips only show when a plugin supplies them. See [docs/gamorite.md](docs/gamorite.md)
for a worked example (route → task).

## FAQ

### Is it safe in production? Does it cost anything when off?

With `NEXT_PUBLIC_PROOMPTER` unset, `withProompter` returns your config untouched (no loader), the
`process.env` check in your layout is a build-time `false`, and the bundler drops the dynamic import with it. The served
HTML has no `data-src`, no Proompter script and no listeners. The route answers `404` outside
`NODE_ENV=development` with the flag on, and it only ever writes inside `<repo>/reviews/`, so path
traversal is refused. End-to-end tests check all of this against a production build.

### What gets redacted?

Redaction runs before anything is stored, and it's on by default.

- `authorization`, `cookie` and `set-cookie` headers
- values that look like an email address, a JWT, or a `token`, `secret`, `password` or `api key`
- anything your own `redact(entry)` hook removes (a plugin's `redact` too)

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
production build with the flag unset on :3101 for the zero-cost check. The specs write under
`examples/playground/reviews/` (gitignored) and clean up after themselves.

Visual baselines are created by the first run (`pnpm e2e --update-snapshots`) into `e2e/__screenshots__/`.

### Releasing

`./internal/fixtures` is a private export the playground's e2e routes use. `pnpm pack` and `pnpm publish` run
`scripts/release-exports.mjs`, which builds without it and strips it from `exports`, so the published
package exposes exactly `.`, `./next`, `./next/route`, `./github` and `./package.json`. CI checks that with
`PROOMPTER_RELEASE=1`.

MIT
