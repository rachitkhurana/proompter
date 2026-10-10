# T11: Preview mode (DESIGN D15)

**Goal:** a deployed preview (a production build with the flag ON) ships the kit dormant. Reviewers turn it on at
runtime, and nobody else pays for it.

**Owns:**
- `src/ui/proompter.tsx`
- `src/ui/proompter-deps.ts` (the `ProompterApi` type)
- `src/ui/proompter.test.tsx`
- `e2e/preview.spec.ts`
- `scripts/e2e-servers.mjs` (adding servers only)
- `examples/playground/next.config.ts` if needed
- README "Preview builds" section

## Behaviour
- **Dev is unchanged:** `process.env.NODE_ENV === "development"`.
- **Dormant:** any other `NODE_ENV`, while `localStorage["proompter:enabled"] !== "1"`.
  - `HostMode` still registers `window.__proompter` and the chord listener.
  - It does NOT start capture and does NOT load the UI chunk.
  - `entries()` returns `[]`.
- **`window.__proompter.enable()`:** sets the key (wrapped in try/catch), starts capture and opens the kit.
- **`disable()`:** clears the key, closes the kit, stops capture (`box.capture?.disable()`) and returns to dormant.
- **Chord:** `⌘⇧.` while dormant behaves like `enable()`.
- **Active:** with the key set on load, it behaves as in dev: capture starts when idle, and the kit opens on chord
  or `open()`.
- **`open()` / `toggle()`:** work only when active. Dormant, `open()` does nothing (only `enable()` and the chord
  activate).
- **Frame mode:** unchanged.
- **Files sink:** stays disabled outside dev, as today (`defaults.tsx`; don't touch it).
- **Types:** add `enable(): void`, `disable(): void` and `enabled(): boolean` to `ProompterApi`.

## Tests
- **Unit** (`proompter.test.tsx`), with `NODE_ENV` stubbed to "production":
  - dormant: no capture import, no UI chunk
  - enable → capture and open
  - disable → back to dormant
  - persists across remount via localStorage
  - dev is unchanged
- **e2e** (`e2e/preview.spec.ts`): add a third playground build, `next build` with `NEXT_PUBLIC_PROOMPTER=true`
  (production NODE_ENV) into `.next-preview`, served by `next start` on `BASE + 4` (see `E2E_PORT_BASE` in `playwright.config.ts`).
  - The page loads and `window.__proompter.enabled()` is false.
  - There is no `<proompter-root>`.
  - Network: no UI chunk is requested before enable.
  - After `enable()`: the dock shows, and picking the avatar plus ⌘↵ shows PRO-1 in the entries sheet (IndexedDB).
    `data-src` is present (the loader ran).
  - A reload stays enabled. After `disable()` and a reload, it is dormant.
- **Prod-off:** the existing `e2e/production.spec.ts` (flag unset) must stay green, untouched.

## Docs
README: a "Preview builds" section covering build with the flag, `enable()`/`disable()`, and that entries stay in
the browser until GitHub sync (D16).
