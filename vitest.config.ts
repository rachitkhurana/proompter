import path from "node:path";
import { defineConfig, type Plugin } from "vitest/config";
import { compileCss } from "./build/inline-css.ts";

// Same `?inline` semantics as the tsup build: the compiled Tailwind CSS as a default-export string.
const inlineCss: Plugin = {
  name: "proompter-inline-css",
  enforce: "pre",
  async resolveId(id, importer) {
    if (!id.endsWith(".css?inline")) return null;
    const file = importer ? path.resolve(path.dirname(importer), id.replace(/\?inline$/, "")) : id;
    // Must not end in `.css`, or Vite's css plugin claims the module (and Vitest blanks it).
    return `\0proompter-inline:${file}.js`;
  },
  async load(id) {
    if (!id.startsWith("\0proompter-inline:")) return null;
    const file = id.slice("\0proompter-inline:".length, -".js".length);
    this.addWatchFile(file);
    return `export default ${JSON.stringify(await compileCss(file))};`;
  },
};

export default defineConfig({
  plugins: [inlineCss],
  test: {
    environment: "happy-dom",
    include: ["src/**/*.test.{ts,tsx}", "test/**/*.test.{ts,tsx}"],
  },
});
