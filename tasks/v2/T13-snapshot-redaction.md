# T13: Snapshot redaction (DESIGN D17)

**Goal:** PNG snapshots never show typed values or marked secrets.

**Owns:**
- `src/core/capture/snapshot.ts`
- `src/core/capture/snapshot.test.ts`
- `src/core/capture/types.ts` (only if needed)
- `src/core/entry.ts` (only the `ProompterPlugin.redactSnapshot` field)
- the toast wiring at the call site of `takeSnapshot` (find it; report the path)
- `e2e/snapshot-redaction.spec.ts`
- a playground fixture element for it (`examples/playground`, one small addition)
- README "What gets redacted" section

## Behaviour
- **After each `toPng`,** load the PNG into an `<canvas>` and fill solid rectangles (`#000`) over each masked
  element's rect, relative to the rendered node (account for the element crop's PADDING, and for the viewport
  scroll offset). Then re-encode it.
- **Masked:**
  - `[data-proompter-redact]` (the element's border box);
  - every `input` (except type=button/submit/reset/checkbox/radio/range/color), `textarea` and `[contenteditable]`
    (the content box);
  - plus selectors from plugins' `redactSnapshot?: string[]`. KISS: a string array, not a function.
- **Scope:** only elements that intersect the rendered area. Use the surface's own document (device frames
  included).
- **Fails closed:** if masking throws, drop that PNG (`element`/`viewport` undefined), call
  `onError("snapshot:redact", e)`, and set `result.redactFailed = true`. The UI shows a toast: "Snapshot hidden: it
  couldn't be redacted."
- **Plugins:** they reach `takeSnapshot` through its caller. Thread the selectors in; don't import the store into
  capture.

## Tests
- **Unit:**
  - rect math (crop padding, scroll offset)
  - selector set (input types excluded or included)
  - fail-closed path (canvas throws → no PNG, `redactFailed`)
  - plugin selectors honoured
- **e2e:** a playground input with a typed value and a `[data-proompter-redact]` block.
  - Pick a parent, file it, read the PNG from disk.
  - Assert that the masked region's pixels are all `#000`, using `pngjs`? NO new dependency. Decode by drawing the
    PNG file into a canvas inside the page with `page.evaluate` and reading `getImageData`.
- **Visual baselines:** must stay unchanged. They contain no inputs; if one does, report it.

## Docs
README "What gets redacted": snapshots are now masked. Name exactly what is masked, how to mark more, and that it
fails closed. Remove the "not covered" warning, and keep the advice about production data.
