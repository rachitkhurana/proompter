import fs from "node:fs";
import path from "node:path";
import { stampSource, type StampResult } from "../../src/next/loader.ts";

const FIXTURES = path.join(import.meta.dirname, "fixtures");

export const readFixture = (name: string): string => fs.readFileSync(path.join(FIXTURES, name), "utf8");

/** Repo-relative path the tests pretend a fixture lives at. */
export const relOf = (name: string): string => `fixtures/${name}`;

export function stampFixture(name: string): { code: string; out: StampResult } {
  const code = readFixture(name);
  const out = stampSource(code, relOf(name));
  if (!out) throw new Error(`${name}: expected the loader to stamp this fixture`);
  return { code, out };
}

/** 1-based `line:col` of the first occurrence of `needle` (what `data-src` should say for it). */
export function locOf(code: string, needle: string): string {
  const index = code.indexOf(needle);
  if (index < 0) throw new Error(`needle not found: ${needle}`);
  const before = code.slice(0, index);
  const line = before.split("\n").length;
  const col = index - (before.lastIndexOf("\n") + 1) + 1;
  return `${line}:${col}`;
}

/** The full opening tag (`<div data-src="..." ...>`) of the first `<tag` in the output. */
export function openTag(code: string, tag: string): string {
  const m = code.match(new RegExp(`<${tag}(?=[\\s/>])[^>]*>`));
  if (!m) throw new Error(`no <${tag}> in output`);
  return m[0];
}

/** 0-based generated position of a string index, as source maps use. */
export function genPos(code: string, index: number): { line: number; column: number } {
  const before = code.slice(0, index);
  return { line: before.split("\n").length, column: index - (before.lastIndexOf("\n") + 1) };
}
