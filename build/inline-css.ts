import { readFile } from "node:fs/promises";
import tailwind from "@tailwindcss/postcss";
import postcss from "postcss";

/** Compile a Tailwind 4 stylesheet to a minified CSS string. Shared by tsup and Vitest. */
export async function compileCss(file: string): Promise<string> {
  const source = await readFile(file, "utf8");
  const result = await postcss([tailwind({ optimize: { minify: true } })]).process(source, {
    from: file,
  });
  return result.css;
}
