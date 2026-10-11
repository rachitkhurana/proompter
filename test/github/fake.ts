/**
 * An in-memory GitHub, just the endpoints `createGithubRoute` calls (refs, contents, labels, issues).
 * `handle(Request) -> Response` is a `fetch`; `scripts/e2e-servers.mjs` serves the same code over node:http.
 * Erasable TypeScript only: Node runs this file directly.
 */
import { createHash } from "node:crypto";

export interface FakeIssue {
  number: number;
  title: string;
  body: string;
  state: "open" | "closed";
  labels: { name: string }[];
  html_url: string;
  pull_request?: unknown;
}

export interface FakeOptions {
  /** `owner/name`. Requests for any other repo answer 404. */
  repo?: string;
  /** Bearer token the fake accepts. */
  token?: string;
  defaultBranch?: string;
}

export const blobSha = (bytes: Uint8Array): string =>
  createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");

const j = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export function createFakeGithub(opts: FakeOptions = {}) {
  const repo = opts.repo ?? "acme/reviews";
  const token = opts.token ?? "ghp_faketoken";
  const defaultBranch = opts.defaultBranch ?? "main";

  const s = {
    /** branch -> path -> bytes */
    branches: new Map<string, Map<string, Buffer>>(),
    issues: [] as FakeIssue[],
    labels: new Set<string>(),
    /** Every request as "METHOD /path", for assertions. */
    log: [] as string[],
    /** Number of PUT/DELETE contents calls. */
    writes: 0,
    /** Issue numbers the list endpoint leaves out, as GitHub's label listing does for a few seconds after a create. */
    unlisted: new Set<number>(),
  };
  const reset = () => {
    s.branches = new Map([[defaultBranch, new Map([["README.md", Buffer.from("# reviews\n")]])]]);
    s.issues = [];
    s.labels = new Set();
    s.log = [];
    s.writes = 0;
    s.unlisted = new Set();
  };
  reset();

  async function handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const method = req.method;
    s.log.push(`${method} ${url.pathname}${url.search}`);
    if (url.pathname === "/__reset" && method === "POST") {
      reset();
      return j({ ok: true });
    }
    if (url.pathname === "/__state" && method === "GET") {
      const files: Record<string, Record<string, string>> = {};
      for (const [b, m] of s.branches) files[b] = Object.fromEntries([...m].map(([p, v]) => [p, v.toString("base64")]));
      return j({ files, issues: s.issues, labels: [...s.labels], writes: s.writes, log: s.log });
    }
    const auth = req.headers.get("authorization") ?? "";
    if (auth !== `Bearer ${token}` && auth !== `token ${token}`) return j({ message: "Bad credentials" }, 401);
    const m = /^\/repos\/([^/]+\/[^/]+)(\/.*)?$/.exec(url.pathname);
    if (!m || m[1] !== repo) return j({ message: "Not Found" }, 404);
    const rest = m[2] ?? "";
    const body = method === "GET" ? {} : ((await req.json().catch(() => ({}))) as Record<string, unknown>);

    if (rest === "" && method === "GET") return j({ default_branch: defaultBranch, full_name: repo });

    let r = /^\/git\/ref\/heads\/(.+)$/.exec(rest);
    if (r && method === "GET") {
      const b = decodeURIComponent(r[1] as string);
      return s.branches.has(b) ? j({ ref: `refs/heads/${b}`, object: { sha: createHash("sha1").update(b).digest("hex") } }) : j({ message: "Not Found" }, 404);
    }
    if (rest === "/git/refs" && method === "POST") {
      const ref = String(body.ref ?? "");
      const b = ref.replace(/^refs\/heads\//, "");
      if (s.branches.has(b)) return j({ message: "Reference already exists" }, 422);
      // The sha must be the default branch's head, as the route got it from /git/ref.
      s.branches.set(b, new Map(s.branches.get(defaultBranch)));
      return j({ ref }, 201);
    }

    r = /^\/contents\/(.+)$/.exec(rest);
    if (r) {
      const p = decodeURIComponent(r[1] as string).replace(/\/$/, "");
      if (method === "GET") {
        const files = s.branches.get(url.searchParams.get("ref") ?? defaultBranch);
        if (!files) return j({ message: "No commit found for the ref" }, 404);
        const hit = files.get(p);
        if (hit) return j({ type: "file", path: p, sha: blobSha(hit), size: hit.length, encoding: "base64", content: hit.toString("base64") });
        const kids = new Map<string, { name: string; path: string; type: string; sha: string }>();
        for (const [fp, bytes] of files) {
          if (!fp.startsWith(`${p}/`)) continue;
          const name = fp.slice(p.length + 1).split("/")[0] as string;
          const isFile = !fp.slice(p.length + 1).includes("/");
          kids.set(name, { name, path: `${p}/${name}`, type: isFile ? "file" : "dir", sha: isFile ? blobSha(bytes) : "tree" });
        }
        return kids.size ? j([...kids.values()]) : j({ message: "Not Found" }, 404);
      }
      const branch = String(body.branch ?? defaultBranch);
      const files = s.branches.get(branch);
      if (!files) return j({ message: "Branch not found" }, 404);
      const old = files.get(p);
      if (method === "PUT") {
        if (typeof body.content !== "string") return j({ message: "content is required" }, 422);
        if (old && body.sha === undefined) return j({ message: "Invalid request. \"sha\" wasn't supplied." }, 422);
        if (old && body.sha !== blobSha(old)) return j({ message: `${p} does not match ${String(body.sha)}` }, 409);
        files.set(p, Buffer.from(body.content, "base64"));
        s.writes++;
        return j({ content: { path: p } }, old ? 200 : 201);
      }
      if (method === "DELETE") {
        if (!old) return j({ message: "Not Found" }, 404);
        if (body.sha !== blobSha(old)) return j({ message: `${p} does not match ${String(body.sha)}` }, 409);
        files.delete(p);
        s.writes++;
        return j({ commit: {} });
      }
    }

    if (rest === "/labels" && method === "POST") {
      const name = String(body.name ?? "");
      if (!name) return j({ message: "Validation Failed" }, 422);
      if (s.labels.has(name.toLowerCase())) return j({ message: "Validation Failed", errors: [{ code: "already_exists" }] }, 422);
      s.labels.add(name.toLowerCase());
      return j({ name }, 201);
    }

    if (rest === "/issues" && method === "GET") {
      const want = (url.searchParams.get("labels") ?? "").split(",").filter(Boolean);
      const state = url.searchParams.get("state") ?? "open";
      const per = Number(url.searchParams.get("per_page") ?? 30);
      const page = Number(url.searchParams.get("page") ?? 1);
      const all = s.issues.filter(
        (i) => !s.unlisted.has(i.number) && (state === "all" || i.state === state) && want.every((w) => i.labels.some((l) => l.name === w)),
      );
      return j(all.slice((page - 1) * per, page * per));
    }
    if (rest === "/issues" && method === "POST") {
      const labels = Array.isArray(body.labels) ? (body.labels as string[]) : [];
      for (const l of labels) if (!s.labels.has(l.toLowerCase())) s.labels.add(l.toLowerCase()); // GitHub creates unknown labels
      const number = s.issues.length + 1;
      const issue: FakeIssue = {
        number,
        title: String(body.title ?? ""),
        body: String(body.body ?? ""),
        state: "open",
        labels: labels.map((name) => ({ name })),
        html_url: `https://github.com/${repo}/issues/${number}`,
      };
      s.issues.push(issue);
      return j(issue, 201);
    }
    r = /^\/issues\/(\d+)$/.exec(rest);
    if (r) {
      const issue = s.issues.find((i) => i.number === Number(r[1]));
      if (!issue) return j({ message: "Not Found" }, 404);
      if (method === "GET") return j(issue);
      if (method === "PATCH") {
        if (typeof body.title === "string") issue.title = body.title;
        if (typeof body.body === "string") issue.body = body.body;
        if (body.state === "open" || body.state === "closed") issue.state = body.state;
        if (Array.isArray(body.labels)) issue.labels = (body.labels as string[]).map((name) => ({ name }));
        return j(issue);
      }
    }
    return j({ message: "Not Found" }, 404);
  }

  return { handle, state: s, reset, repo, token, defaultBranch };
}

export type FakeGithub = ReturnType<typeof createFakeGithub>;
