# T10 Playground, end-to-end tests and docs

**Owns:** `examples/playground/**` (beyond the T01 skeleton), `e2e/**`, `README.md`, `docs/**`.

**Do:**
- Port the prototype's mock Gamorite page (the host CSS and markup in `design/prototype.html`) into the
  playground as real React components, so the loader stamps them.
- Wire `withProompter`, `<Proompter />` and the route, behind `NEXT_PUBLIC_PROOMPTER`.
- Playwright: every scenario in DESIGN §11, plus visual snapshots of the dock, composer, ticket and
  sheet at 1440×900.
- README:
  - install
  - three-step setup (config, component, route)
  - shortcuts
  - the file format
  - the plugin API
  - an FAQ (production safety, redaction, viewports and framing)
- A Gamorite integration note in `docs/gamorite.md`: the plugin sketch for route → task. **Don't edit
  the Gamorite repo.**

**Done when:** DESIGN §11, items 1–6, all pass in CI.
