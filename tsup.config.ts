import path from "node:path";
import { defineConfig, type Options } from "tsup";
import { compileCss } from "./build/inline-css.ts";

type EsbuildPlugin = NonNullable<Options["esbuildPlugins"]>[number];

/**
 * `import css from "./x.css?inline"` -> the Tailwind-compiled, minified CSS as a string.
 * The host never imports a stylesheet; the UI injects this string into its shadow root.
 *
 * The resolved path deliberately keeps the `?inline` suffix: tsup ships its own `/\.css$/` onLoad
 * handler (no namespace filter) that would otherwise grab the file and emit an empty module.
 */
const inlineCss: EsbuildPlugin = {
  name: "proompter-inline-css",
  setup(build) {
    build.onResolve({ filter: /\.css\?inline$/ }, (args) => ({
      path: path.resolve(args.resolveDir, args.path),
      namespace: "proompter-inline-css",
    }));
    build.onLoad({ filter: /\?inline$/, namespace: "proompter-inline-css" }, async (args) => {
      const file = args.path.replace(/\?inline$/, "");
      const css = await compileCss(file);
      return {
        contents: `export default ${JSON.stringify(css)};`,
        loader: "js",
        watchFiles: [file],
      };
    });
  },
};

const shared = {
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  target: "es2022",
  shims: true, // `import.meta.url` in the CJS loader build (resolveLoaderPath)
  esbuildPlugins: [inlineCss],
} satisfies Options;

export default defineConfig([
  // Client entry. The "use client" banner goes here and nowhere else.
  // (No `treeshake: true`: the rollup pass strips module-level directives.)
  {
    ...shared,
    entry: { index: "src/index.ts" },
    banner: { js: '"use client";' },
    clean: true,
  },
  // Server / config entries. No banner. (`next/route` and `github` are reserved, see their stubs.)
  {
    ...shared,
    entry: {
      "next/index": "src/next/index.ts",
      "next/loader": "src/next/loader.ts",
      "next/route": "src/next/route.ts",
      "github/index": "src/github/index.ts",
    },
    clean: false,
  },
]);
