# Proompter: design spec (v1)

Proompter is a review layer that developers turn on over their own app. You pick any element, on any
viewport, and write what's wrong. Proompter records where it lives in the source, what the console and
network were doing, and a snapshot. It saves all of that as a markdown file in the repo, which a human
can read and an AI agent can act on. Later it can open a GitHub issue too.

- **npm:** `@rachitkay/proompter`. The bare `proompter` name and the `@proompter` scope are taken.
- **Repo:** https://github.com/rachitkhurana/proompter · **License:** MIT
- **Visual reference:** [`design/prototype.html`](design/prototype.html), the approved interactive
  prototype, also published at https://claude.ai/artifact/LqcaXYUe3EH6UcdHkkgyEc.
  **It is the source of truth for look, spacing, motion and interaction.** When this spec and the
  prototype disagree on anything visual, the prototype wins. When they disagree on behaviour, ask.
- **First consumer:** Gamorite (`website-nextjs`, Next 16, React 19, Tailwind 4, Turbopack).

---

## 1. Principles

1. **Zero cost when off.** With the flag unset, nothing from Proompter is in the production bundle.
   No CSS leaks, no globals, no listeners.
2. **Never touch the host's styles, and never let the host touch ours.** All UI renders inside one
   shadow root, with its own CSS.
   The only change allowed to the host document is one `<style data-proompter-fonts>` tag (D2.2).
3. **Point at code, not pixels.** Every entry carries `file:line`. An inherited source is labelled as
   inherited, and a missing source is labelled as missing. A guess is never shown as a fact.
4. **Files first.** An entry is a markdown file in the repo. GitHub and every other sink are mirrors
   of that file.
5. **Fast, not flashy.** Motion is under 300ms, with custom ease-out curves and springs only where a
   gesture carried momentum (see `.agents` design skills: emil-design-eng, apple-design).
6. **Keep it simple (D9).** Write the smallest code that meets the acceptance item. Add no new
   abstractions, layers, generic frameworks or options unless a test or a §11 item needs them. Critic rounds
   fix real defects only, with no hardening beyond the threat model. A fix over ~50 lines needs sign-off
   first. Close-out ends with a simplification pass, which must leave behaviour unchanged and every test green.

## 2. Package layout

```
src/
  index.ts              → `Proompter` component + types   (import "@rachitkay/proompter")
  next/index.ts         → withProompter(), createProompterRoute()  ("@rachitkay/proompter/next")
  next/loader.ts        → Turbopack/webpack loader that stamps data-src
  vite/index.ts         → proompter() Vite plugin: stamps data-src, serves the dev route (D14) ("@rachitkay/proompter/vite")
  core/                 → framework-free engine: surface, resolver, capture, store, serializer
  ui/                   → React UI rendered into the shadow root
  ui/primitives/        → Button, IconButton, Chip, Menu, Tooltip, Kbd, Segmented, Sheet (all hand-built; no Radix — see D5)
  ui/styles.css         → Tailwind 4 source → compiled to a string at build time
examples/playground/    → Next 16 app with a Gamorite-like mock page (the prototype's host markup)
examples/vite/          → plain React app on Vite 8 with @vitejs/plugin-react (D14)
```

- **Exports:** `.` (client), `./next` (server and config). `./github` and the `proompter` bin are v2/v3;
  reserve the export names now.
- **Build:** tsup (ESM and CJS, d.ts). The `"use client"` banner goes on the client entry only. CSS is
  inlined as a string export, so there's no CSS file for the host to import.
- **TypeScript:** pinned to 5.9.x, not 7.x. tsup's dts build and typescript-eslint need the TS JS API,
  which the native 7.x port doesn't ship, and typescript-eslint requires TS <6.1.
