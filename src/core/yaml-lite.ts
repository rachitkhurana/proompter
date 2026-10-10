/**
 * A small, dependency-free, safe YAML subset: exactly what entry and session files need (DESIGN §8).
 *
 * Supported: a frontmatter block of flat `key: value` lines, where a value is
 *   - a plain scalar (`open`, `src/a.tsx:48:7`, `§2 Feed and posts`),
 *   - a single-quoted scalar (`'it''s'`),
 *   - a double-quoted scalar (JSON escapes: `"line\nbreak"`),
 *   - `null` / `~`, `true` / `false`, numbers (typed mode only),
 *   - a flow list of those (`[ui, data]`),
 * each optionally followed by a ` # comment`.
 *
 * Not supported (rejected with a `YamlError`, never guessed at): block scalars (`|`, `>`), flow maps, anchors,
 * nested blocks, multi-line scalars. The emitter never produces them.
 *
 * The emitter quotes anything a stricter YAML parser could read differently: empty strings, leading or trailing
 * space, indicator characters, `: ` and ` #`, words that YAML 1.1 turns into booleans / null / numbers / dates,
 * and anything with control characters or line breaks (those go double-quoted, JSON style, so they round-trip).
 */

export class YamlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "YamlError";
  }
}

export type Scalar = string | number | boolean | null;
export type YamlValue = Scalar | Scalar[];

