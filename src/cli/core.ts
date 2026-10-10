/**
 * The `proompter` CLI as plain functions over a `reviews/` folder (DESIGN D19). No `process.exit`, no console:
 * they return data or throw `CliError`, so the bin (`index.ts`) and the MCP server (T16) can both wrap them.
 * It reads and writes with the v1 parser/serializer and the shared `src/server/write.ts` helpers.
 */
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import type { Entry, EntryPriority, EntryStatus, Session } from "../core/entry";
import { globToRegExp } from "../core/glob";
import { assetNames, parse, parseSession, serialize, serializeSession } from "../core/serialize";
import { SESSION_ID } from "../core/store";
import { readEntries, withLock, writeAtomic } from "../server/write";

/** `code` is the exit code: 1 not found, 2 usage or ambiguous. */
export class CliError extends Error {
  constructor(
    message: string,
    readonly code: 1 | 2 = 2,
  ) {
    super(message);
    this.name = "CliError";
  }
}

export interface Target {
  /** The reviews folder. */
  dir: string;
  /** Where `test_plan` paths are resolved from (the nearest `.git` ancestor of the working directory). */
  repoRoot: string;
}

export interface Found {
  /** `<session>/PRO-n` */
  ref: string;
  sessionDir: string;
  /** `entries/NNN-slug.md`, relative to the session folder. */
  file: string;
  markdown: string;
  entry: Entry;
}

