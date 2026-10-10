# T17: v1 gaps

**Owns:**
- `src/index.ts` (one export)
- `src/ui/proompter.tsx` (`isProompterFrame` only)
- `src/ui/shadow-root.tsx`
- `src/ui/shell/shortcuts.ts`
- `src/ui/shell/ui.tsx` (the Esc-while-exiting change only)
- `src/core/pick.ts` (if needed)
- the tests for these
- `e2e/app-dialog.spec.ts` (extend)
- README Shortcuts and FAQ

1. **Frame hint:** export `isProompterFrame(): boolean` from `.` (true inside a device viewport frame:
   `?__proompter_frame`). Document it in the README FAQ "My app mounts twice in device viewports", with a
   snippet that skips a provider in frames.
2. **Esc during the composer exit:** today, while the composer animates out (~200ms), the engine is still busy
   and Esc from the page reaches the app.
   - Fix: while busy, pick's Esc goes to the ladder (stopped at window capture), the same as in pick mode.
   - Test: e2e in `app-dialog.spec.ts`. Esc right after the composer's own Esc must keep the dialog open.
3. **D11 focusout guard:**
   - Today it stops every focusout whose relatedTarget is our host, so app inputs lose their blur handlers.
   - Narrow it: stop it only when the focusout target is inside an element with `[role=dialog][aria-modal=true]`,
     or an element carrying Radix's `data-radix-focus-guard` siblings? KISS: `[aria-modal="true"]` ancestor only.
   - Test: an app input outside any modal gets its blur event when focus moves into the kit, and the D11 dialog
     test still passes.
4. **Firefox:** add `Alt+K` as a second command-menu binding (Option+K on Mac produces "˚", so match on
   `ev.code === "KeyK"`). Document it in the Shortcuts table. Unit test both bindings.
