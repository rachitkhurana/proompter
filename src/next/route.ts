/**
 * `@rachitkay/proompter/next/route`: the dev-only file writer (DESIGN §8).
 *
 * Mount it in the host at `app/api/proompter/route.ts` (the default `endpoint` of `<Proompter>` is
 * `/api/proompter`, D6):
 *
 * ```ts
 * export { GET, POST } from "@rachitkay/proompter/next/route";
 * ```
 *
 * ## Guards
 * - Answers 404 unless BOTH `NODE_ENV === "development"` AND `NEXT_PUBLIC_PROOMPTER === "true"`. (`withProompter`
 *   only affects the loader; this file exists only if the host adds the route, so it checks the flag itself.)
 * - Writes only under `<cwd>/reviews/<session>/`, see `guardPath` below. No git.
 * - Both methods need the `x-proompter: 1` header (forces a preflight), `Sec-Fetch-Site` (if sent) must be
 *   `same-origin`, `Origin` (if sent) must be the request's own origin, and `Host` must be loopback or in
 *   `allowedHosts`: 403 otherwise. POST also needs `Content-Type: application/json` (415).
 *   A host hitting the plain `export { GET, POST }` (e.g. a phone on the LAN at `192.168.1.20:3000`) is allowed
 *   with the env var `PROOMPTER_ALLOWED_HOSTS=192.168.1.20,dev.example.test` (comma-separated host names, no
 *   ports); `createProompterRoute({ allowedHosts })` does the same in code.
 * - Error bodies are `{ ok: false, scope, error }`: scope `"request"` (403, 415, bad session or body) tells the
 *   sink to stop and pause; scope `"entry"` (400, 413) means only that entry was refused.
 * - Bodies are capped at 20 MB (bytes counted while streaming, 413), every field is type-checked (400), writes
 *   are serialised per session, and images must be real PNGs.
 *
 * ## API
 * - `POST { session, entry }`: writes `session.md`, `entries/NNN-slug.md`
 *   and `assets/*.png`. Idempotent (identical files are not rewritten); a renamed title moves the file (the
 *   old `NNN-*.md` is deleted); every write is temp file + rename. Answers `{ ok, files: string[] }` with the
 *   paths (relative to the session folder) that were created or changed.
 * - `GET[?session=ID]`: every session on disk with its parsed entries and the raw markdown of each file, so
 *   a reload can rehydrate (the sink's merge rule is in `src/core/sinks/files.ts`).
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { ENTRY_INTENTS, ENTRY_KINDS, ENTRY_PRIORITIES, ENTRY_STATUSES, type Entry, type Session } from "../core/entry";
import { assetNames, entryPath, pad, parse, parseSession, serialize, serializeSession } from "../core/serialize";
import { SESSION_ID } from "../core/store";

export const MAX_BODY_BYTES = 20 * 1024 * 1024;

/** A request we refuse; `status` is the HTTP status. */
class Refusal extends Error {
  /**
   * "request": the whole request is unacceptable (403, 415, a bad session or body), so the sink must stop and
   * pause. "entry": only this entry was refused (400, 413), so the sink skips it and carries on.
   */
  readonly scope: "request" | "entry";
  constructor(
    message: string,
    readonly status = 400,
    scope?: "request" | "entry",
  ) {
    super(message);
    this.scope = scope ?? (status === 403 || status === 415 ? "request" : "entry");
  }
}

// ---------------------------------------------------------------------------------------------------------
// The path guard. Everything that touches the disk goes through `guardPath`.

const ENTRY_FILE = /^entries\/\d{3,5}-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;
const ASSET_FILE = /^assets\/\d{3,5}-(?:responsive|desktop|tablet|mobile)(?:-full)?\.png$/;
const VIEWPORTS = new Set(["responsive", "desktop", "tablet", "mobile"]);

