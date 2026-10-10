/**
 * Entry and session files (DESIGN §8): `serialize(entry)` -> markdown, `parse(markdown)` -> Entry, and the same
 * for `session.md`. Framework-free and dependency-free (YAML is `./yaml-lite`).
 *
 * ## What the file carries, and what it does not
 *
 * The file is the contract with humans and agents, not a database dump. `parse(serialize(e))` equals
 * `fileProjection(e)`, which is `e` with these in-memory-only parts replaced by what the file can say:
 *
 * | In memory                          | In the file                                                              |
 * | ---------------------------------- | ------------------------------------------------------------------------ |
 * | `snapshot.element` / `.viewport` (PNG data URLs), `fontsEmbedded` | only the link `![mobile](../assets/005-mobile.png)`; parsed `snapshot = { assets: { element } }` |
 * | `context.console`, `.network`, `.queries` (full arrays) | the summary under `## Context`; parsed arrays are empty and `context.summary` is set |
 * | `activity`                         | not written; parsed `activity` is `[]`                                    |
 * | `updated`                          | not written; parsed `updated` equals `created`                            |
 * | `created` milliseconds             | dropped (`2026-10-10T12:42:07Z`)                                         |
 * | `rotated`                          | derived from `viewport` + `size` (a device preset in landscape)           |
 * | `title`                            | one line (line breaks become spaces)                                      |
 * | target `label` (element, text)     | not written; read back as the last part of `component` (multi and box write it in the `###` heading, one line) |
 * | `resolution`                       | a `## Resolution` section before `## Context`; blank edges dropped (T15)   |
 * | `description`                      | leading and trailing blank lines are dropped; `\r\n` becomes `\n`         |
 * | `extra` values that are not string / number / boolean / null / flat array | written as a JSON string and parsed back as that string |
 *
 * Everything else round-trips exactly: id, session, status, intent, priority, kind, viewport, size, route,
 * every target's selector / source / inherited / component, quote, task, testPlan, tags, issue,
 * created, build, extra.
 *
 * Invariants the writer relies on: `id === "PRO-" + n`, `target === targets[0]`.
 *
 * ## Deviations from the §8 example (all additive)
 *
 * - `kind: element | note | text | multi | box` is always written after `priority` (D3.1); the parser still
 *   infers a missing `kind` from `selector`. `ref: <session>/PRO-n` follows `id` (D3.2). Multi and box entries also get a `## Targets` section (the frontmatter
 *   `source` / `selector` / `component` describe the first target). A text entry's quote is a `> ` block under
 *   the title.
 * - A page note, or a text selection with no element, has `source: null` / `source_inherited: false` and no
 *   `selector` / `component` lines. `selector` present means "has a target".
 * - `test_plan` is omitted when unset (like `task`).
 * - `extra` (plugin `context()`) fields come after `created`. Keys that collide with a field above are dropped.
 * - session.md also has a `session:` line (the folder name) after `proompter: 1`.
 */
import {
  ENTRY_INTENTS,
  ENTRY_KINDS,
  ENTRY_PRIORITIES,
  ENTRY_STATUSES,
  type ContextSummary,
  type Entry,
  type EntryKind,
  type EntryPriority,
  type EntryStatus,
  type EntryTarget,
  type Session,
} from "./entry";
import { VIEWPORT_ORDER, viewportSize, type ViewportId } from "./surface";
import { emitString, emitValue, parseFrontmatter, parseValue, YamlError, type Scalar, type YamlValue } from "./yaml-lite";

export const FORMAT_VERSION = 1;

export class ParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ParseError";
  }
}

// ---------------------------------------------------------------------------------------------------------
// Names

export const pad = (n: number, width = 3): string => String(n).padStart(width, "0");

/** `Avatar is cropped on mobile` -> `avatar-is-cropped-on-mobile` (at most 42 chars, never empty). */
export function slugify(text: string, max = 42): string {
  const s = text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/, "");
  return s || "note";
}

/** `005-avatar-is-cropped-on-mobile.md` */
export const entryFileName = (e: Pick<Entry, "n" | "title">): string => `${pad(e.n)}-${slugify(e.title)}.md`;
/** `entries/005-avatar-is-cropped-on-mobile.md` (relative to the session folder). */
export const entryPath = (e: Pick<Entry, "n" | "title">): string => `entries/${entryFileName(e)}`;