/** The nearest ancestor of `start` holding a `.git`, else `start`. */
export function findRepoRoot(start: string): string {
  let dir = path.resolve(start);
  for (;;) {
    if (existsSync(path.join(dir, ".git"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return path.resolve(start);
    dir = parent;
  }
}

export function targetFor(cwd: string, dir?: string): Target {
  return { dir: path.resolve(cwd, dir ?? "reviews"), repoRoot: findRepoRoot(cwd) };
}

const sourceOf = (e: Entry) => e.targets[0]?.source ?? null;

/** Every parsable entry of every session folder, oldest session first. */
export async function loadAll(t: Target): Promise<Found[]> {
  const dirents = await fs.readdir(t.dir, { withFileTypes: true }).catch(() => []);
  const out: Found[] = [];
  for (const d of dirents.filter((x) => x.isDirectory() && SESSION_ID.test(x.name)).sort((a, b) => a.name.localeCompare(b.name))) {
    const sessionDir = path.join(t.dir, d.name);
    for (const r of await readEntries(sessionDir)) {
      // The folder is the session, whatever a hand-edited `session:` line says: a write must land in the same file.
      out.push({ ref: `${d.name}/${r.entry.id}`, sessionDir, file: r.path, markdown: r.markdown, entry: r.entry });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------
// list

export interface ListFilter {
  status?: string;
  priority?: string;
  route?: string;
  session?: string;
}

export interface ListRow {
  ref: string;
  status: EntryStatus;
  priority: EntryPriority;
  title: string;
  /** `path:line:col`, or null. */
  source: string | null;
  route: string;
  intent: Entry["intent"];
}

export async function listEntries(t: Target, f: ListFilter = {}): Promise<ListRow[]> {
  const routeRe = f.route !== undefined ? globToRegExp(f.route) : null;
  const rows: ListRow[] = [];
  for (const x of await loadAll(t)) {
    const e = x.entry;
    if (f.status !== undefined && e.status !== f.status) continue;
    if (f.priority !== undefined && e.priority !== f.priority) continue;
    if (routeRe && !routeRe.test(e.route)) continue;
    if (f.session !== undefined) {
      const id = x.ref.slice(0, x.ref.indexOf("/"));
      if (id !== f.session && !id.endsWith(`_${f.session}`)) continue;
    }
    rows.push({ ref: x.ref, status: e.status, priority: e.priority, title: e.title, source: sourceOf(e), route: e.route, intent: e.intent });
  }
  return rows;
}

/** `<ref>  <status>  <priority>  <title>  <source>` */
export const listLine = (r: ListRow): string => `${r.ref}  ${r.status}  ${r.priority}  ${r.title}  ${r.source ?? "-"}`;

// ---------------------------------------------------------------------------------------------------------
// ref

const REF = /^(?:([^/\s]+)\/)?(PRO-\d+)$/;

export async function findEntry(t: Target, ref: string): Promise<Found> {
  const m = REF.exec(ref);
  if (!m) throw new CliError(`'${ref}' is not an entry reference (expected <session>/PRO-n or PRO-n)`, 2);
  const [, session, id] = m;
  const all = (await loadAll(t)).filter((x) => x.entry.id === id && (session === undefined || x.ref.startsWith(`${session}/`)));
  if (all.length === 1) return all[0] as Found;
  if (all.length === 0) throw new CliError(`no entry '${ref}' in ${t.dir}`, 1);
  throw new CliError(`'${ref}' is in ${all.length} sessions; use one of:\n${all.map((x) => `  ${x.ref}`).join("\n")}`, 2);
}

export async function showEntry(t: Target, ref: string): Promise<Found> {
  return findEntry(t, ref);
}

// ---------------------------------------------------------------------------------------------------------
// test_plan

/**
 * `test_plan` is free text (`§2 Feed and posts`) or names a file (`e2e/feed.spec.ts`, `e2e/feed.spec.ts > avatar`).
 * The first word counts as a file when it has an extension. Returns it relative to the repo root, or null.
 */
export function testFile(testPlan: string | undefined): string | null {
  const word = (testPlan ?? "").trim().split(/\s|#|::/)[0] ?? "";
  return /\.[A-Za-z0-9]+$/.test(word) && !word.startsWith("§") ? word : null;
}

/** Whether `test_plan` names a file that exists inside the repo. */
export function testExists(t: Target, testPlan: string | undefined): boolean {
  const file = testFile(testPlan);
  if (!file) return false;
  const abs = path.resolve(t.repoRoot, file);
  return abs.startsWith(t.repoRoot + path.sep) && existsSync(abs);
}

// ---------------------------------------------------------------------------------------------------------
// task

/** An agent-ready task for one entry. */
export async function taskText(t: Target, ref: string): Promise<string> {
  const x = await findEntry(t, ref);
  const e = x.entry;
  const tg = e.targets[0];
  const rel = (p: string) => path.relative(t.repoRoot, p) || p;
  const out: string[] = [`# ${e.title}`, "", `- Ref: ${x.ref}`, `- Intent: ${e.intent}`, `- Priority: ${e.priority}`];
  out.push(`- Source: ${tg?.source ?? "none (page note)"}${tg?.source && tg.sourceInherited ? " (inherited from a parent)" : ""}`);
  if (tg?.selector) out.push(`- Selector: ${tg.selector}`);
  if (tg?.component) out.push(`- Component: ${tg.component}`);
  out.push(`- Route: ${e.route}`, `- Viewport: ${e.viewport} ${e.size.width}x${e.size.height}`);
  if (e.task) out.push(`- Task: ${e.task}`);
  if (e.testPlan) out.push(`- Test plan: ${e.testPlan}`);
  if (e.kind === "multi" || e.kind === "box") {
    out.push("", "## Targets");
    e.targets.forEach((g, i) => out.push(`${i + 1}. ${g.label}: ${g.source ?? "no source"} (${g.component})`));
  }
  if (e.kind === "text" && e.quote) out.push("", "## Quote", ...e.quote.split("\n").map((l) => `> ${l}`));
  if (e.description) out.push("", "## Description", e.description);
  const s = e.context.summary;
  if (s) {
    out.push("", "## Context", `- Console: ${s.consoleLines} lines, ${s.consoleErrors} errors`, ...s.consoleItems.map((i) => `  - ${i}`));
    out.push(`- Network: ${s.networkFailed} failed of ${s.networkTotal}`, ...s.networkItems.map((i) => `  - ${i}`));
    if (e.context.build) out.push(`- Build: ${e.context.build}`);
  }
  const names = assetNames(e.n, e.viewport);
  const shots = [e.snapshot?.assets?.element ?? names.element, names.viewport]
    .map((n) => path.join(x.sessionDir, "assets", n))
    .filter((p) => existsSync(p));
  if (shots.length) out.push("", "## Snapshots", ...shots.map((p) => `- ${rel(p)}`));
  const file = testFile(e.testPlan);
  out.push(
    "",
    "## Acceptance",
    `Fix it, then run \`proompter resolve ${x.ref} --note "<what you changed>"\`.` +
      (file ? ` Make \`${file}\` pass first.` : ""),
  );
  return `${out.join("\n")}\n`;
}

// ---------------------------------------------------------------------------------------------------------
// resolve

export interface ResolveOptions {
  note?: string;
  requireTest?: boolean;
}

/** Set the status to resolved, add the note as `## Resolution`, rewrite the file and rebuild `session.md`. */
export async function resolveEntry(t: Target, ref: string, o: ResolveOptions = {}): Promise<{ ref: string; files: string[] }> {
  const x = await findEntry(t, ref);
  if (o.requireTest && !testExists(t, x.entry.testPlan)) {
    const tp = x.entry.testPlan;
    throw new CliError(
      tp === undefined || testFile(tp) === null
        ? `${x.ref} has no test_plan that names a test file`
        : `${x.ref}: test file '${testFile(tp)}' does not exist under ${t.repoRoot}`,
      2,
    );
  }
  return withLock(x.sessionDir, async () => {
    // Read again under the lock: another writer may have changed the file since `findEntry`.
    const file = path.join(x.sessionDir, x.file);
    const entry = parse(await fs.readFile(file, "utf8"));
    const next: Entry = { ...entry, status: "resolved" };
    const note = o.note?.trim();
    if (note) next.resolution = note;
    const sessionFile = path.join(x.sessionDir, "session.md");
    const session = await readSession(sessionFile);
    const files: string[] = [];
    if (await writeAtomic(file, serialize(next, session ?? undefined))) files.push(x.file);
    if (session) {
      // The index lists what is on disk, the same as the dev route does.
      const index = (await readEntries(x.sessionDir)).map((r) => r.entry);
      if (await writeAtomic(sessionFile, serializeSession(session, index))) files.push("session.md");
    }
    return { ref: x.ref, files };
  });
}

async function readSession(file: string): Promise<Session | null> {
  try {
    if (!(await fs.lstat(file)).isFile()) return null; // never follow a symlink
    return parseSession(await fs.readFile(file, "utf8")).session;
  } catch {
    return null;
  }
}