// ---------------------------------------------------------------------------------------------------------
// Emit

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;
const WORDS = /^(?:null|~|true|false|yes|no|y|n|on|off)$/i;
const NUMBERISH = /^[-+]?(?:\d[\d_,]*\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$|^0[xob][0-9a-f_]+$|^[-+]?\.(?:inf|nan)$/i;
const DATEISH = /^\d{4}-\d{1,2}-\d{1,2}(?:[Tt ][\d:.]+\s*(?:Z|[-+]\d{1,2}(?::?\d{2})?)?)?$/;
const LEADING_INDICATOR = /^[,[\]{}#&*!|>'"%@`]/;

export interface EmitOptions {
  /** The string sits inside a flow list: `,` `[` `]` `{` `}` must be quoted. */
  flow?: boolean;
  /** Always single-quote (the `selector:` line). Control characters still force double quotes. */
  quote?: boolean;
}

/** True when `s` can be written as a plain scalar and read back as the same string. */
export function isPlainSafe(s: string, flow = false): boolean {
  if (s === "" || CONTROL.test(s)) return false;
  if (s !== s.trim()) return false;
  if (LEADING_INDICATOR.test(s)) return false;
  if ((s[0] === "-" || s[0] === "?" || s[0] === ":") && (s.length === 1 || /\s/.test(s[1] ?? ""))) return false;
  if (s.includes(": ") || s.includes(" #") || s.endsWith(":")) return false;
  if (flow && /[,[\]{}]/.test(s)) return false;
  if (WORDS.test(s) || NUMBERISH.test(s) || DATEISH.test(s)) return false;
  if (s.startsWith("---") || s.startsWith("...")) return false;
  return true;
}

export function emitString(s: string, opts: EmitOptions = {}): string {
  if (CONTROL.test(s)) return JSON.stringify(s);
  if (!opts.quote && isPlainSafe(s, opts.flow)) return s;
  return `'${s.replace(/'/g, "''")}'`;
}

export function emitScalar(v: Scalar, opts: EmitOptions = {}): string {
  if (v === null) return "null";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : emitString(String(v), opts);
  return emitString(v, opts);
}

export function emitValue(v: YamlValue, opts: EmitOptions = {}): string {
  if (Array.isArray(v)) return `[${v.map((x) => emitScalar(x, { ...opts, flow: true })).join(", ")}]`;
  return emitScalar(v, opts);
}

// ---------------------------------------------------------------------------------------------------------
// Parse

interface Quoted {
  value: string;
  rest: string;
}

function readSingle(raw: string, start: number): Quoted {
  let out = "";
  for (let i = start + 1; i < raw.length; i++) {
    const c = raw[i];
    if (c === "'") {
      if (raw[i + 1] === "'") {
        out += "'";
        i++;
        continue;
      }
      return { value: out, rest: raw.slice(i + 1) };
    }
    out += c;
  }
  throw new YamlError(`unterminated single-quoted string: ${raw}`);
}

function readDouble(raw: string, start: number): Quoted {
  for (let i = start + 1; i < raw.length; i++) {
    const c = raw[i];
    if (c === "\\") {
      i++;
      continue;
    }
    if (c === '"') {
      const literal = raw.slice(start, i + 1);
      try {
        const value: unknown = JSON.parse(literal);
        if (typeof value !== "string") throw new Error("not a string");
        return { value, rest: raw.slice(i + 1) };
      } catch {
        throw new YamlError(`bad double-quoted string: ${literal}`);
      }
    }
  }
  throw new YamlError(`unterminated double-quoted string: ${raw}`);
}

function assertTail(rest: string, whole: string): void {
  const t = rest.trim();
  if (t !== "" && !t.startsWith("#")) throw new YamlError(`unexpected text after value: ${whole}`);
  if (t !== "" && !/^\s/.test(rest)) throw new YamlError(`comment needs a space before '#': ${whole}`);
}

function plain(raw: string, typed: boolean): Scalar {
  const cut = raw.search(/\s#/);
  const s = (cut >= 0 ? raw.slice(0, cut) : raw).trim();
  if (s === "null" || s === "~" || s === "") return s === "" ? "" : null;
  if (!typed) return s;
  if (s === "true") return true;
  if (s === "false") return false;
  if (/^[-+]?\d+$/.test(s) || /^[-+]?(?:\d+\.\d*|\.\d+|\d+)(?:[eE][-+]?\d+)?$/.test(s)) {
    const n = Number(s);
    if (Number.isFinite(n)) return n;
  }
  return s;
}

function parseScalar(raw: string, typed: boolean): Scalar {
  const t = raw.trimStart();
  if (t.startsWith("'")) {
    const { value, rest } = readSingle(t, 0);
    assertTail(rest, raw);
    return value;
  }
  if (t.startsWith('"')) {
    const { value, rest } = readDouble(t, 0);
    assertTail(rest, raw);
    return value;
  }
  if (t.startsWith("|") || t.startsWith(">")) throw new YamlError("block scalars are not supported");
  if (t.startsWith("{")) throw new YamlError("flow maps are not supported");
  return plain(t, typed);
}

function parseFlowList(raw: string): Scalar[] {
  const t = raw.trim();
  const items: Scalar[] = [];
  let i = 1;
  let closed = false;
  while (i < t.length) {
    while (t[i] === " ") i++;
    if (t[i] === "]") {
      closed = true;
      i++;
      break;
    }
    let item: Scalar;
    if (t[i] === "'" || t[i] === '"') {
      const q = t[i] === "'" ? readSingle(t, i) : readDouble(t, i);
      item = q.value;
      i = t.length - q.rest.length;
    } else {
      let j = i;
      while (j < t.length && t[j] !== "," && t[j] !== "]") j++;
      item = plain(t.slice(i, j), false);
      i = j;
    }
    items.push(item);
    while (t[i] === " ") i++;
    if (t[i] === ",") {
      i++;
      continue;
    }
    if (t[i] === "]") {
      closed = true;
      i++;
      break;
    }
    throw new YamlError(`bad flow list: ${raw}`);
  }
  if (!closed) throw new YamlError(`unterminated flow list: ${raw}`);
  assertTail(t.slice(i), raw);
  return items;
}

/**
 * Parse one value. `typed: false` (core fields): plain scalars stay strings, except `null` / `~`.
 * `typed: true` (plugin `extra` fields): `true`, `false` and numbers become booleans and numbers.
 */
export function parseValue(raw: string, opts: { typed?: boolean } = {}): YamlValue {
  const t = raw.trimStart();
  if (t.startsWith("[")) return parseFlowList(t);
  return parseScalar(t, !!opts.typed);
}

export interface Frontmatter {
  fields: Array<[key: string, raw: string]>;
  /** Everything after the closing `---`, with `\n` line endings. */
  body: string;
}

const KEY = /^([A-Za-z_][A-Za-z0-9_-]*):(?:[ \t]+(.*))?$/;

/** Split `---\nkey: value\n---\nbody`. Duplicate keys: the last one wins. */
export function parseFrontmatter(text: string): Frontmatter {
  const lines = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split("\n");
  if ((lines[0] ?? "").trimEnd() !== "---") throw new YamlError("missing frontmatter: the file must start with '---'");
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if ((lines[i] ?? "").trimEnd() === "---") {
      end = i;
      break;
    }
  }
  if (end < 0) throw new YamlError("unterminated frontmatter: no closing '---'");
  const map = new Map<string, string>();
  for (let i = 1; i < end; i++) {
    const line = lines[i] ?? "";
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
    const m = KEY.exec(line);
    if (!m) throw new YamlError(`frontmatter line ${i + 1} is not 'key: value': ${line}`);
    map.set(m[1] as string, m[2] ?? "");
  }
  return { fields: [...map.entries()], body: lines.slice(end + 1).join("\n") };
}