/** `005-mobile.png` (element crop) and `005-mobile-full.png` (visible viewport). */
export function assetNames(n: number, viewport: ViewportId): { element: string; viewport: string } {
  return { element: `${pad(n)}-${viewport}.png`, viewport: `${pad(n)}-${viewport}-full.png` };
}

/** `2026-10-10_manual-test-pass` from the session title and its start date (local time). */
export function sessionIdFor(title: string, date: Date): string {
  const d = `${date.getFullYear()}-${pad(date.getMonth() + 1, 2)}-${pad(date.getDate(), 2)}`;
  return `${d}_${slugify(title, 48)}`;
}

/** ISO timestamp without milliseconds: `2026-10-10T12:42:07Z`. */
export function isoSeconds(at: Date | string): string {
  const s = typeof at === "string" ? at : at.toISOString();
  return s.replace(/\.\d+(?=Z$|[-+]\d{2}:?\d{2}$)/, "");
}

const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T[\d:]+(?:Z|[-+]\d{2}:\d{2})$/;

// ---------------------------------------------------------------------------------------------------------
// Normalising helpers (shared by the writer and `fileProjection`)

const oneLine = (s: string): string => s.replace(/[\r\n\u0085\u2028\u2029]+/g, " ").trim();
const norm = (s: string): string => s.replace(/\r\n?/g, "\n");

/**
 * Drop leading blank lines and trailing whitespace; keep the indentation of the first real line (an indented
 * code block must stay one). `\r\n` becomes `\n`.
 */
function trimBlankLines(s: string): string {
  const lines = norm(s).split("\n");
  while (lines.length && (lines[0] ?? "").trim() === "") lines.shift();
  return lines.join("\n").trimEnd();
}

/** How descriptions are kept (composer, store, file): see `trimBlankLines`. */
export const cleanDescription = trimBlankLines;

