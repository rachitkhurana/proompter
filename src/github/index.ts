/**
 * `@rachitkay/proompter/github`: the GitHub sync route (DESIGN D16).
 *
 * Mount it in the host (Next: `app/api/proompter/github/route.ts`; the client's `github.endpoint` points at it):
 *
 * ```ts
 * import { createGithubRoute } from "@rachitkay/proompter/github";
 * export const { GET, POST } = createGithubRoute({ repo: "owner/name" });
 * ```
 *
 * ## Guards
 * - 404 unless both the token (`PROOMPTER_GITHUB_TOKEN`) and the review key (`PROOMPTER_REVIEW_KEY`, at least 16
 *   characters) are set, so a deploy without them exposes nothing.
 * - The same request checks as the dev route (`x-proompter: 1`, same-origin, JSON): 403 / 415. A preview is not
 *   loopback, so any host is allowed unless `allowedHosts` is given
 *   (then loopback, those hosts and `PROOMPTER_ALLOWED_HOSTS`, as the dev route).
 * - `Authorization: Bearer <reviewKey>` (constant-time compare): 401 otherwise. The token never leaves the server
 *   and is never put in a response.
 * - The same entry validation and 20 MB body cap as the dev route.
 *
 * ## API
 * - `POST { session, entry }`: upserts the issue, then writes `session.md`, `entries/NNN-slug.md` and the PNGs to
 *   `reviews/<session>/` on the `reviews` branch (created from the default branch's head when missing).
 *   Unchanged files are skipped (git blob sha), a renamed title deletes the old file. Answers
 *   `{ ok, issue, url, state, files }`.
 * - `GET ?session=ID&started=ISO`: `{ ok, issues: [{ n, issue, state, url }] }`.
 * - Both answer 409 when `reviews/<session>/session.md` on the branch records another review's `started`: two
 *   reviews sharing a session id would overwrite each other's issues and files. (`started` is optional on GET for
 *   0.1.0 clients.)
 *
 * Issues are found by the `proompter` label plus the `ref:` line in the body. The client's `entry.issue` is only a
 * hint, read directly (the label listing lags a new issue by seconds) and used only when that issue carries the
 * label and this entry's `ref`, so a lost local number cannot create a duplicate and a client cannot edit someone
 * else's issue.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { assetNames, pad, parseSession, serializeSession } from "../core/serialize";
import type { Entry, Session } from "../core/entry";
import { SESSION_ID } from "../core/store";
import { checkEntry, checkRequest, checkSession, hostName, isObj, json, notFound, readBody, Refusal } from "../server/validate";
import { ENTRY_FILE, planEntry, withLock } from "../server/write";

export interface GithubRouteOptions {
  /** `owner/name`. */
  repo: string;
  /** Default `process.env.PROOMPTER_GITHUB_TOKEN`. Fine-grained PAT with Contents and Issues read/write on `repo`. */
  token?: string;
  /** Branch the files land on. Default `reviews`. */
  branch?: string;
  /** Shared secret the client sends as a bearer token. Default `process.env.PROOMPTER_REVIEW_KEY`. */
  reviewKey?: string;
  /**
   * Host names (no port) that may reach the route, besides loopback and `PROOMPTER_ALLOWED_HOSTS`. Default: any
   * host (previews are not loopback; the review key is the guard).
   */
  allowedHosts?: readonly string[];
  /** GitHub API base. Default `https://api.github.com`; tests point it at the fake. */
  api?: string;
  /** Default global `fetch`; tests inject the fake. */
  fetch?: typeof fetch;
}

/** GitHub (not the caller) failed. Becomes a 502 so the client never mistakes it for a bad review key. */
class GithubError extends Error {}

interface Issue {
  number: number;
  title: string;
  body: string | null;
  state: "open" | "closed";
  html_url: string;
  labels: ({ name: string } | string)[];
  pull_request?: unknown;
}