/**
 * Turn `(session, rel)` into an absolute file path that is guaranteed to be a regular (non-symlink) file
 * location inside `<cwd>/reviews/<session>/`, creating the folders on the way. Throws `Refusal` otherwise.
 *
 * 1. Allow-list, not block-list: `session` must match T07's `SESSION_ID`, and `rel` must be exactly
 *    `session.md`, `entries/NNN-slug.md` or `assets/NNN-<viewport>[-full].png`. Those patterns contain only
 *    `[a-z0-9-/.]`, so `..` segments, absolute paths, NUL, backslashes and percent-encoded traversal
 *    (`%2e%2e`) cannot match.
 * 2. `path.resolve` must stay inside the session folder (belt and braces for 1).
 * 3. Symlinks: the real path of `reviews/`, of the session folder and of the file's parent folder must all
 *    stay inside `realpath(cwd)/reviews/<session>`, and the file itself must not be a symlink.
 */
export async function guardPath(cwd: string, session: unknown, rel: unknown): Promise<string> {
  if (typeof session !== "string" || !SESSION_ID.test(session)) throw new Refusal("bad session id");
  if (typeof rel !== "string" || !(rel === "session.md" || ENTRY_FILE.test(rel) || ASSET_FILE.test(rel))) {
    throw new Refusal("bad file path");
  }
  const root = path.resolve(cwd, "reviews");
  const base = path.resolve(root, session);
  const target = path.resolve(base, rel);
  if (!target.startsWith(base + path.sep)) throw new Refusal("path escapes the session folder");

  // Create and verify one level at a time, so nothing is ever created through a symlink.
  await fs.mkdir(root, { recursive: true });
  const realRoot = await fs.realpath(root);
  if (realRoot !== path.join(await fs.realpath(cwd), "reviews")) throw new Refusal("reviews/ is a symlink");
  await fs.mkdir(base, { recursive: true });
  const realBase = await fs.realpath(base);
  if (realBase !== path.join(realRoot, session)) throw new Refusal("session folder is a symlink");
  await fs.mkdir(path.dirname(target), { recursive: true });
  const realParent = await fs.realpath(path.dirname(target));
  if (realParent !== realBase && !realParent.startsWith(realBase + path.sep)) throw new Refusal("folder is a symlink");
  const st = await fs.lstat(target).catch(() => null);
  if (st && (st.isSymbolicLink() || !st.isFile())) throw new Refusal("target is not a regular file");
  return target;
}

// ---------------------------------------------------------------------------------------------------------
// Writing

/** Write `data` unless the file already holds exactly that. Temp file + rename. Returns whether it wrote. */
async function writeAtomic(file: string, data: string | Buffer): Promise<boolean> {
  const buf = typeof data === "string" ? Buffer.from(data, "utf8") : data;
  const old = await fs.readFile(file).catch(() => null);
  if (old && old.equals(buf)) return false;
  const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  try {
    await fs.writeFile(tmp, buf, { flag: "wx" });
    await fs.rename(tmp, file);
  } catch (e) {
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw e;
  }
  return true;
}

const PNG_PREFIX = "data:image/png;base64,";
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** `data:image/png;base64,...` -> bytes, or `null` when absent. Throws `Refusal` for anything that is not a PNG. */
function decodePng(url: unknown): Buffer | null {
  if (url === undefined || url === null || url === "") return null;
  if (typeof url !== "string" || !url.startsWith(PNG_PREFIX)) throw new Refusal("image must be a PNG data URL");
  const b64 = url.slice(PNG_PREFIX.length);
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(b64)) throw new Refusal("image is not valid base64");
  const bytes = Buffer.from(b64, "base64");
  if (bytes.length < PNG_MAGIC.length || !bytes.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC)) {
    throw new Refusal("image is not a PNG");
  }
  return bytes;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const optStr = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

function checkSession(v: unknown): Session {
  if (!isObj(v) || typeof v.id !== "string" || !SESSION_ID.test(v.id)) throw new Refusal("bad session", 400, "request");
  if (typeof v.title !== "string" || typeof v.reviewer !== "string" || typeof v.started !== "string") {
    throw new Refusal("bad session", 400, "request");
  }
  const s: Session = { id: v.id, title: v.title, reviewer: v.reviewer, started: v.started, version: 1 };
  const branch = optStr(v.branch);
  const sha = optStr(v.sha);
  const env = optStr(v.env);
  if (branch !== undefined) s.branch = branch;
  if (sha !== undefined) s.sha = sha;
  if (env !== undefined) s.env = env;
  return s;
}