function clip(s: string, max = 200): string {
  const t = oneLine(s);
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

const idNumber = (id: string): number | null => {
  const m = /^PRO-(\d+)$/.exec(id);
  return m ? Number(m[1]) : null;
};

/** A device preset in landscape (or portrait for a landscape preset). Responsive is never rotated. */
export function deriveRotated(viewport: ViewportId, size: { width: number; height: number }): boolean {
  const p = viewportSize(viewport, false);
  return !!p && p.width !== p.height && size.width === p.height && size.height === p.width;
}

const KNOWN_KEYS = new Set([
  "id",
  "ref",
  "session",
  "status",
  "intent",
  "priority",
  "kind",
  "viewport",
  "route",
  "source",
  "source_inherited",
  "selector",
  "component",
  "task",
  "test_plan",
  "tags",
  "issue",
  "created",
]);
const EXTRA_KEY = /^[A-Za-z_][A-Za-z0-9_-]*$/;
/** Never copied into `extra`, in either direction: they would change an object's prototype or shape. */
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function extraValue(v: unknown): YamlValue {
  if (v === null || v === undefined) return null;
  if (typeof v === "string" || typeof v === "boolean") return v;
  if (typeof v === "number") return Number.isFinite(v) ? v : String(v);
  if (Array.isArray(v) && v.every((x) => x === null || typeof x === "string" || typeof x === "boolean" || (typeof x === "number" && Number.isFinite(x)))) {
    return v as Scalar[];
  }
  try {
    return JSON.stringify(v) ?? "null";
  } catch {
    return String(v);
  }
}

function extraPairs(extra: Record<string, unknown> | undefined): Array<[string, YamlValue]> {
  if (!extra) return [];
  const out: Array<[string, YamlValue]> = [];
  for (const [k, v] of Object.entries(extra)) {
    if (!EXTRA_KEY.test(k) || KNOWN_KEYS.has(k) || UNSAFE_KEYS.has(k) || k === "proompter") continue;
    out.push([k, extraValue(v)]);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------
// Context summary

/** Counts and one-line items for `## Context`. A parsed entry (no arrays, a summary) summarises to itself. */
export function summarizeContext(ctx: Entry["context"]): ContextSummary {
  if (ctx.console.length === 0 && ctx.network.length === 0 && ctx.summary) return ctx.summary;
  const failed = ctx.network.filter((n) => !n.ok);
  return {
    consoleLines: ctx.console.length,
    consoleErrors: ctx.console.filter((c) => c.level === "error").length,
    consoleItems: ctx.console.map((c) => clip(`${c.level} ${c.message}`)),
    networkTotal: ctx.network.length,
    networkFailed: failed.length,
    networkItems: failed.map((n) => clip(`${n.method} ${n.url} → ${n.status ?? "failed"} (${Math.round(n.durationMs)} ms)`)),
  };
}

// ---------------------------------------------------------------------------------------------------------
// Projection

/** The last part of a component chain: `FeedPage › PostCard › Avatar` -> `Avatar`. */
function lastPart(component: string): string {
  const parts = component.split("›").map((s) => s.trim()).filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

/**
 * Only multi and box files carry each target's label (in its `###` heading). For a single target the label is
 * not in the file; it is read back as the last part of `component`, which is what `resolveTarget` produces
 * (the crumb ends with the element's own label).
 */
function normTarget(t: EntryTarget, kind: EntryKind): EntryTarget {
  return {
    selector: t.selector,
    source: t.source,
    sourceInherited: !!t.sourceInherited,
    label: kind === "multi" || kind === "box" ? oneLine(t.label) : lastPart(t.component),
    component: t.component,
  };
}

function buildOf(entry: Entry, session?: Session): string | undefined {
  const own = entry.context.build !== undefined ? oneLine(entry.context.build) : "";
  if (own) return own;
  if (session?.branch) return oneLine(session.sha ? `${session.branch}@${session.sha}` : session.branch);
  return undefined;
}

/**
 * What `parse(serialize(entry, session))` returns: `entry` reduced to the part the file carries (see the table
 * at the top of this file). `serialize` writes from this, so the two cannot drift apart.
 *
 * `session` only matters for the `Build:` line: an entry without its own `context.build` gets `branch@sha`.
 */
export function fileProjection(entry: Entry, session?: Session): Entry {
  const n = idNumber(entry.id) ?? entry.n;
  const targets = (entry.targets.length ? entry.targets : entry.target ? [entry.target] : []).map((t) => normTarget(t, entry.kind));
  const size = { width: Math.round(entry.size.width), height: Math.round(entry.size.height) };
  const created = isoSeconds(entry.created);
  const build = buildOf(entry, session);
  const extraList = extraPairs(entry.extra);
  const hasImage = !!(entry.snapshot?.element || entry.snapshot?.assets?.element);
  const out: Entry = {
    id: entry.id,
    ref: `${entry.session}/${entry.id}`,
    n,
    session: entry.session,
    status: entry.status,
    intent: entry.intent,
    priority: entry.priority,
    kind: entry.kind,
    title: oneLine(entry.title),
    description: trimBlankLines(entry.description),
    viewport: entry.viewport,
    size,
    rotated: deriveRotated(entry.viewport, size),
    route: entry.route,
    targets,
    tags: [...entry.tags],
    issue: entry.issue,
    created,
    updated: created,
    context: {
      console: [],
      network: [],
      queries: [],
      ...(build !== undefined ? { build } : {}),
      summary: summarizeContext(entry.context),
    },
    activity: [],
  };
  if (targets[0]) out.target = targets[0];
  if (entry.kind === "text") out.quote = norm(entry.quote ?? "");
  if (entry.task !== undefined) out.task = entry.task;
  if (entry.testPlan !== undefined) out.testPlan = entry.testPlan;
  if (entry.resolution !== undefined && entry.resolution.trim() !== "") out.resolution = trimBlankLines(entry.resolution);
  if (hasImage) out.snapshot = { assets: { element: assetNames(n, entry.viewport).element } };
  if (extraList.length) out.extra = Object.fromEntries(extraList);
  return out;
}

// ---------------------------------------------------------------------------------------------------------
// Serialize

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function targetBlock(targets: EntryTarget[]): string[] {
  const out = ["## Targets"];
  targets.forEach((t, i) => {
    out.push("", `### ${i + 1}. ${t.label}`);
    out.push(`- source: ${t.source === null ? "null" : emitString(t.source)}`);
    out.push(`- inherited: ${t.sourceInherited ? "true" : "false"}`);
    out.push(`- selector: ${emitString(t.selector, { quote: true })}`);
    out.push(`- component: ${emitString(t.component)}`);
  });
  return out;
}

function contextBlock(e: Entry): string[] {
  const s = e.context.summary ?? summarizeContext(e.context);
  const out = ["## Context"];
  out.push(`- Console: ${plural(s.consoleLines, "line", "lines")}, ${plural(s.consoleErrors, "error", "errors")}`);
  for (const item of s.consoleItems) out.push(`  - ${item}`);
  out.push(`- Network: ${s.networkFailed} failed of ${s.networkTotal}`);
  for (const item of s.networkItems) out.push(`  - ${item}`);
  if (e.context.build) out.push(`- Build: ${e.context.build}`);
  return out;
}

/** The entry file, exactly as DESIGN §8 (plus the additive parts listed at the top of this file). */
export function serialize(entry: Entry, session?: Session): string {
  const e = fileProjection(entry, session);
  const t = e.targets[0];
  const fm: string[] = ["---"];
  const put = (key: string, value: string) => fm.push(`${key}: ${value}`);
  put("id", emitString(e.id));
  put("ref", emitString(e.ref ?? `${e.session}/${e.id}`));
  put("session", emitString(e.session));
  put("status", emitString(e.status));
  put("intent", emitString(e.intent));
  put("priority", emitString(e.priority));
  put("kind", emitString(e.kind));
  put("viewport", emitString(`${e.viewport} ${e.size.width}x${e.size.height}`));
  put("route", emitString(e.route));
  put("source", t?.source == null ? "null" : emitString(t.source));
  put("source_inherited", t?.sourceInherited ? "true" : "false");
  if (t) {
    put("selector", emitString(t.selector, { quote: true }));
    put("component", emitString(t.component));
  }
  if (e.task !== undefined) put("task", emitString(e.task));
  if (e.testPlan !== undefined) put("test_plan", emitString(e.testPlan));
  put("tags", emitValue(e.tags));
  put("issue", e.issue === null ? "null" : emitString(e.issue));
  put("created", TIMESTAMP.test(e.created) ? e.created : emitString(e.created));
  for (const [k, v] of extraPairs(e.extra)) put(k, emitValue(v));
  fm.push("---");

  const blocks: string[][] = [fm, [`# ${e.title}`]];
  if (e.kind === "text") blocks.push(norm(e.quote ?? "").split("\n").map((l) => (l === "" ? ">" : `> ${l}`)));
  if (e.description) blocks.push(e.description.split("\n"));
  if ((e.kind === "multi" || e.kind === "box") && e.targets.length) blocks.push(targetBlock(e.targets));
  if (e.resolution) blocks.push(["## Resolution", "", ...e.resolution.split("\n")]);
  blocks.push(contextBlock(e));
  if (e.snapshot?.assets?.element) blocks.push([`![${e.viewport}](../assets/${e.snapshot.assets.element})`]);
  return `${blocks.map((b) => b.join("\n")).join("\n\n")}\n`;
}

// ---------------------------------------------------------------------------------------------------------
// Parse

function oneOf<T extends string>(value: string, list: readonly T[], what: string): T {
  if ((list as readonly string[]).includes(value)) return value as T;
  throw new ParseError(`unknown ${what} '${value}' (expected ${list.join(" | ")})`);
}

type Fields = Map<string, string>;

function str(fields: Fields, key: string, required: boolean): string | undefined {
  const raw = fields.get(key);
  if (raw === undefined) {
    if (required) throw new ParseError(`missing '${key}' in frontmatter`);
    return undefined;
  }
  const v = parseValue(raw);
  if (v === null) {
    if (required) throw new ParseError(`'${key}' must not be null`);
    return undefined;
  }
  if (Array.isArray(v)) throw new ParseError(`'${key}' must be a single value`);
  return String(v);
}

function bool(fields: Fields, key: string): boolean {
  const raw = fields.get(key);
  if (raw === undefined) return false;
  const v = parseValue(raw, { typed: true });
  if (typeof v === "boolean") return v;
  throw new ParseError(`'${key}' must be true or false`);
}

function lastIndex(lines: string[], text: string, before = lines.length): number {
  for (let i = Math.min(before, lines.length) - 1; i >= 0; i--) if (lines[i] === text) return i;
  return -1;
}

const IMAGE = /^!\[([^\]]*)\]\(\.\.\/assets\/([^)\s]+)\)\s*$/;

function parseTargets(lines: string[]): EntryTarget[] {
  const targets: EntryTarget[] = [];
  let cur: Partial<EntryTarget> | null = null;
  const flush = () => {
    if (cur) {
      targets.push({
        selector: cur.selector ?? "",
        source: cur.source ?? null,
        sourceInherited: !!cur.sourceInherited,
        label: cur.label ?? "",
        component: cur.component ?? "",
      });
    }
    cur = null;
  };
  for (const line of lines) {
    const h = /^### \d+\.[ \t]?(.*)$/.exec(line);
    if (h) {
      flush();
      cur = { label: (h[1] ?? "").trim() };
      continue;
    }
    const b = /^- (source|inherited|selector|component): ?(.*)$/.exec(line);
    if (!b || !cur) continue;
    const raw = b[2] ?? "";
    if (b[1] === "inherited") {
      cur.sourceInherited = parseValue(raw, { typed: true }) === true;
    } else if (b[1] === "source") {
      const v = parseValue(raw);
      cur.source = v === null ? null : String(v);
    } else if (b[1] === "selector") {
      cur.selector = String(parseValue(raw) ?? "");
    } else {
      cur.component = String(parseValue(raw) ?? "");
    }
  }
  flush();
  return targets;
}

/** Parse an entry file. Throws `ParseError` on anything that is not a Proompter entry. */
export function parse(markdown: string): Entry {
  return asParseError(() => parseEntry(markdown));
}

/** Run a parser; a `YamlError` from the frontmatter reader comes out as a `ParseError`. */
function asParseError<T>(run: () => T): T {
  try {
    return run();
  } catch (e) {
    if (e instanceof YamlError) throw new ParseError(e.message);
    throw e;
  }
}

function parseEntry(markdown: string): Entry {
  const fm = parseFrontmatter(markdown);
  const fields: Fields = new Map(fm.fields);

  const id = str(fields, "id", true) as string;
  const n = idNumber(id);
  if (n === null) throw new ParseError(`'id' must look like PRO-12, got '${id}'`);
  const session = str(fields, "session", true) as string;
  const status = oneOf(str(fields, "status", true) as string, ENTRY_STATUSES, "status");
  const intent = oneOf(str(fields, "intent", true) as string, ENTRY_INTENTS, "intent");
  const priority = oneOf(str(fields, "priority", true) as string, ENTRY_PRIORITIES, "priority");

  const vp = /^(\S+) (\d+)x(\d+)$/.exec(str(fields, "viewport", true) as string);
  if (!vp) throw new ParseError("'viewport' must look like 'mobile 390x844'");
  const viewport = oneOf(vp[1] as string, VIEWPORT_ORDER, "viewport");
  const size = { width: Number(vp[2]), height: Number(vp[3]) };

  const selector = str(fields, "selector", false);
  const source = str(fields, "source", false) ?? null;
  const frontTarget: EntryTarget | undefined =
    selector === undefined
      ? undefined
      : {
          selector,
          source,
          sourceInherited: bool(fields, "source_inherited"),
          label: "",
          component: str(fields, "component", false) ?? "",
        };

  const kindField = str(fields, "kind", false);
  const kind: EntryKind = kindField
    ? oneOf(kindField, ENTRY_KINDS, "kind")
    : frontTarget
      ? "element"
      : "note";

  const tagsRaw = fields.get("tags");
  const tagsValue = tagsRaw === undefined ? [] : parseValue(tagsRaw);
  const tags = (Array.isArray(tagsValue) ? tagsValue : tagsValue === null || tagsValue === "" ? [] : [tagsValue]).map(String);

  const issueRaw = fields.get("issue");
  const issueValue = issueRaw === undefined ? null : parseValue(issueRaw);
  const issue = issueValue === null || Array.isArray(issueValue) ? null : String(issueValue);

  const created = str(fields, "created", true) as string;

  const extra: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const [k, raw] of fields) {
    if (KNOWN_KEYS.has(k) || UNSAFE_KEYS.has(k)) continue;
    extra[k] = parseValue(raw, { typed: true });
  }

  // ---- body
  const lines = fm.body.split("\n");
  let at = 0;
  while (at < lines.length && (lines[at] ?? "").trim() === "") at++;
  const titleLine = /^#(?: (.*))?$/.exec(lines[at] ?? "");
  if (!titleLine) throw new ParseError("missing '# Title' line after the frontmatter");
  const title = (titleLine[1] ?? "").trim();
  const rest = lines.slice(at + 1);

  // The real `## Context` is the last one: a description may contain such a line itself.
  const ctxAt = lastIndex(rest, "## Context");
  let head = ctxAt < 0 ? rest : rest.slice(0, ctxAt);
  let tail = ctxAt < 0 ? [] : rest.slice(ctxAt + 1);

  const summary: ContextSummary = {
    consoleLines: 0,
    consoleErrors: 0,
    consoleItems: [],
    networkTotal: 0,
    networkFailed: 0,
    networkItems: [],
  };
  let build: string | undefined;
  let section: "console" | "network" | null = null;
  let k = 0;
  for (; k < tail.length; k++) {
    const line = tail[k] as string;
    const top = /^- (Console|Network|Build): ?(.*)$/.exec(line);
    if (top) {
      const value = (top[2] ?? "").trim();
      if (top[1] === "Console") {
        section = "console";
        const m = /^(\d+) lines?, (\d+) errors?$/.exec(value);
        if (m) {
          summary.consoleLines = Number(m[1]);
          summary.consoleErrors = Number(m[2]);
        }
      } else if (top[1] === "Network") {
        section = "network";
        const m = /^(\d+) failed of (\d+)$/.exec(value);
        if (m) {
          summary.networkFailed = Number(m[1]);
          summary.networkTotal = Number(m[2]);
        }
      } else {
        section = null;
        build = value;
      }
      continue;
    }
    const sub = /^ {2}- (.*)$/.exec(line);
    if (sub && section) {
      (section === "console" ? summary.consoleItems : summary.networkItems).push((sub[1] ?? "").trim());
      continue;
    }
    break;
  }
  tail = tail.slice(k);

  // The image link is the last non-blank line of the file.
  const imageSource = ctxAt < 0 ? head : tail;
  while (imageSource.length && (imageSource[imageSource.length - 1] ?? "").trim() === "") imageSource.pop();
  let image: string | undefined;
  const lastLine = imageSource[imageSource.length - 1];
  const im = lastLine === undefined ? null : IMAGE.exec(lastLine);
  if (im) {
    image = im[2];
    imageSource.pop();
  }
  if (ctxAt < 0) head = imageSource;

  // Resolution: the last '## Resolution' before '## Context' runs to the end of what is left.
  let resolution: string | undefined;
  for (let i = head.length - 1; i >= 0; i--) {
    if (head[i] !== "## Resolution") continue;
    resolution = trimBlankLines(head.slice(i + 1).join("\n"));
    head = head.slice(0, i);
    break;
  }

  // Targets (multi, box): the last '## Targets' that is followed by a '### 1.' heading.
  let targets: EntryTarget[] = frontTarget ? [frontTarget] : [];
  if (kind === "multi" || kind === "box") {
    targets = [];
    for (let i = head.length - 1; i >= 0; i--) {
      if (head[i] !== "## Targets") continue;
      const next = head.slice(i + 1).find((l) => l.trim() !== "");
      if (next !== undefined && /^### \d+\./.test(next)) {
        targets = parseTargets(head.slice(i + 1));
        head = head.slice(0, i);
        break;
      }
    }
    if (targets.length === 0 && frontTarget) targets = [frontTarget];
  }
  if (frontTarget && targets[0] === frontTarget) frontTarget.label = lastPart(frontTarget.component);

  // Quote (text).
  let quote: string | undefined;
  if (kind === "text") {
    let i = 0;
    while (i < head.length && (head[i] ?? "").trim() === "") i++;
    const q: string[] = [];
    while (i < head.length && (head[i] ?? "").startsWith(">")) {
      const l = head[i] as string;
      q.push(l.startsWith("> ") ? l.slice(2) : l.slice(1));
      i++;
    }
    quote = q.join("\n");
    head = head.slice(i);
  }

  const description = trimBlankLines(head.join("\n"));

  const entry: Entry = {
    id,
    ref: str(fields, "ref", false) ?? `${session}/${id}`,
    n,
    session,
    status,
    intent,
    priority,
    kind,
    title,
    description,
    viewport,
    size,
    rotated: deriveRotated(viewport, size),
    route: str(fields, "route", false) ?? "",
    targets,
    tags,
    issue,
    created,
    updated: created,
    context: { console: [], network: [], queries: [], ...(build ? { build } : {}), summary },
    activity: [],
  };
  if (targets[0]) entry.target = targets[0];
  if (quote !== undefined) entry.quote = quote;
  const task = str(fields, "task", false);
  if (task !== undefined) entry.task = task;
  const testPlan = str(fields, "test_plan", false);
  if (testPlan !== undefined) entry.testPlan = testPlan;
  if (resolution) entry.resolution = resolution;
  if (image) entry.snapshot = { assets: { element: image } };
  if (Object.keys(extra).length) entry.extra = { ...extra };
  return entry;
}

// ---------------------------------------------------------------------------------------------------------
// session.md

export interface SessionIndexItem {
  id: string;
  n: number;
  status: EntryStatus;
  priority: EntryPriority;
  title: string;
  /** Relative to the session folder, e.g. `entries/005-avatar-is-cropped-on-mobile.md`. */
  file: string;
}

export interface ParsedSession {
  session: Session;
  entries: SessionIndexItem[];
}

/** `session.md`: `proompter: 1`, the session fields, and the entry index. */
export function serializeSession(session: Session, entries: ReadonlyArray<Pick<Entry, "id" | "n" | "status" | "priority" | "title">>): string {
  const fm: string[] = ["---", `proompter: ${FORMAT_VERSION}`];
  const put = (k: string, v: string) => fm.push(`${k}: ${v}`);
  put("session", emitString(session.id));
  put("title", emitString(session.title));
  put("reviewer", emitString(session.reviewer));
  if (session.branch !== undefined) put("branch", emitString(session.branch));
  if (session.sha !== undefined) put("sha", emitString(session.sha));
  if (session.env !== undefined) put("env", emitString(session.env));
  put("started", TIMESTAMP.test(isoSeconds(session.started)) ? isoSeconds(session.started) : emitString(session.started));
  fm.push("---");

  const sorted = [...entries].sort((a, b) => a.n - b.n);
  const index = sorted.length
    ? sorted.map((e) => {
        const title = oneLine(e.title);
        return `- ${e.id} · ${e.status} · ${e.priority} · [${title}](${entryPath({ n: e.n, title: e.title })})`;
      })
    : ["No entries yet."];
  const blocks = [fm, [`# ${oneLine(session.title)}`], ["## Entries", "", ...index]];
  return `${blocks.map((b) => b.join("\n")).join("\n\n")}\n`;
}

const INDEX_LINE = /^- (PRO-\d+) · (open|progress|resolved) · (blocking|important|minor) · \[(.*)\]\((entries\/[^)\s]+\.md)\)$/;

