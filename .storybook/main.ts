import path from "node:path";
import type { StorybookConfig } from "@storybook/react-vite";
import { mergeConfig, type Plugin } from "vite";
import { compileCss } from "../build/inline-css.ts";

// Same `?inline` semantics as the tsup build and vitest.config.ts: the compiled Tailwind CSS as a
// default-export string, which the shadow root injects into itself.
const inlineCss: Plugin = {
  name: "proompter-inline-css",
  enforce: "pre",
  async resolveId(id, importer) {
    if (!id.endsWith(".css?inline")) return null;
    const file = importer ? path.resolve(path.dirname(importer), id.replace(/\?inline$/, "")) : id;
    // Must not end in `.css`, or Vite's css plugin claims the module.
    return `\0proompter-inline:${file}.js`;
  },
  async load(id) {
    if (!id.startsWith("\0proompter-inline:")) return null;
    const file = id.slice("\0proompter-inline:".length, -".js".length);
    this.addWatchFile(file);
    return `export default ${JSON.stringify(await compileCss(file))};`;
  },
};

const config: StorybookConfig = {
  stories: ["../src/**/*.stories.@(ts|tsx)"],
  framework: "@storybook/react-vite",
  addons: ["@storybook/addon-a11y"],
  async viteFinal(viteConfig) {
    return mergeConfig(viteConfig, { plugins: [inlineCss] });
  },
};

export default config;
