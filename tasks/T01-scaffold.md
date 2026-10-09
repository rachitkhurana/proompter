# T01 Scaffold

**Owns:** repo root config: `package.json`, `pnpm-workspace.yaml`, `tsconfig*.json`, `tsup.config.ts`,
`vitest.config.ts`, `.github/workflows/ci.yml`, `.storybook/`, `src/index.ts` (stub),
`src/next/index.ts` (stub), `examples/playground/` (empty Next 16 app), `README.md` (short).

**Do:**
- pnpm workspace with the root package and `examples/playground`.
- Package name `@rachitkay/proompter`, version `0.0.0`, `"type": "module"`, `"sideEffects": false`.
- Exports: `.` (client, with the `"use client"` banner) and `./next`. Reserve `./github` (throws "available in v2").
- tsup builds ESM, CJS and dts. CSS inlining is in place: `ui/styles.css` is compiled with Tailwind 4 and
  exported as a string (`import css from "./ui/styles.css?inline"` or an equivalent tsup plugin).
- Scripts: `build`, `dev` (tsup watch), `typecheck`, `test` (vitest + happy-dom), `lint` (eslint flat),
  `storybook`, `e2e` (Playwright against the playground).
- The playground is a Next 16 app with the App Router. It depends on `@rachitkay/proompter: workspace:*`.
- CI runs install, typecheck, lint, test and build on Node 22.

**Done when:** `pnpm i && pnpm build` emits `dist/` with both entries; `pnpm test` runs one passing smoke test.
