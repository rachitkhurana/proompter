# T03 Source-stamping loader

**Owns:** `src/next/loader.ts`, `src/next/with-proompter.ts`, `src/next/index.ts` (exports),
`test/loader/**`.

**Do:**
- A loader for `.tsx` and `.jsx` outside `node_modules`:
  - parse with `@babel/parser` (`jsx`, `typescript`)
  - for every JSX opening element with an intrinsic (lowercase) name that doesn't already have
    `data-src`, insert ` data-src="<path>:<line>:<col>"` with magic-string
  - the path is repo-relative and uses POSIX separators
  - put `data-comp="<Name>"` on the root intrinsic element returned by each named component
    (function or arrow component in PascalCase)
  - return the code together with its source map
- `withProompter(config, { enabled, include?, exclude? })`:
  - if `enabled` is false, return the config unchanged
  - otherwise add `turbopack.rules` for `*.{tsx,jsx}` with the loader, and a `webpack` fallback that
    composes with any existing `webpack` function
- Skip files that contain `"use server"` at the top. Skip `.stories.*` and `.test.*` files.

**Done when:**
- Fixture tests cover:
  - nested JSX
  - fragments
  - conditional elements
  - props spread
  - an existing `data-src`
  - TS generics in `.tsx`
  - a server component
- Mapping a stamped location back through the source map gives the original line.
- A disabled config deep-equals its input.