const bad = (what: string): never => {
  throw new Refusal(`bad ${what}`);
};
const oneOf = <T extends string>(v: unknown, list: readonly T[], what: string): T =>
  typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T) : bad(what);
const str = (v: unknown, what: string): string => (typeof v === "string" ? v : bad(what));
const optStrField = (v: unknown, what: string): string | undefined => (v === undefined ? undefined : str(v, what));
const bool = (v: unknown, what: string): boolean => (typeof v === "boolean" ? v : bad(what));
const num = (v: unknown, what: string): number => (typeof v === "number" && Number.isFinite(v) ? v : bad(what));
const count = (v: unknown, what: string): number => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : bad(what));
const objArray = (v: unknown, what: string): Record<string, unknown>[] =>
  Array.isArray(v) && v.every(isObj) ? (v as Record<string, unknown>[]) : bad(what);
const strArray = (v: unknown, what: string): string[] =>
  Array.isArray(v) && v.every((s) => typeof s === "string") ? (v as string[]) : bad(what);
function checkSummary(v: unknown): NonNullable<Entry["context"]["summary"]> {
  if (!isObj(v)) throw new Refusal("bad context summary");
  return {
    consoleLines: count(v.consoleLines, "context summary"),
    consoleErrors: count(v.consoleErrors, "context summary"),
    consoleItems: strArray(v.consoleItems, "context summary"),
    networkTotal: count(v.networkTotal, "context summary"),
    networkFailed: count(v.networkFailed, "context summary"),
    networkItems: strArray(v.networkItems, "context summary"),
  };
}
function checkTarget(v: unknown): Entry["targets"][number] {
  if (!isObj(v)) throw new Refusal("bad target");
  if (v.source !== null && typeof v.source !== "string") throw new Refusal("bad target");
  return {
    selector: str(v.selector, "target"),
    source: v.source,
    sourceInherited: bool(v.sourceInherited, "target"),
    label: str(v.label, "target"),
    component: str(v.component, "target"),
  };
}

/**
 * Validate every field we use and rebuild the entry from them (unknown properties are dropped). Anything
 * that is not exactly the right type or enum value is a 400: `serialize` writes these into frontmatter, so a
 * string like `"point\nstatus: resolved"` must never get that far.
 */
