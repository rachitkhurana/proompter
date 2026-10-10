/**
 * Request validation shared by the dev file route (`src/next/route.ts`), the GitHub route
 * (`src/github/index.ts`) and, later, the CLI. Nothing here touches the disk or the network.
 */
import { ENTRY_INTENTS, ENTRY_KINDS, ENTRY_PRIORITIES, ENTRY_STATUSES, type Entry, type Session } from "../core/entry";
import { SESSION_ID } from "../core/store";

export const MAX_BODY_BYTES = 20 * 1024 * 1024;

/** A request we refuse; `status` is the HTTP status. */
export class Refusal extends Error {
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

export const VIEWPORTS = new Set(["responsive", "desktop", "tablet", "mobile"]);

const PNG_PREFIX = "data:image/png;base64,";
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** `data:image/png;base64,...` -> bytes, or `null` when absent. Throws `Refusal` for anything that is not a PNG. */
export function decodePng(url: unknown): Buffer | null {
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

export const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const optStr = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

export function checkSession(v: unknown): Session {
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
export function checkEntry(v: unknown, session: Session): Entry {
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
  const resolution = optStrField(v.resolution, "resolution");
  if (resolution !== undefined) entry.resolution = resolution;
  const replies = optStrField(v.replies, "replies");
  if (replies !== undefined) entry.replies = replies;
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


export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
export const notFound = () => new Response("Not found", { status: 404 });

/** Header the sink sends on every request. A custom header forces a CORS preflight, which we never answer. */
export const PROOMPTER_HEADER = "x-proompter";

/** `localhost:3000` / `[::1]:3000` / `127.0.0.1` -> lowercase host name without the port. */
export function hostName(host: string): string {
  const h = host.toLowerCase();
  if (h.startsWith("[")) return h.slice(0, h.indexOf("]") + 1);
  return h.split(":")[0] ?? "";
}

/**
 * Only same-origin requests from our own sink to a loopback host (or a host the developer allowed) get through
 * (CSRF and DNS rebinding: a web page must not be able to write files or read reviews through the dev server).
 * Throws 403 on any failure. The `Host` check looks at both the header and the URL the framework built;
 * `anyHost` skips it (the GitHub route runs on previews, which are not loopback; its bearer key is the guard).
 */
export function checkRequest(req: Request, allowedHosts: ReadonlySet<string>, anyHost = false): void {
  const url = new URL(req.url);
  const hostHeader = req.headers.get("host");
  for (const h of anyHost ? [] : [url.host, ...(hostHeader !== null ? [hostHeader] : [])]) {
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
export async function readBody(req: Request): Promise<string> {
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