const MAX_ISSUE_BODY = 60_000; // GitHub's limit is 65536
const MAX_ISSUE_PAGES = 10;
const REF_LINE = /^ref:\s*"?([^"\s]+)"?\s*$/m;
/** A shorter review key is guessable: the route stays 404 (`openssl rand -hex 24` makes a good one). */
const MIN_KEY_LENGTH = 16;
const LABEL_COLOR = "ededed";

const digest = (s: string) => createHash("sha256").update(s).digest();
const blobSha = (bytes: Buffer) => createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
const labelName = (l: Issue["labels"][number]) => (typeof l === "string" ? l : l.name);
/** Issue text is shown to people: break `@user` and `@org/team` so a synced entry cannot ping anyone. */
const defang = (t: string) => t.replace(/@/g, "@\u200b");
const refOf = (i: Issue) => REF_LINE.exec(i.body ?? "")?.[1];

export function createGithubRoute(opts: GithubRouteOptions) {
  const branch = opts.branch ?? "reviews";
  const api = (opts.api ?? "https://api.github.com").replace(/\/+$/, "");
  /** `allowedHosts` plus `PROOMPTER_ALLOWED_HOSTS` (as the dev route), read per request. Only used when `allowedHosts` is given. */
  const allowedNow = (): ReadonlySet<string> =>
    new Set(
      [...(opts.allowedHosts ?? []), ...(process.env.PROOMPTER_ALLOWED_HOSTS ?? "").split(",")]
        .map((h) => h.trim())
        .filter((h) => h !== "")
        .map((h) => hostName(h)),
    );
  /** The branch as a URL path: each segment encoded, the slashes kept (`feat/x` works). */
  const branchPath = (b: string) => b.split("/").map(encodeURIComponent).join("/");
  const repoPath = `/repos/${opts.repo}`;
  const knownLabels = new Set<string>();

  /** Token and key, read per request. Either missing, or a key shorter than `MIN_KEY_LENGTH`: the route does not exist. */
  const secrets = () => {
    const token = opts.token ?? process.env.PROOMPTER_GITHUB_TOKEN;
    const key = opts.reviewKey ?? process.env.PROOMPTER_REVIEW_KEY;
    return token && key && key.length >= MIN_KEY_LENGTH ? { token, key } : null;
  };

  function guard(req: Request, key: string): void {
    checkRequest(req, allowedNow(), opts.allowedHosts === undefined);
    const m = /^Bearer (.+)$/.exec(req.headers.get("authorization") ?? "");
    if (!m || !timingSafeEqual(digest(m[1] as string), digest(key))) throw new Refusal("missing or wrong review key", 401, "request");
  }

  function client(token: string) {
    const doFetch = opts.fetch ?? globalThis.fetch;
    /** One GitHub call. Returns the response; the caller decides which statuses are fine. */
    return async (method: string, path: string, body?: unknown): Promise<Response> => {
      try {
        return await doFetch.call(globalThis, `${api}${path}`, {
          method,
          headers: {
            authorization: `Bearer ${token}`,
            accept: "application/vnd.github+json",
            "x-github-api-version": "2022-11-28",
            "user-agent": "proompter",
            ...(body !== undefined ? { "content-type": "application/json" } : {}),
          },
          ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        });
      } catch {
        throw new GithubError("could not reach GitHub");
      }
    };
  }
  type Call = ReturnType<typeof client>;

  const fail = async (res: Response, what: string): Promise<never> => {
    let detail = "";
    try {
      const b: unknown = await res.json();
      if (isObj(b) && typeof b.message === "string") detail = `: ${b.message.slice(0, 120)}`;
    } catch {
      // not JSON
    }
    throw new GithubError(`GitHub refused ${what} (${res.status}${detail})`);
  };
  const expect = async (res: Response, what: string, ...ok: number[]): Promise<Response> => (ok.includes(res.status) ? res : fail(res, what));

  async function ensureBranch(call: Call): Promise<void> {
    const ref = `${repoPath}/git/ref/heads/${branchPath(branch)}`;
    const have = await call("GET", ref);
    if (have.ok) return;
    if (have.status !== 404) return void (await fail(have, "reading the branch"));
    const repo = (await (await expect(await call("GET", repoPath), "reading the repo", 200)).json()) as { default_branch?: string };
    const base = await expect(await call("GET", `${repoPath}/git/ref/heads/${branchPath(repo.default_branch ?? "main")}`), "reading the default branch", 200);
    const sha = ((await base.json()) as { object?: { sha?: string } }).object?.sha;
    const made = await call("POST", `${repoPath}/git/refs`, { ref: `refs/heads/${branch}`, sha });
    if (made.status === 422) {
      // Either a concurrent sync made it (fine) or GitHub refused the name or sha (not fine): look again.
      if (!(await call("GET", ref)).ok) throw new GithubError(`GitHub could not create the branch "${branch}" (422)`);
      return;
    }
    await expect(made, "creating the branch", 201);
  }

  async function ensureLabels(call: Call, names: string[]): Promise<void> {
    for (const name of names) {
      if (knownLabels.has(name)) continue;
      const res = await call("POST", `${repoPath}/labels`, { name, color: LABEL_COLOR });
      if (res.status !== 422) await expect(res, "creating a label", 201); // 422: it exists
      knownLabels.add(name);
    }
  }

  /** Every `proompter` issue (open and closed), newest pages capped. Pull requests are not ours. */
  async function proompterIssues(call: Call, stopAt?: (i: Issue) => boolean): Promise<Issue[]> {
    const out: Issue[] = [];
    for (let page = 1; page <= MAX_ISSUE_PAGES; page++) {
      const res = await expect(await call("GET", `${repoPath}/issues?labels=proompter&state=all&per_page=100&page=${page}`), "listing issues", 200);
      const batch = (await res.json()) as Issue[];
      out.push(...batch.filter((i) => !i.pull_request));
      if (batch.length < 100 || (stopAt && out.some(stopAt))) break;
    }
    return out;
  }

  /** `name -> sha` of the files directly inside `dir` on the branch (none when the folder does not exist). */
  async function listDir(call: Call, dir: string): Promise<Map<string, string>> {
    const res = await call("GET", `${repoPath}/contents/${dir}?ref=${encodeURIComponent(branch)}`);
    if (res.status === 404) return new Map();
    const list = (await (await expect(res, "listing files", 200)).json()) as unknown;
    return new Map(Array.isArray(list) ? list.filter((f) => isObj(f) && f.type === "file").map((f) => [String((f as Record<string, unknown>).name), String((f as Record<string, unknown>).sha)] as const) : []);
  }

  async function readText(call: Call, file: string): Promise<{ text: string; sha: string } | null> {
    const res = await call("GET", `${repoPath}/contents/${file}?ref=${encodeURIComponent(branch)}`);
    if (res.status === 404) return null;
    const f = (await (await expect(res, "reading a file", 200)).json()) as { content?: string; sha?: string };
    if (typeof f.content !== "string" || typeof f.sha !== "string") return null;
    return { text: Buffer.from(f.content, "base64").toString("utf8"), sha: f.sha };
  }

  /** PUT a file unless the branch already holds exactly these bytes. Returns whether it wrote. */
  async function putFile(call: Call, file: string, data: string | Buffer, have: string | undefined): Promise<boolean> {
    const bytes = typeof data === "string" ? Buffer.from(data, "utf8") : data;
    if (have === blobSha(bytes)) return false;
    let sha = have;
    for (let attempt = 0; ; attempt++) {
      const res = await call("PUT", `${repoPath}/contents/${file}`, {
        message: `proompter: ${file}`,
        content: bytes.toString("base64"),
        branch,
        ...(sha !== undefined ? { sha } : {}),
      });
      if (res.ok) return true;
      if (attempt > 0 || (res.status !== 409 && res.status !== 422)) return fail(res, "writing a file");
      // Someone else wrote it meanwhile (another sync): take the current sha and try once more.
      const now = await call("GET", `${repoPath}/contents/${file}?ref=${encodeURIComponent(branch)}`);
      sha = now.ok ? ((await now.json()) as { sha?: string }).sha : undefined;
      if (sha !== undefined && sha === blobSha(bytes)) return false;
    }
  }

  async function removeFile(call: Call, file: string, sha: string): Promise<void> {
    let current = sha;
    for (let attempt = 0; ; attempt++) {
      const res = await call("DELETE", `${repoPath}/contents/${file}`, { message: `proompter: remove ${file}`, sha: current, branch });
      if (res.ok || res.status === 404) return;
      if (attempt > 0 || (res.status !== 409 && res.status !== 422)) return void (await fail(res, "removing a file"));
      // It changed under us: take the current sha and try once more (gone already is fine).
      const now = await call("GET", `${repoPath}/contents/${file}?ref=${encodeURIComponent(branch)}`);
      if (now.status === 404) return;
      const next = now.ok ? ((await now.json()) as { sha?: string }).sha : undefined;
      if (next === undefined) return void (await fail(res, "removing a file"));
      current = next;
    }
  }

  /** The issue `number` if it exists, is a `proompter` issue (not a PR) and its body carries `ref`; else null. */
  async function knownIssue(call: Call, number: string | null, ref: string): Promise<Issue | null> {
    if (!number || !/^[1-9]\d{0,8}$/.test(number)) return null;
    const res = await call("GET", `${repoPath}/issues/${number}`);
    if (res.status === 404 || res.status === 410) return null;
    const issue = (await (await expect(res, "reading the issue", 200)).json()) as Issue;
    const ours = !issue.pull_request && issue.labels.some((l) => labelName(l) === "proompter") && refOf(issue) === ref;
    return ours ? issue : null;
  }

  async function upsertIssue(call: Call, session: Session, entry: Entry, markdown: string, image: string | null): Promise<Issue> {
    const ref = `${session.id}/${entry.id}`;
    const labels = ["proompter", `kind:${entry.kind}`, `priority:${entry.priority}`];
    const imageLine = image ? `\n\n![snapshot](https://github.com/${opts.repo}/blob/${branch}/reviews/${session.id}/assets/${image}?raw=true)\n` : "\n";
    const body = markdown.length > MAX_ISSUE_BODY ? `${markdown.slice(0, MAX_ISSUE_BODY)}\n\n(truncated, see the file on the branch)` : markdown;
    const text = defang(`${body}${imageLine}`);
    const title = defang(`${entry.id}: ${entry.title.replace(/\s+/g, " ").trim()}`).slice(0, 250);
    const state = entry.status === "resolved" ? "closed" : "open";
    await ensureLabels(call, labels);
    // GitHub's label listing lags a few seconds behind a new issue, so a re-sync right after the first one would not
    // find it there and open a duplicate. The number the client already holds is read directly (consistent), and
    // trusted only if that issue is ours and carries this entry's ref; otherwise fall back to the listing.
    const found =
      (await knownIssue(call, entry.issue, ref)) ??
      (await proompterIssues(call, (i) => refOf(i) === ref)).find((i) => refOf(i) === ref);
    if (!found) {
      const res = await expect(await call("POST", `${repoPath}/issues`, { title, body: text, labels }), "creating the issue", 201);
      const made = (await res.json()) as Issue;
      if (state === "closed") {
        return (await (await expect(await call("PATCH", `${repoPath}/issues/${made.number}`, { state, state_reason: "completed" }), "closing the issue", 200)).json()) as Issue;
      }
      return made;
    }
    // Keep labels other people added; replace only ours.
    const mine = (n: string) => n === "proompter" || n.startsWith("kind:") || n.startsWith("priority:");
    const next = [...found.labels.map(labelName).filter((n) => !mine(n)), ...labels];
    const same = [...next].sort().join("\n") === found.labels.map(labelName).sort().join("\n");
    const patch: Record<string, unknown> = {};
    if (found.title !== title) patch.title = title;
    if ((found.body ?? "") !== text) patch.body = text;
    if (found.state !== state) {
      patch.state = state;
      if (state === "closed") patch.state_reason = "completed";
    }
    if (!same) patch.labels = next;
    if (Object.keys(patch).length === 0) return found;
    return (await (await expect(await call("PATCH", `${repoPath}/issues/${found.number}`, patch), "updating the issue", 200)).json()) as Issue;
  }

  /**
   * Two reviews must never share a session folder: their PRO-n numbers would collide, and one would overwrite the
   * other's issues and files. A session on the branch belongs to the review whose `started` its `session.md`
   * records (the kit keeps `started` per browser across tabs and reloads); another one is refused with 409.
   */
  function assertOwner(text: string, id: string, started: string): void {
    let theirs: Session;
    try {
      theirs = parseSession(text).session;
    } catch {
      return; // hand-edited into something unparsable: nothing to compare, sync rebuilds the index
    }
    const at = Date.parse(theirs.started);
    if (Number.isNaN(at) || at === Date.parse(started)) return;
    throw new Refusal(
      `Session ${id} on GitHub belongs to another review (started ${theirs.started} by ${theirs.reviewer}). Start a new session to sync.`,
      409,
      "request",
    );
  }

  /** GET: check only. */
  async function checkOwner(call: Call, id: string, started: string): Promise<void> {
    const old = await readText(call, `reviews/${id}/session.md`);
    if (old) assertOwner(old.text, id, started);
  }

  /**
   * POST: check, or claim a new session by creating its `session.md` before any issue or file. The create sends no
   * sha, so GitHub refuses it (422) when the file appeared meanwhile: of two reviews racing for one id (across server
   * instances, where `withLock` does not reach), exactly one gets it and the other is checked against it.
   */
  async function claimSession(call: Call, session: Session): Promise<void> {
    const file = `reviews/${session.id}/session.md`;
    for (let attempt = 0; attempt < 2; attempt++) {
      const old = await readText(call, file);
      if (old) return assertOwner(old.text, session.id, session.started);
      const res = await call("PUT", `${repoPath}/contents/${file}`, {
        message: `proompter: ${file}`,
        content: Buffer.from(serializeSession(session, []), "utf8").toString("base64"),
        branch,
      });
      if (res.ok) return;
      if (res.status !== 409 && res.status !== 422) await fail(res, "writing a file");
    }
    throw new GithubError("GitHub kept refusing to create session.md");
  }

  async function sync(call: Call, session: Session, input: Entry): Promise<Record<string, unknown>> {
    // Validate the images and the entry before GitHub sees anything.
    planEntry(session, input);
    await ensureBranch(call);
    await claimSession(call, session);
    const names = assetNames(input.n, input.viewport);
    const snap = input.snapshot;
    const image = snap?.assets?.element || snap?.element ? names.element : snap?.assets?.viewport || snap?.viewport ? names.viewport : null;
    // The issue body is the entry without its own issue number, so it is stable from the first sync on.
    const issue = await upsertIssue(call, session, input, planEntry(session, { ...input, issue: null }).markdown, image);
    // The files carry the issue number, so the next sync finds them unchanged.
    const entry: Entry = { ...input, issue: String(issue.number) };
    const plan = planEntry(session, entry);

    const base = `reviews/${session.id}`;
    const changed: string[] = [];
    const put = async (rel: string, data: string | Buffer, have: string | undefined) => {
      if (await putFile(call, `${base}/${rel}`, data, have)) changed.push(rel);
    };
    if (plan.png.size || plan.staleElement) {
      const have = await listDir(call, `${base}/assets`);
      for (const [rel, bytes] of plan.png) await put(rel, bytes, have.get(rel.slice("assets/".length)));
      // The entry no longer links an element crop: remove the one left over from an earlier version.
      const stale = plan.staleElement ? have.get(plan.staleElement.slice("assets/".length)) : undefined;
      if (plan.staleElement && stale !== undefined) {
        await removeFile(call, `${base}/${plan.staleElement}`, stale);
        changed.push(plan.staleElement);
      }
    }
    const entries = await listDir(call, `${base}/entries`);
    await put(plan.rel, plan.markdown, entries.get(plan.rel.slice("entries/".length)));
    // A renamed title is a new file name: delete the old `NNN-*.md` of the same number.
    for (const [name, sha] of entries) {
      if (name.startsWith(`${pad(entry.n)}-`) && ENTRY_FILE.test(`entries/${name}`) && `entries/${name}` !== plan.rel) {
        await removeFile(call, `${base}/entries/${name}`, sha);
        changed.push(`entries/${name}`);
      }
    }
    // The index: what is already on the branch, with this entry replaced.
    const old = await readText(call, `${base}/session.md`);
    let index: { id: string; n: number; status: Entry["status"]; priority: Entry["priority"]; title: string }[] = [];
    try {
      index = old ? parseSession(old.text).entries : [];
    } catch {
      // hand-edited into something unparsable: rebuild from this entry
    }
    index = [...index.filter((e) => e.n !== entry.n), { id: entry.id, n: entry.n, status: entry.status, priority: entry.priority, title: entry.title }];
    await put("session.md", serializeSession(session, index), old?.sha);
    return { ok: true, issue: String(issue.number), url: issue.html_url, state: issue.state, files: changed };
  }

  const refuse = (e: unknown): Response => {
    if (e instanceof Refusal) return json({ ok: false, scope: e.scope, error: e.message }, e.status);
    if (e instanceof GithubError) return json({ ok: false, scope: "request", error: e.message }, 502);
    return json({ ok: false, scope: "request", error: "sync failed" }, 500);
  };

  async function POST(req: Request): Promise<Response> {
    const s = secrets();
    if (!s) return notFound();
    try {
      guard(req, s.key);
      if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
        throw new Refusal("content-type must be application/json", 415);
      }
      let body: unknown;
      try {
        body = JSON.parse(await readBody(req));
      } catch (e) {
        throw e instanceof Refusal ? e : new Refusal("body is not JSON", 400, "request");
      }
      if (!isObj(body)) throw new Refusal("bad body", 400, "request");
      const session = checkSession(body.session);
      // The ownership check compares `started`: one that does not parse could never match (or lock a session).
      if (Number.isNaN(Date.parse(session.started))) throw new Refusal("bad started", 400, "request");
      if (body.entry === undefined) throw new Refusal("missing entry", 400, "request");
      const entry = checkEntry(body.entry, session);
      // One sync at a time per session in this process: two would race on session.md.
      const result = await withLock(`github:${opts.repo}:${session.id}`, () => sync(client(s.token), session, entry));
      return json(result);
    } catch (e) {
      return refuse(e);
    }
  }

  async function GET(req: Request): Promise<Response> {
    const s = secrets();
    if (!s) return notFound();
    try {
      guard(req, s.key);
      const sid = new URL(req.url).searchParams.get("session");
      if (sid === null || !SESSION_ID.test(sid)) throw new Refusal("bad session id", 400, "request");
      // `started` (sent since 0.1.1): another review's issue states must not resolve this review's entries.
      const started = new URL(req.url).searchParams.get("started");
      if (started !== null) {
        if (Number.isNaN(Date.parse(started))) throw new Refusal("bad started", 400, "request");
        await checkOwner(client(s.token), sid, started);
      }
      const issues = (await proompterIssues(client(s.token)))
        .map((i) => ({ i, ref: refOf(i) }))
        .filter((x) => x.ref?.startsWith(`${sid}/PRO-`))
        .map(({ i, ref }) => ({ n: Number(/PRO-(\d+)$/.exec(ref ?? "")?.[1]), issue: String(i.number), state: i.state, url: i.html_url }))
        .filter((x) => Number.isInteger(x.n));
      return json({ ok: true, issues });
    } catch (e) {
      return refuse(e);
    }
  }

  return { GET, POST };
}