function checkEntry(v: unknown, session: Session): Entry {
  if (!isObj(v)) throw new Refusal("bad entry");
  const n = v.n;
  if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > 99999) throw new Refusal("bad entry number");
  if (v.id !== `PRO-${n}` || v.session !== session.id) throw new Refusal("entry does not belong to the session");
  if (typeof v.viewport !== "string" || !VIEWPORTS.has(v.viewport)) throw new Refusal("bad viewport");
  const size = v.size;
  if (!isObj(size)) throw new Refusal("bad size");
  if (!Array.isArray(v.targets)) throw new Refusal("bad targets");
  const targets = v.targets.map(checkTarget);
  const ctx = v.context;
  if (!isObj(ctx)) throw new Refusal("bad context");
  const snap = v.snapshot;
  if (snap !== undefined && !isObj(snap)) throw new Refusal("bad snapshot");
  if (!Array.isArray(v.tags) || !v.tags.every((t) => typeof t === "string")) throw new Refusal("bad tags");
  if (v.issue !== null && typeof v.issue !== "string") throw new Refusal("bad issue");
  if (v.extra !== undefined && !isObj(v.extra)) throw new Refusal("bad extra");
  const activity = objArray(v.activity, "activity").map((a) => ({ at: str(a.at, "activity"), who: str(a.who, "activity"), text: str(a.text, "activity") }));
  const build = optStrField(ctx.build, "context");
  const entry: Entry = {
    id: `PRO-${n}`,
    n,
    session: session.id,
    status: oneOf(v.status, ENTRY_STATUSES, "status"),
    intent: oneOf(v.intent, ENTRY_INTENTS, "intent"),
    priority: oneOf(v.priority, ENTRY_PRIORITIES, "priority"),
    kind: oneOf(v.kind, ENTRY_KINDS, "kind"),
    title: str(v.title, "title"),
    description: str(v.description, "description"),
    viewport: v.viewport as Entry["viewport"],
    size: { width: num(size.width, "size"), height: num(size.height, "size") },
    rotated: bool(v.rotated, "rotated"),
    route: str(v.route, "route"),
    targets,
    tags: v.tags as string[],
    issue: v.issue,
    created: str(v.created, "created"),
    updated: str(v.updated, "updated"),
    context: {
      console: objArray(ctx.console, "context") as unknown as Entry["context"]["console"],
      network: objArray(ctx.network, "context") as unknown as Entry["context"]["network"],
      queries: objArray(ctx.queries, "context") as unknown as Entry["context"]["queries"],
      ...(build !== undefined ? { build } : {}),
      // An entry adopted from a file has empty arrays and only this summary: keep it, or the next write
      // would replace the original Context lines with "0 lines".
      ...(ctx.summary !== undefined ? { summary: checkSummary(ctx.summary) } : {}),
    },
    activity,
  };
  if (v.ref !== undefined) entry.ref = str(v.ref, "ref");
  if (targets[0]) entry.target = targets[0];
  const quote = optStrField(v.quote, "quote");
  const task = optStrField(v.task, "task");
  const testPlan = optStrField(v.testPlan, "testPlan");
  if (quote !== undefined) entry.quote = quote;
  if (task !== undefined) entry.task = task;
  if (testPlan !== undefined) entry.testPlan = testPlan;
  if (v.extra !== undefined) entry.extra = v.extra as Record<string, unknown>;
  if (snap !== undefined) {
    const assets = isObj(snap.assets) ? snap.assets : {};
    entry.snapshot = {
      ...(snap.element !== undefined ? { element: str(snap.element, "snapshot") } : {}),
      ...(snap.viewport !== undefined ? { viewport: str(snap.viewport, "snapshot") } : {}),
      assets: {
        ...(assets.element !== undefined ? { element: str(assets.element, "snapshot") } : {}),
        ...(assets.viewport !== undefined ? { viewport: str(assets.viewport, "snapshot") } : {}),
      },
    };
  }
  return entry;
}

/** Write one entry (+ its images). Returns the paths, relative to the session folder, that changed. */
async function writeEntry(cwd: string, session: Session, input: Entry): Promise<string[]> {
  const changed: string[] = [];
  const put = async (rel: string, data: string | Buffer) => {
    if (await writeAtomic(await guardPath(cwd, session.id, rel), data)) changed.push(rel);
  };
  const names = assetNames(input.n, input.viewport);
  const element = decodePng(input.snapshot?.element);
  const full = decodePng(input.snapshot?.viewport);
  // The file names come from (n, viewport), never from the client, and the links are rewritten to match.
  const assets = {
    ...(element || input.snapshot?.assets?.element ? { element: names.element } : {}),
    ...(full || input.snapshot?.assets?.viewport ? { viewport: names.viewport } : {}),
  };
  const entry: Entry = { ...input, snapshot: { ...input.snapshot, assets } };
  let markdown: string;
  try {
    markdown = serialize(entry, session);
  } catch {
    throw new Refusal("entry could not be serialized");
  }
  if (element) await put(`assets/${names.element}`, element);
  if (full) await put(`assets/${names.viewport}`, full);
  // The entry no longer links an element crop: remove the one left over from an earlier version.
  if (!assets.element) {
    const old = await guardPath(cwd, session.id, `assets/${names.element}`);
    if (await fs.lstat(old).then(() => true, () => false)) {
      await fs.rm(old, { force: true });
      changed.push(`assets/${names.element}`);
    }
  }

  const rel = entryPath(entry);
  await put(rel, markdown);

  // A renamed title is a new file name: delete the old `NNN-*.md` of the same number.
  const dir = path.dirname(await guardPath(cwd, session.id, rel));
  for (const name of await fs.readdir(dir)) {
    if (name.startsWith(`${pad(entry.n)}-`) && ENTRY_FILE.test(`entries/${name}`) && `entries/${name}` !== rel) {
      await fs.rm(path.join(dir, name), { force: true });
      changed.push(`entries/${name}`);
    }
  }
  return changed;
}