- **D5. No Radix (2026-10-10, supersedes D1.2):** Proompter uses no Radix packages. Radix Dialog's
  modal mode locked host scroll, injected a host `<style>` and set `aria-hidden`/`pointer-events` on the
  host. Radix Menu always inserts `data-radix-focus-guard` spans into the host `document.body`, even with
  `modal={false}`. Its roving focus also fails inside a shadow root, so keyboard navigation was already
  ours. Both break §1.2. The Menu is hand-built (task T02b) with the same API: roles, keyboard, typeahead,
  dismiss, placement and scale-in. Runtime dependencies are `@babel/parser`, `magic-string`,
  `@jridgewell/remapping`, `html-to-image` and `bippy`.
- **D2. UI kit rulings (T02, 2026-10-10):**
  1. Tokens sit on a `.pp` wrapper inside the shadow root (with `all: initial`), not on `:root`.
  2. **Fonts:** while the kit is enabled, inject one `<style data-proompter-fonts>` into `document.head`,
     and remove it on disable. It declares the namespaced families "Proompter Sans" and "Proompter Mono",
     so it never collides with a host that loads Geist. The files are Geist and Geist Mono variable woff2,
     latin subset, as data URIs in the lazy UI chunk only, never the entry chunk. The system stack is the
     fallback. Geist is OFL: ship `licenses/Geist-OFL.txt` and mention it in the README.
  3. Tooltip and menu timings match the prototype exactly.
  4. **Toasts pause on hover** (Sonner's rule, which beats the prototype here). The container is
     `pointer-events: none` and each toast is `auto`. Hovering any toast pauses every timer, and a 4th
     toast pushes the oldest out with the exit animation.
  5. **One priority vocabulary:** `blocking | important | minor` everywhere (UI keys, CSS classes,
     serializer), with no mapping layer.
  6. `@storybook/addon-a11y` is a dev dependency.
- **D4. Root behaviour rulings (T08, 2026-10-10):**
  1. The ticket's Viewport property is read-only: it records where the entry was filed. Clicking it does
     "Show on page" on that viewport.
  2. Capture starts when `<Proompter>` mounts (flag on), after idle, from its own small chunk, not on
     the kit's first open. That way errors from before the reviewer opened the kit are still captured.
     Everything patched is restored on unmount.
  3. The command menu is non-modal with its own focus trap, so nothing touches the host document
     (§1.2). `@radix-ui/react-dialog` is dropped if nothing else needs it.
- **D6. Route location (2026-10-10):** the dev file writer is mounted at `app/api/proompter/route.ts` and
  served at `/api/proompter`, a conventional place with no encoded folder names (`_`-prefixed app folders are
  private in Next). The client's `endpoint` is configurable and defaults to `/api/proompter`.
- **D7. Contrast beats the prototype (2026-10-10):** WCAG AA is the floor (§11.5). The prototype's
  `--fg-3` (#71717a, about 3.7:1) and white-on-coral primary button (about 2.9:1) fail axe, so:
  - `--fg-3` is #9a9aa3, which passes on every surface including the `--fill-3` hover fill;
  - text that used `--fg-4` now uses `--fg-3`, and `--fg-4` is only for decorative strokes and dots;
  - the ticket's section headings are `h3` (heading order);
  - **Primary buttons, final (Rachit):** white text (`--acc-fg: #fff`) on a deeper coral,
    `--acc-solid: #d63c3c` (4.59:1, AA). Hover is `#cc3b3b` and active is `#c23636`. `--acc` stays
    `#ff6363` for everything that isn't text on a fill: the active tool, pins, the focus ring, highlights
    and the logo.
  `design/prototype.html`'s tokens are updated to match, so the reference doesn't drift.
- **D8. Keyboard picking (§11.5, 2026-10-10):** element picking also works with no pointer, as a full tree
  navigator.
  - Entering pick mode by keyboard (`P`) targets the surface's main landmark, or failing that body's first child.
  - `Tab`/`Shift+Tab` move to the next or previous focusable element in the surface.
  - `↑`/`[` go to the parent. `↓`/`]` go back down the walked path, or to the first child.
  - `←`/`→` move to the previous or next sibling.
  - `Enter`/`Space` commit, which opens the composer. `Esc` exits.
  - Every one of these keys is `preventDefault`ed, so host focus and scroll never move. Under D9 this is
    plain key handlers in the existing pick module, with no navigator framework.
  - Each move is announced through an `aria-live` region (label plus source).
  - An e2e runs the flow keyboard-only on Responsive and Mobile: `P` → navigate to the avatar → `Enter` → `⌘↵`
    → file on disk. This is task T04b.
- **D10. Solid surfaces (2026-10-10, Rachit):** the backdrop blur didn't render in the Gamorite trial, so
  surfaces looked see-through. All surfaces are now solid: `--mat-1: #1e1e22` (small chrome) and
  `--mat-2: #161619` (big surfaces), the values the reduced-transparency fallback used. Every
  `backdrop-filter`, the `--blur-*` tokens and the `prefers-reduced-transparency` override are removed. Shadows,
  the top-edge highlight and borders stay, so depth still reads. rgba fills on top of surfaces are unchanged.
  The prototype uses the same tokens.
- **D11. Host modals stay open (2026-10-10, Rachit, Gamorite trial):** events from the shadow root reach the
  document retargeted to `<proompter-root>`, so a host modal (Radix Dialog) took any click in the kit as an
  outside click and closed. `shadow-root.tsx` shields the host page:
  - pointer, mouse, click, touch, wheel and focusin/focusout events stop at the host element, so outside-click,
    focus-outside and scroll-lock listeners never see them. The kit's own document listeners are capture-phase
    or keydown, so they still run.
  - A window capture-phase `focusout` guard stops focus moving from an app dialog into the kit, so a focus trap
    doesn't pull it back.
  - `Esc` inside the kit is default-prevented before the app's capture listeners, which skip handled events.
    The Esc ladder ignores that mark (`isShielded`).
  - While picking, the pick engine hands `Esc` straight to the ladder, so it leaves the mode and doesn't close
    the app's dialog.
  - A modal's `aria-hidden` is taken off the host, so the kit stays reachable to assistive tech.
  Picking inside the dialog works as before. A click on the app itself still closes it. `e2e/app-dialog.spec.ts`
  covers this against a real Radix Dialog (`radix-ui`, a playground dev dependency only).
- **D13. Unset flag must fold away (2026-10-10, release prep):** Next only inlines `NEXT_PUBLIC_*` variables
  that exist at build time. With `NEXT_PUBLIC_PROOMPTER` truly unset, the layout's flag check stayed a runtime
  read, so the dynamic import survived and a fresh app shipped the kit's client chunks. The playground's 11.1
  build had set the flag to `""`, which hid this. `withProompter` now defines the flag as `""` when it is
  unset. `scripts/e2e-servers.mjs` builds the 11.1 app with the variable removed, and that check failed before
  the fix.
- **D14. Plain React on Vite (2026-10-10, Rachit):** `@rachitkay/proompter/vite` exports `proompter()`, one Vite
  plugin that does what `withProompter` and the route do in Next. It reuses the same stamping code and the same
  route, so the guards and the file format are identical.
  - The flag is `VITE_PROOMPTER`, from the shell or `.env*`, or `proompter({ enabled })`. The plugin defines
    `import.meta.env.VITE_PROOMPTER` as `"true"` or `""` from that one decision.
  - Stamping is a `pre` transform on the app's `.tsx`/`.jsx`, never node_modules.
  - The route is mounted with `configureServer` at `/api/proompter`, on the dev server only.
    `createProompterRoute` gained `enabled`, so the Vite plugin can skip the Next env check.
  - The app renders `<Proompter />` through a `lazy` import inside the flag check.
  - `vite` is an optional peer dependency (>=5). `examples/vite` is the standard template plus the plugin.
    `e2e/vite.spec.ts` picks an element in dev and finds the file on disk with its source. It also checks that a
    flag-unset build ships no kit, no stamps and no route.
  - Other bundlers (webpack without Next, Parcel) aren't supported yet.
- **v2/v3 decisions (2026-10-10, Rachit approved the plan; tasks in `tasks/v2/`).** Rachit's rulings:
  - The task/test-plan plugin is generic and lives in the package.
  - GitHub sync is tested against a fake GitHub API plus one live smoke test.
  - Zip export/import is dropped.
  - The release is prepped as 0.1.0 locally.
- **D15. Preview mode (T11).** In a non-development build with the flag on (a deployed preview), the kit ships
  **dormant**.
  - Dormant means: no capture, no UI chunk, only `window.__proompter` and the chord listener.
  - `window.__proompter.enable()`, or the `⌘⇧.` chord, activates it: capture starts and the kit opens.
  - The choice persists in `localStorage["proompter:enabled"]` for that origin. `disable()` clears it and stops
    capture.
  - Dev is unchanged: it is always active, and capture runs from mount (D4).
  - Entries are kept in IndexedDB. The files sink stays off outside dev, as today.
  - The D13 prod-off guarantee is unchanged: with the flag unset, nothing ships.
- **D16. GitHub sync (T12).** `@rachitkay/proompter/github` exports
  `createGithubRoute({ repo, token, branch = "reviews", reviewKey })`, which returns Web `{ GET, POST }`.
  - **Mounting:** Next mounts it at `app/api/proompter/github/route.ts`. Any other server mounts the same handlers.
  - **Token:** it never leaves the server. A PAT with contents and issues write is enough.
  - **Files:** each entry is written to the branch through the Contents API, in the files sink's layout
    (`reviews/<session>/…`, the same serializer), so local and remote reviews are interchangeable.
  - **Issues:** one issue per entry, upserted. Labels are `proompter`, `kind:<k>` and `priority:<p>`. The body is
    the entry markdown, with its snapshot linked from the branch. The entry's `issue` field stores the number.
  - **Status, both ways:** sync reports issue state back. Resolving locally closes the issue. An issue closed on
    GitHub marks the entry resolved, with one activity line, on the next sync.
  - **Client:** `createGithubSink` (`src/core/sinks/github.ts`) is enabled by the kit's `github={{ endpoint }}`
    prop.
    - It is manual: the Publish tab's "Sync to GitHub" sends one entry per request.
    - It works in dev and preview, next to the files sink.
  - **Guard:**
    - Every request needs `x-proompter: 1`, same-origin, and `Authorization: Bearer <reviewKey>`.
    - `reviewKey` defaults to `process.env.PROOMPTER_REVIEW_KEY`, and the route answers 404 when it is unset.
    - The kit asks the reviewer for the key once and keeps it in `localStorage`.
    - The body cap and the field validation are shared with the dev route (`src/server/`).
- **D17. Snapshot redaction (T13).** The snapshot is masked inside html-to-image's cloned DOM: it renders
  `toSvg`, parses the SVG, blacks out the matching elements in the clone, then draws the PNG itself. The mask is
  part of what gets rendered, so it covers the field wherever the clone lays it out. Measuring on the live page
  failed: the clone's layout can differ (grid, for one), which leaked fields during review.
  - Masked: `[data-proompter-redact]`; by default `input`, `textarea`, `select`, `output`, `[contenteditable]`,
    `[role=textbox]` and `[role=combobox]`; and the selectors in a plugin's `redactSnapshot`.
  - A masked element gets a black background and `filter: brightness(0)`, which makes the whole box and everything
    inside it pure black. Field values are cleared in the clone.
  - The live page is never touched.
  - It fails closed: if any step throws, that PNG is dropped, the entry is saved without it, and a toast says so.
- **D18. Generic repo plugin (T14).** `@rachitkay/proompter/plugins` exports `repoPlugin({ tasks, testPlan,
  context })`.
  - `tasks`: route globs mapped to repo files. They feed `taskFor`, and so the Task chip.
  - `testPlan`: section names, which feed the Test plan menu.
  - `context`: extra frontmatter.
  - `globToRegExp` moves to `src/core/glob.ts`, a pure module the loader re-exports.
- **D19. CLI (T15).** The `proompter` bin works on `./reviews/` with the v1 parser and writer. It adds no new
  format.
  - `list [--status --priority --route --session]`.
  - `show <ref>`.
  - `task <ref>` prints an agent-ready task.
  - `resolve <ref> [--note "…"] [--require-test]`.
  - `ref` is `<session>/PRO-n`, or `PRO-n` when that is unambiguous.
  - Test-plan linking: `test_plan` may name a test file. `--require-test` refuses unless that file exists.
- **D20. MCP server (T16).** `proompter mcp` is hand-written JSON-RPC 2.0 over stdio, with no dependency.
  - Methods: `initialize`, `tools/list`, `tools/call`.
  - Tools: `list_entries`, `show_entry`, `entry_task`, `reply_entry` and `resolve_entry`.
  - `reply_entry` adds a `## Replies` line and an activity line.
  - It is a thin wrapper over the CLI core.
- **v1 gaps (T17):**
  - `isProompterFrame()` export, for apps that double-mount providers in device frames.
  - Esc during the composer's exit animation goes to the Esc ladder.
  - The D11 focusout guard is narrowed to app modals (`[aria-modal="true"]`, `[role=dialog]`,
    `[role=alertdialog]`; Radix sets the role without `aria-modal`), so other app inputs still get blur.
  - An `Alt+K` fallback for the command menu (Firefox owns `Ctrl+Shift+K`).
- **Peer dependencies:** `react >=19`, `react-dom >=19`, `next >=15.3` (optional, only for `./next`), `vite >=5`
  (optional, only for `./vite`, D14).
- **Dependencies:**
  - `html-to-image` (snapshots)
  - `bippy` (dev owner stack, optional)
  - no Radix (D5)
  - `@babel/parser`, `magic-string` (loader)

  Keep the client bundle small: lazy-load the UI chunk on first open.

- **D1. Dependency ruling (Rachit, 2026-10-10):**
  1. **No `motion` dependency.** The prototype uses no animation library, so match it with:
     - CSS transitions and keyframes, using the prototype's easing tokens (`--ease`, `--ease-drawer`)
     - the Web Animations API for anything driven by code
     - for the dock's release and edge snap, a small in-house spring at `src/core/spring.ts`
       (~50 lines): damping 1.0, response 0.35, velocity handoff, rAF-driven, cancellable, honours
       reduced motion, unit-tested
  2. **Radix: per-primitive packages only, and only the ones we use:**
     - `@radix-ui/react-dropdown-menu` for the property, status and tag menus
     - `@radix-ui/react-dialog` for the command menu's focus trap
     - `@radix-ui/react-popover` only if the composer needs it for focus handling; otherwise the
       composer is custom-positioned, as in the prototype

     Never the umbrella `radix-ui` package. Tooltips, the segmented control, chips and the sheet are
     hand-built, as in the prototype. Every portal uses `container` = the shadow root.
  3. Any new runtime dependency needs sign-off.
  4. **D1.3 (T03):** `@jridgewell/remapping` is a runtime dependency (the loader composes the incoming
     source map, as webpack and Turbopack expect), and `@jridgewell/trace-mapping` is a dev dependency (for
     the source-map tests). `engines.node` is `>=22.18`, because `dist/next/loader.cjs` `require()`s the
     ESM-only `@babel/parser` and `magic-string`. The loader rethrows `ERR_REQUIRE_ESM` as
     "@rachitkay/proompter/next needs Node 22.18 or newer (found vX)".

## 3. Turning it on

```ts
// next.config.ts
import { withProompter } from "@rachitkay/proompter/next";
export default withProompter(nextConfig, { enabled: process.env.NEXT_PUBLIC_PROOMPTER === "true" });

// app/layout.tsx (a server layout). The flag check is constant-folded, so with the flag unset the
// import is dropped and no Proompter chunk is referenced (§11.1). A static import would keep it.
const Proompter = process.env.NEXT_PUBLIC_PROOMPTER === "true"
  ? (await import("@rachitkay/proompter")).Proompter : null;
// inside <body>:
{Proompter && <Proompter session={{ reviewer: "rachit" }} />}

// app/api/proompter/route.ts   (dev-only file writer, served at /api/proompter; D6)
export { POST, GET } from "@rachitkay/proompter/next/route";
```

- `enabled: false` makes `withProompter` return the config untouched. No loader, no route.
- At runtime, `⌘⇧.` or `window.__proompter.open()` / `.close()` / `.toggle()` show or hide the kit.
- **Frame mode:** when the URL has `?__proompter_frame=1`, the kit renders nothing and only exposes
  its capture hooks to the parent (used by the viewports, §6).

## 4. Source mapping

`resolveTarget(el) → { el, selector, source, inherited, label, crumb, query? }`

1. **Compile-time stamping:** `next/loader.ts` parses each `.tsx`/`.jsx` file in the app (not
   `node_modules`) and adds `data-src="<repo-relative path>:<line>:<col>"` to **every intrinsic JSX
   element** (lowercase tag), plus `data-comp="<ComponentName>"` on the root element each component
   returns.
   - It runs through Turbopack `rules` (Next ≥15.3) and webpack as a fallback.
   - It's active in dev and in preview builds when enabled, and never when `enabled: false`.
   - It must keep source maps working: use magic-string and pass the map on.
2. **Pick targets the deepest element under the cursor** (≥6×6 px), never a component boundary.
   - Source = the element's own `data-src`, or else the nearest stamped ancestor's (`inherited: true`).
   - The UI shows an inherited source with a `↳` prefix.
3. **Selector:** the shortest unique path. Use a unique `data-src` if there is one; otherwise an
   `nth-of-type` chain anchored at the nearest unique stamped ancestor. It's stored on the entry, and
   used for pins, "Show on page" and snapshots.
4. **Label:** the component name if stamped. Otherwise the tag plus a hint (`img · avatar`,
   `button “Share”`, `p “Clutched a 1v4…”`). `crumb` is the component chain down to the element.
5. **Dev only:** the bippy owner stack, if available, adds the component chain for unstamped trees.
6. **Tree walk while picking:** `↑` or `[` goes to the parent, `↓` or `]` goes back down the walked
   path. Alt plus wheel does the same.

## 5. Capture (in-memory ring buffers, while `<Proompter>` is mounted with the flag on; D4.2)

- **Console:** the last 50 `error` and `warn` entries (timestamp, level, message, first stack frame).
- **Network:** the last 50 `fetch` and XHR calls (method, URL, status, duration, a request/response
  excerpt of ≤2 KB). Patched on enable, restored on disable.
- **Redaction** runs before anything is stored. It strips:
  - `authorization`, `cookie` and `set-cookie` headers
  - values matching email, JWT and `token|secret|password|api[_-]?key`
  - anything a host-supplied `redact(entry)` hook removes

  It's on by default and can't be turned off for prod-data sessions.
- **Query cache (optional adapter):** `queries: () => Array<{ key, status, updatedAt }>`. Gamorite
  passes its TanStack Query client.
- **Snapshot:** `html-to-image` of the surface document, giving an element crop (with padding) and the
  visible viewport, both as PNG. Fonts are embedded where same-origin; otherwise it falls back to
  system fonts and records that it did.

## 6. Surfaces and viewports

A **surface** is what the kit reviews: `{ doc, win, toScreen(rect), scale }`.

- **Responsive (default):** the surface is the live page itself. Pins and overlays sit on top of it.
- **Desktop 1440×900, Tablet 834×1194, Mobile 390×844, plus rotate:**
  - The surface is a same-origin `<iframe>` of the current URL with `?__proompter_frame=1`, scaled
    to fit inside a device bezel.
  - Only **one viewport is shown at a time.**
  - **Every tool works inside the frame:** the kit attaches its listeners to the frame's document.
- **Entries record their viewport and exact size.** Pins only show on the viewport an entry was filed
  on. "Show on page" switches to it first.
- If a page refuses to be framed (X-Frame-Options or CSP), show an inline notice.

## 7. UI (match the prototype exactly)

- **Dock:**
  - Its parts, in order:
    - grip
    - brand (click to collapse or expand)
    - Pick, Multi, Box, Text and Note
    - Freeze
    - the viewport segmented control
    - Rotate
    - the command menu
    - Entries, with an open-count badge
  - **Dragging:**
    - It stays 1:1 under the pointer from where it was grabbed, and resists softly past the window edge.
    - On release it projects the drag speed: landing within 72px of the left or right edge snaps it
      there as a vertical bar.
    - `↑` `↓` `←` `→` on the grip move it in steps, and a double-click resets it.
    - Position and collapsed state are saved in `localStorage` under the keys `proompter.dock` and
      `proompter.collapsed`.
  - **Collapsed:** only the grip and the logo show, plus the open count as a corner badge in vertical
    mode.
  - Tooltips take 350ms the first time, then appear instantly while warm, and always open away from
    the screen edge.
- **Composer:** anchored to the target, growing out of it. Contents:
  - a header with the target, the source chip (copy) and the viewport size
  - title (required) and description
  - property chips with menus: Intent, Priority, Tags, Test plan, plus a read-only Task chip from a plugin
  - a collapsible "Context attached" block
  - `⌘↵` creates the entry. Esc, or clicking outside, discards it.
- **Pins:** numbered, coloured by priority; resolved pins turn grey. A hover card shows the title and
  priority. Pins pop in only once.
- **Sheet:** slides in from the right, or from the left when the dock is docked to the right edge. It
  switches sides by fading out and back in, never by sliding across the screen. Two tabs:
  - **Entries:** grouped Open / In progress / Resolved, with rows of priority, ID, status, title, a
    viewport icon and the time.
  - **Publish:** the files that will be written, and (v2) the issues that will be opened.
- **Ticket**, the entry detail view:
  - a breadcrumb and the title
  - description
  - **Properties**, each editable: Status, Priority, Intent, Viewport, Tags, Test plan, GitHub
  - **Where:** crumb, Source (↳ if inherited, copy), Element (copy the selector), Task, Route, and a
    snapshot with an Element/Viewport toggle
  - **Captured context:** Console and Network tabs
  - **Activity**
  - **File:** a markdown preview
  - **Footer:** Show on page, Copy for agent, Resolve
  - The Viewport row is read-only, as in the prototype. Clicking it shows the entry on that viewport (D4.1).
- **Command menu (`⌘⇧K`):** tools, viewports, open entries, all entries, publish. Searchable, fully
  keyboard-driven.
- **Shortcuts:**
  - `P` `M` `B` `T` `N` pick tools
  - `F` freeze
  - `R` rotate
  - `1`–`4` viewports
  - `E` entries
  - `⌘⇧K` command menu
  - `⌘⇧.` show or hide the kit
  - `Esc` closes things in order: menu, composer, command menu, current mode, ticket, sheet
- **Tokens:** take every colour, radius, shadow, type size and easing from the prototype's `:root`
  block. Font: Geist / Geist Mono. Respect `prefers-reduced-motion`
  and `prefers-contrast`. Surfaces are solid (D10), so there is no transparency to reduce.

## 8. Storage and the file format (v1: files)

**Sessions:** one folder per review session, created on the first save.

```
reviews/<YYYY-MM-DD>_<session-slug>/
  session.md                     # title, reviewer, branch, sha, env, started, entry index
  entries/<NNN>-<title-slug>.md  # one per entry
  assets/<NNN>-<viewport>.png    # element crop;  <NNN>-<viewport>-full.png = viewport
```

- **In dev, entries are written straight away** through `createProompterRoute()`.
  - It only exists when `NODE_ENV=development` and `enabled`.
  - It writes only inside `<repo>/reviews/`, so path traversal is refused.
  - It doesn't use git; the developer commits the files.
- **The client also keeps everything in IndexedDB.** If the route is unavailable (preview or prod),
  entries stay local until published (v2).

**Entry file:**

```markdown
---
id: PRO-5
session: 2026-10-10_manual-test-pass
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

- The format is **stable and versioned** (`proompter: 1` in `session.md`).
- **D3. Format v1 details (T07, 2026-10-10):**
  1. `kind:` is always written (`element | note | text | multi | box`). The parser still accepts a
     missing `kind` and infers element or note from whether `selector` is present.
  2. `ref: <session-slug>/PRO-n` is the fully qualified reference. Numbering is per session, so two
     sessions can both have `PRO-1`. Use `ref` wherever an entry leaves its session ("Copy for agent",
     GitHub issue bodies). Toasts may stay short.
  3. Multi and box entries add a `## Targets` section, and their frontmatter mirrors the first target. A
     text entry's quote is a `> ` block under the title. Notes have `source: null`. Plugin `extra`
     fields go after `created`. `session.md` has a `session:` line.
  4. `## Context` lists every console line under the summary, as the prototype does.
  5. The Test plan and Task chips are hidden when no plugin supplies them.
  6. **Redaction fails closed.** The built-in redaction always runs first. If a plugin's `redact` throws
     or returns a mismatched entry, nothing is stored or emitted, the number isn't used, and the
     composer shows "Plugin <name> failed to redact this entry. Nothing was saved."
- "Copy for agent" copies exactly this text.

## 9. Plugins (host-side, nothing host-specific in the package)

```ts
<Proompter plugins={[gamoriteTasks()]} />
type ProompterPlugin = {
  name: string;
  taskFor?(t: { source?: string; route: string }): string | null;  // e.g. route → T-*.md
  context?(): Record<string, unknown>;                                // extra frontmatter fields
  testPlan?: string[];                                                // sections for the Test plan menu
  redact?(entry: Entry): Entry;
};
```

Gamorite's plugin lives in Gamorite's own repo. It maps routes to tasks using the `routes:` field in
the frontmatter of `migration/_tasks/T-*.md`.

## 10. Roadmap

The v2/v3 direction, with the known v1 gaps, is in [specs/ROADMAP-v2-v3.md](specs/ROADMAP-v2-v3.md). It's a brief, not
tasks yet.

- **v1 (this spec):** everything in §3–§9, with the files sink and the playground.
- **v2:**
  - IndexedDB sync to a `reviews` branch through the GitHub Contents API
  - issues opened and synced both ways (status, close on resolve), via `./github` with a
    server-only token
  - preview-build support
  - the Gamorite plugin
- **v3:**
  - the `proompter` CLI: `list`, `show`, `task`, `resolve`, `import`
  - an MCP server, so agents can list, reply and resolve
  - npm publishing through CI with provenance

## 11. Acceptance (v1)

1. With the flag unset, `next build` output is identical in route table and size, and no
   `data-src` appears in the HTML.
2. In the playground in dev: picking the avatar inside the post card writes
   `reviews/<session>/entries/001-*.md` with the right `source`, `source_inherited`, `selector` and a
   PNG.
3. The same flow works on Mobile and Tablet viewports, and the pin shows only on that viewport.
4. Host CSS can't change the kit, and the kit's CSS can't change the host. A Playwright visual test
   proves both.
5. axe is clean on the kit UI. Everything works keyboard-only. Reduced-motion is respected.
6. Unit tests cover:
   - the resolver
   - the selector's uniqueness
   - redaction
   - serializer round-trips (parse(serialize(e)) == e)
   - the loader's output on fixture files, including source maps
7. **Published exports are exact.** With `PROOMPTER_RELEASE=1`, `package.json` `exports` keys are exactly
   `.`, `./next`, `./next/route`, `./vite` (D14) and the reserved `./github`. The test-only `./internal/fixtures` export
   (used by the playground's `/fixtures/*` e2e routes) must be removed or gated out of the release build.
   A unit test asserts this, and it passes in CI.
