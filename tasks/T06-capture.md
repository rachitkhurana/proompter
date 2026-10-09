# T06 Capture

**Owns:** `src/core/capture/**` (console, network, redact, queries adapter, snapshot), tests.

**Do:** DESIGN §5.
- Ring buffers of 50 entries.
- Patch and restore `console.error`/`warn`, `fetch` and `XMLHttpRequest`. Restoring is idempotent and
  doesn't break the host's own patches.
- Redaction runs before anything is stored.
- `snapshot(surface, el?)` returns the element crop and the viewport PNG via `html-to-image`.
  - In frame mode, capture the frame's document.
  - If font embedding fails because of CORS, fall back and set `fontsEmbedded: false`.

**Done when:**
- Unit tests cover:
  - redaction (headers, JWT, email, token keys)
  - patch/restore twice
  - the buffer cap
  - a snapshot that returns a data URL in happy-dom with html-to-image mocked