/** Entries on disk for a session folder, parsed (unreadable or malformed files are skipped). */
async function readEntries(sessionDir: string): Promise<{ path: string; markdown: string; entry: Entry }[]> {
  const out: { path: string; markdown: string; entry: Entry }[] = [];
  const dirents = await fs.readdir(path.join(sessionDir, "entries"), { withFileTypes: true }).catch(() => []);
  for (const d of dirents) {
    const rel = `entries/${d.name}`;
    if (!d.isFile() || !ENTRY_FILE.test(rel)) continue; // isFile() is false for symlinks
    try {
      const file = path.join(sessionDir, rel);
      if (!(await fs.lstat(file)).isFile()) continue; // lstat: a symlink is skipped, never followed
      const markdown = await fs.readFile(file, "utf8");
      out.push({ path: rel, markdown, entry: parse(markdown) });
    } catch {
      // not ours / hand-edited into something unparsable: leave it alone
    }
  }
  return out.sort((a, b) => a.entry.n - b.entry.n);
}

// ---------------------------------------------------------------------------------------------------------
// Handlers

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const notFound = () => new Response("Not found", { status: 404 });

function nextDevEnabled(): boolean {
  return process.env.NODE_ENV === "development" && process.env.NEXT_PUBLIC_PROOMPTER === "true";
}

/** Header the sink sends on every request. A custom header forces a CORS preflight, which we never answer. */
export const PROOMPTER_HEADER = "x-proompter";

/** `localhost:3000` / `[::1]:3000` / `127.0.0.1` -> lowercase host name without the port. */
function hostName(host: string): string {
  const h = host.toLowerCase();
  if (h.startsWith("[")) return h.slice(0, h.indexOf("]") + 1);
  return h.split(":")[0] ?? "";
}

/**
 * Only same-origin requests from our own sink to a loopback host (or a host the developer allowed) get through
 * (CSRF and DNS rebinding: a web page must not be able to write files or read reviews through the dev server).
 * Throws 403 on any failure. The `Host` check looks at both the header and the URL the framework built.
 */
function checkRequest(req: Request, allowedHosts: ReadonlySet<string>): void {
  const url = new URL(req.url);
  const hostHeader = req.headers.get("host");
  for (const h of [url.host, ...(hostHeader !== null ? [hostHeader] : [])]) {
    if (!LOOPBACK.has(hostName(h)) && !allowedHosts.has(hostName(h))) throw new Refusal("host not allowed", 403);
  }
  const site = req.headers.get("sec-fetch-site");
  if (site !== null && site !== "same-origin") throw new Refusal("cross-site request", 403);
  const origin = req.headers.get("origin");
  if (origin !== null && origin !== url.origin) throw new Refusal("origin not allowed", 403);
  if (req.headers.get(PROOMPTER_HEADER) !== "1") throw new Refusal("missing x-proompter header", 403);
}
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Read at most `MAX_BODY_BYTES` bytes (counted as they arrive, with or without Content-Length), else 413. */
async function readBody(req: Request): Promise<string> {
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) throw new Refusal("body too large", 413);
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => {});
      throw new Refusal("body too large", 413);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** One write at a time per session folder: concurrent renames and index rebuilds must not interleave. */
const locks = new Map<string, Promise<unknown>>();
function withLock<T>(key: string, job: () => Promise<T>): Promise<T> {
  const run = (locks.get(key) ?? Promise.resolve()).then(job, job);
  const tail = run.catch(() => {});
  locks.set(key, tail);
  void tail.then(() => {
    if (locks.get(key) === tail) locks.delete(key);
  });
  return run;
}