export function parseSession(markdown: string): ParsedSession {
  return asParseError(() => {
    const fm = parseFrontmatter(markdown);
    const fields: Fields = new Map(fm.fields);
    const version = parseValue(fields.get("proompter") ?? "", { typed: true });
    if (version !== FORMAT_VERSION) {
      throw new ParseError(`unsupported session format 'proompter: ${String(version)}' (this build reads ${FORMAT_VERSION})`);
    }
    const session: Session = {
      id: str(fields, "session", true) as string,
      title: str(fields, "title", true) as string,
      reviewer: str(fields, "reviewer", true) as string,
      started: str(fields, "started", true) as string,
      version: 1,
    };
    const branch = str(fields, "branch", false);
    const sha = str(fields, "sha", false);
    const env = str(fields, "env", false);
    if (branch !== undefined) session.branch = branch;
    if (sha !== undefined) session.sha = sha;
    if (env !== undefined) session.env = env;
    const entries: SessionIndexItem[] = [];
    for (const line of fm.body.split("\n")) {
      const m = INDEX_LINE.exec(line);
      if (!m) continue;
      entries.push({
        id: m[1] as string,
        n: idNumber(m[1] as string) as number,
        status: m[2] as EntryStatus,
        priority: m[3] as EntryPriority,
        title: m[4] as string,
        file: m[5] as string,
      });
    }
    return { session, entries };
  });
}
