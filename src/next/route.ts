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
import type { Session } from "../core/entry";
import { parseSession, serializeSession } from "../core/serialize";
import { SESSION_ID } from "../core/store";
import { checkEntry, checkRequest, checkSession, hostName, isObj, json, notFound, readBody, Refusal } from "../server/validate";
import { ASSET_FILE, guardPath, readEntries, withLock, writeAtomic, writeEntry } from "../server/write";

// The shared pieces live in `src/server/`; these names stay importable from here.
export { MAX_BODY_BYTES, PROOMPTER_HEADER } from "../server/validate";
export { guardPath } from "../server/write";

function nextDevEnabled(): boolean {
  return process.env.NODE_ENV === "development" && process.env.NEXT_PUBLIC_PROOMPTER === "true";
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