export interface RouteOptions {
  /** Repo root. Default `process.cwd()` (read per request). */
  cwd?: () => string;
  /** Extra host names (no port) that may reach the route, e.g. a tunnel or LAN name. Loopback is always allowed. */
  allowedHosts?: readonly string[];
  /**
   * Whether the route answers at all (else 404). Default: `NODE_ENV === "development"` and
   * `NEXT_PUBLIC_PROOMPTER === "true"`. The Vite plugin mounts it only on the dev server, so it passes `() => true`.
   */
  enabled?: () => boolean;
}

export function createProompterRoute(opts: RouteOptions = {}) {
  const cwdOf = opts.cwd ?? (() => process.cwd());
  const enabled = opts.enabled ?? nextDevEnabled;
  /** `allowedHosts` plus `PROOMPTER_ALLOWED_HOSTS` (comma-separated), read per request. */
  const allowedNow = (): ReadonlySet<string> =>
    new Set(
      [...(opts.allowedHosts ?? []), ...(process.env.PROOMPTER_ALLOWED_HOSTS ?? "").split(",")]
        .map((h) => h.trim())
        .filter((h) => h !== "")
        .map((h) => hostName(h)),
    );

  async function POST(req: Request): Promise<Response> {
    if (!enabled()) return notFound();
    try {
      checkRequest(req, allowedNow());
      if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
        throw new Refusal("content-type must be application/json", 415);
      }
      const text = await readBody(req);
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        throw new Refusal("body is not JSON", 400, "request");
      }
      if (!isObj(body)) throw new Refusal("bad body", 400, "request");
      const session = checkSession(body.session);
      const entries = body.entry !== undefined ? [checkEntry(body.entry, session)] : [];
      const cwd = cwdOf();
      const files = new Set<string>();
      await withLock(path.resolve(cwd, "reviews", session.id), async () => {
        for (const e of entries) for (const f of await writeEntry(cwd, session, e)) files.add(f);
        // The index lists what is on disk, so it is right even for a partial batch.
        const sessionDir = path.dirname(await guardPath(cwd, session.id, "session.md"));
        const index = (await readEntries(sessionDir)).map((r) => r.entry);
        if (await writeAtomic(path.join(sessionDir, "session.md"), serializeSession(session, index))) files.add("session.md");
      });
      return json({ ok: true, files: [...files] });
    } catch (e) {
      if (e instanceof Refusal) return json({ ok: false, scope: e.scope, error: e.message }, e.status);
      return json({ ok: false, scope: "request", error: "write failed" }, 500);
    }
  }

  async function GET(req: Request): Promise<Response> {
    if (!enabled()) return notFound();
    try {
      checkRequest(req, allowedNow());
      const only = new URL(req.url).searchParams.get("session");
      const root = path.resolve(cwdOf(), "reviews");
      const dirents = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
      const sessions: { session: Session; assets: string[]; entries: Awaited<ReturnType<typeof readEntries>> }[] = [];
      for (const d of dirents) {
        if (!d.isDirectory() || !SESSION_ID.test(d.name) || (only !== null && only !== d.name)) continue;
        const dir = path.join(root, d.name);
        // Under the session's lock, so a read never sees a half-finished rename or index rebuild.
        await withLock(dir, async () => {
          try {
            const sessionFile = path.join(dir, "session.md");
            if (!(await fs.lstat(sessionFile)).isFile()) return; // never follow a symlink
            const { session } = parseSession(await fs.readFile(sessionFile, "utf8"));
            const assets = (await fs.readdir(path.join(dir, "assets"), { withFileTypes: true }).catch(() => []))
              .filter((a) => a.isFile() && ASSET_FILE.test(`assets/${a.name}`))
              .map((a) => a.name);
            sessions.push({ session, assets, entries: await readEntries(dir) });
          } catch {
            // no readable session.md: not one of ours
          }
        });
      }
      return json({ ok: true, sessions });
    } catch (e) {
      if (e instanceof Refusal) return json({ ok: false, scope: e.scope, error: e.message }, e.status);
      return json({ ok: false, scope: "request", error: "read failed" }, 500);
    }
  }

  return { GET, POST };
}

const route = createProompterRoute();
export const GET = route.GET;
export const POST = route.POST;
