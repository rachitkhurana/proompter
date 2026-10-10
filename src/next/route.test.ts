// @vitest-environment node
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeEntry, makeSession, PNG } from "../core/entry-fixtures.test-util";
import type { Entry } from "../core/entry";
import { parse, parseSession, serialize } from "../core/serialize";
import { createProompterRoute, guardPath, MAX_BODY_BYTES } from "./route";

let cwd: string;
let outside: string;
const route = createProompterRoute({ cwd: () => cwd });
const SID = "2026-10-10_manual-test-pass";
const reviews = () => path.join(cwd, "reviews", SID);

beforeEach(async () => {
  cwd = await fs.mkdtemp(path.join(os.tmpdir(), "proompter-route-"));
  outside = await fs.mkdtemp(path.join(os.tmpdir(), "proompter-outside-"));
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("NEXT_PUBLIC_PROOMPTER", "true");
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await fs.rm(cwd, { recursive: true, force: true });
  await fs.rm(outside, { recursive: true, force: true });
});

const post = (body: unknown, headers: Record<string, string> = {}) =>
  route.POST(
    new Request("http://localhost/api/proompter", {
      method: "POST",
      headers: { "content-type": "application/json", "x-proompter": "1", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
const get = (query = "", headers: Record<string, string> = { "x-proompter": "1" }) =>
  route.GET(new Request(`http://localhost/api/proompter${query}`, { headers }));
const exists = (p: string) => fs.stat(p).then(() => true, () => false);

describe("guards", () => {
  it("answers 404 unless NODE_ENV is development", async () => {
    vi.stubEnv("NODE_ENV", "production");
    expect((await post({ session: makeSession(), entry: makeEntry() })).status).toBe(404);
    expect((await get()).status).toBe(404);
    expect(await exists(path.join(cwd, "reviews"))).toBe(false);
  });

  it("answers 404 unless NEXT_PUBLIC_PROOMPTER is 'true'", async () => {
    for (const v of ["", "false", "1"]) {
      vi.stubEnv("NEXT_PUBLIC_PROOMPTER", v);
      expect((await post({ session: makeSession(), entry: makeEntry() })).status).toBe(404);
      expect((await get()).status).toBe(404);
    }
    expect(await exists(path.join(cwd, "reviews"))).toBe(false);
  });

  it("refuses cross-site requests", async () => {
    const res = await post({ session: makeSession(), entry: makeEntry() }, { "sec-fetch-site": "cross-site" });
    expect(res.status).toBe(403);
  });

  it("refuses an oversized body", async () => {
    const res = await post("x".repeat(MAX_BODY_BYTES + 1));
    expect(res.status).toBe(413);
  });

  it("refuses bodies that are not JSON or have the wrong shape", async () => {
    expect((await post("{nope")).status).toBe(400);
    expect((await post({ session: makeSession() , entry: { n: 1 } })).status).toBe(400);
    expect((await post({ session: { id: "x" }, entry: makeEntry() })).status).toBe(400);
  });
});

describe("path traversal (guardPath)", () => {
  const goodRel = "entries/005-avatar-is-cropped-on-mobile.md";

  it("accepts the three file kinds", async () => {
    for (const rel of ["session.md", goodRel, "assets/005-mobile.png", "assets/005-mobile-full.png"]) {
      expect(await guardPath(cwd, SID, rel)).toBe(path.join(cwd, "reviews", SID, rel));
    }
  });

  it.each([
    ["dot-dot", "../x.md"],
    ["nested dot-dot", "entries/../../x.md"],
    ["entries dot-dot", "entries/../session.md"],
    ["absolute", "/etc/passwd"],
    ["absolute entry", "/entries/005-a.md"],
    ["NUL", "entries/005-a.md\0.png"],
    ["NUL mid", "entries/005-a\0.md"],
    ["backslash", "entries\\005-a.md"],
    ["backslash traversal", "..\\x.md"],
    ["encoded dot-dot", "entries/%2e%2e/x.md"],
    ["encoded slash", "entries%2f005-a.md"],
    ["double encoded", "%252e%252e/x.md"],
    ["wrong folder", "other/005-a.md"],
    ["wrong extension", "entries/005-a.txt"],
    ["uppercase slug", "entries/005-A.md"],
    ["asset unknown viewport", "assets/005-watch.png"],
    ["asset svg", "assets/005-mobile.svg"],
    ["hidden file", "entries/.005-a.md"],
    ["non-string", 42],
  ])("refuses a file path: %s", async (_name, rel) => {
    await expect(guardPath(cwd, SID, rel)).rejects.toThrow();
  });

  it.each([
    "..",
    "../evil",
    "2026-10-10_../x",
    "2026-10-10_a/b",
    "2026-10-10_a\\b",
    "/abs",
    "2026-10-10_a\0",
    "2026-10-10_%2e%2e",
    "2026-10-10_UPPER",
    "",
    "no-date",
  ])("refuses a session id: %j", async (sid) => {
    await expect(guardPath(cwd, sid, "session.md")).rejects.toThrow();
  });

  it("refuses a session folder that is a symlink out of reviews/", async () => {
    await fs.mkdir(path.join(cwd, "reviews"), { recursive: true });
    await fs.symlink(outside, path.join(cwd, "reviews", SID));
    await expect(guardPath(cwd, SID, "session.md")).rejects.toThrow();
    expect((await post({ session: makeSession(), entry: makeEntry() })).status).toBe(400);
    expect(await fs.readdir(outside)).toEqual([]);
  });

  it("refuses an entries/ folder that is a symlink out", async () => {
    await fs.mkdir(reviews(), { recursive: true });
    await fs.symlink(outside, path.join(reviews(), "entries"));
    await expect(guardPath(cwd, SID, goodRel)).rejects.toThrow();
    expect(await fs.readdir(outside)).toEqual([]);
  });

  it("refuses reviews/ itself being a symlink", async () => {
    await fs.symlink(outside, path.join(cwd, "reviews"));
    await expect(guardPath(cwd, SID, "session.md")).rejects.toThrow();
    expect(await fs.readdir(outside)).toEqual([]);
  });

  it("refuses a target file that is a symlink", async () => {
    await fs.mkdir(path.join(reviews(), "entries"), { recursive: true });
    const victim = path.join(outside, "victim.md");
    await fs.writeFile(victim, "keep");
    await fs.symlink(victim, path.join(reviews(), goodRel));
    await expect(guardPath(cwd, SID, goodRel)).rejects.toThrow();
    expect(await fs.readFile(victim, "utf8")).toBe("keep");
  });

  it("a POST with a hostile session id writes nothing", async () => {
    const res = await post({ session: makeSession({ id: "../../evil" }), entry: makeEntry({ session: "../../evil" }) });
    expect(res.status).toBe(400);
    expect(await exists(path.join(cwd, "reviews"))).toBe(false);
  });
});

describe("PNG validation", () => {
  const withImage = (element: string | undefined, viewport?: string): Entry => {
    const e = makeEntry();
    return { ...e, snapshot: { ...e.snapshot, element, ...(viewport !== undefined ? { viewport } : {}) } };
  };
  const send = (e: Entry) => post({ session: makeSession(), entry: e });

  it("rejects a non-PNG mime, bad base64 and wrong magic bytes, and writes nothing", async () => {
    const bad = [
      "data:image/jpeg;base64,/9j/4AAQSkZJRg==",
      "data:image/png;base64,@@@@",
      `data:image/png;base64,${Buffer.from("not a png at all").toString("base64")}`,
      "https://example.com/a.png",
    ];
    for (const url of bad) expect((await send(withImage(url))).status).toBe(400);
    expect((await send(withImage(PNG, bad[0]))).status).toBe(400);
    expect(await exists(path.join(reviews(), "entries"))).toBe(false);
  });

  it("writes real PNGs under assets/ with names derived from the entry, not the client", async () => {
    const e = withImage(PNG, PNG);
    e.snapshot = { ...e.snapshot, assets: { element: "../../evil.png", viewport: "x.png" } };
    const res = await send(e);
    expect(res.status).toBe(200);
    const bytes = await fs.readFile(path.join(reviews(), "assets", "005-mobile.png"));
    expect([...bytes.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(await exists(path.join(reviews(), "assets", "005-mobile-full.png"))).toBe(true);
    const md = await fs.readFile(path.join(reviews(), "entries", "005-avatar-is-cropped-on-mobile.md"), "utf8");
    expect(md).toContain("![mobile](../assets/005-mobile.png)");
  });
});

describe("write, update, rename", () => {
  it("writes session.md, the entry file and assets, and they parse back", async () => {
    const session = makeSession();
    const entry = makeEntry();
    const res = await post({ session, entry });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; files: string[] };
    expect(body.files.sort()).toEqual(
      ["assets/005-mobile-full.png", "assets/005-mobile.png", "entries/005-avatar-is-cropped-on-mobile.md", "session.md"].sort(),
    );
    const md = await fs.readFile(path.join(reviews(), "entries", "005-avatar-is-cropped-on-mobile.md"), "utf8");
    expect(md).toBe(serialize(entry, session));
    expect(parse(md).title).toBe("Avatar is cropped on mobile");
    const idx = parseSession(await fs.readFile(path.join(reviews(), "session.md"), "utf8"));
    expect(idx.session.id).toBe(SID);
    expect(idx.entries.map((i) => i.id)).toEqual(["PRO-5"]);
    expect((await fs.readdir(path.join(reviews(), "entries"))).filter((n) => n.endsWith(".tmp"))).toEqual([]);
  });

  it("is idempotent: a second identical POST changes nothing", async () => {
    const payload = { session: makeSession(), entry: makeEntry() };
    await post(payload);
    const file = path.join(reviews(), "entries", "005-avatar-is-cropped-on-mobile.md");
    const before = (await fs.stat(file)).mtimeMs;
    const res = await post(payload);
    expect(((await res.json()) as { files: string[] }).files).toEqual([]);
    expect((await fs.stat(file)).mtimeMs).toBe(before);
  });

  it("updates an entry in place and keeps the index in step", async () => {
    await post({ session: makeSession(), entry: makeEntry() });
    await post({ session: makeSession(), entry: makeEntry({ status: "resolved" }) });
    const md = await fs.readFile(path.join(reviews(), "entries", "005-avatar-is-cropped-on-mobile.md"), "utf8");
    expect(parse(md).status).toBe("resolved");
    expect(await fs.readFile(path.join(reviews(), "session.md"), "utf8")).toContain("PRO-5 · resolved");
  });

  it("a renamed title moves the file: the old NNN-*.md is gone, the link and index follow", async () => {
    await post({ session: makeSession(), entry: makeEntry() });
    await post({ session: makeSession(), entry: makeEntry({ title: "Avatar is clipped" }) });
    expect((await fs.readdir(path.join(reviews(), "entries"))).sort()).toEqual(["005-avatar-is-clipped.md"]);
    const md = await fs.readFile(path.join(reviews(), "entries", "005-avatar-is-clipped.md"), "utf8");
    expect(md).toContain("![mobile](../assets/005-mobile.png)");
    const idx = parseSession(await fs.readFile(path.join(reviews(), "session.md"), "utf8"));
    expect(idx.entries.map((i) => i.file)).toEqual(["entries/005-avatar-is-clipped.md"]);
  });

  it("does not delete other entries when one is renamed, and accepts a batch", async () => {
    const one = makeEntry({ id: "PRO-1", n: 1, title: "First" });
    const two = makeEntry({ id: "PRO-2", n: 2, title: "Second" });
    expect((await post({ session: makeSession(), entries: [one, two] })).status).toBe(200);
    await post({ session: makeSession(), entry: { ...one, title: "First renamed" } });
    expect((await fs.readdir(path.join(reviews(), "entries"))).sort()).toEqual(["001-first-renamed.md", "002-second.md"]);
    const idx = parseSession(await fs.readFile(path.join(reviews(), "session.md"), "utf8"));
    expect(idx.entries.map((i) => i.n)).toEqual([1, 2]);
  });
});

describe("GET (rehydrate)", () => {
  it("lists sessions with parsed entries, raw markdown and assets", async () => {
    await post({ session: makeSession(), entry: makeEntry() });
    await post({ session: makeSession({ id: "2026-10-11_other", title: "Other" }), entry: makeEntry({ session: "2026-10-11_other" }) });
    const all = (await (await get()).json()) as { sessions: { session: { id: string }; assets: string[]; entries: { path: string; markdown: string; entry: Entry }[] }[] };
    expect(all.sessions.map((s) => s.session.id).sort()).toEqual([SID, "2026-10-11_other"]);

    const one = (await (await get(`?session=${SID}`)).json()) as typeof all;
    expect(one.sessions).toHaveLength(1);
    const s = one.sessions[0]!;
    expect(s.assets.sort()).toEqual(["005-mobile-full.png", "005-mobile.png"]);
    const f = s.entries[0]!;
    expect(f.path).toBe("entries/005-avatar-is-cropped-on-mobile.md");
    expect(f.entry).toEqual(parse(f.markdown));
    expect(f.entry.id).toBe("PRO-5");
    expect(f.entry.status).toBe("open");
  });

  it("is empty with no reviews/ folder, and skips junk and symlinked folders", async () => {
    expect(await (await get()).json()).toEqual({ ok: true, sessions: [] });
    await fs.mkdir(path.join(cwd, "reviews", "not-a-session"), { recursive: true });
    await fs.symlink(outside, path.join(cwd, "reviews", "2026-10-12_linked"));
    expect(await (await get()).json()).toEqual({ ok: true, sessions: [] });
  });
});

// ---------------------------------------------------------------------------------------------------------
// Hardening

const URL_OK = "http://localhost:3000/api/proompter";
const body = () => JSON.stringify({ session: makeSession(), entry: makeEntry() });
const reviewsExists = () => exists(path.join(cwd, "reviews"));

describe("request guards (CSRF, DNS rebinding, preflight)", () => {
  const send = (method: "GET" | "POST", url: string, headers: Record<string, string>) =>
    (method === "POST"
      ? route.POST(new Request(url, { method, headers, body: body() }))
      : route.GET(new Request(url, { method, headers }))
    );
  const ok = { "content-type": "application/json", "x-proompter": "1" };

  it("accepts loopback hosts with any port", async () => {
    for (const u of ["http://localhost/api/proompter", "http://127.0.0.1:3001/api/proompter", "http://[::1]:3000/api/proompter"]) {
      expect((await send("POST", u, ok)).status).toBe(200);
      expect((await send("GET", u, ok)).status).toBe(200);
    }
  });

  it("text/plain without Sec-Fetch-Site (a no-preflight cross-site form post) gets 415 and writes nothing", async () => {
    const res = await send("POST", URL_OK, { "content-type": "text/plain", "x-proompter": "1" });
    expect(res.status).toBe(415);
    expect((await send("POST", URL_OK, { "x-proompter": "1" })).status).toBe(415);
    expect(await reviewsExists()).toBe(false);
  });

  it("refuses a hostile Host (DNS rebinding) on POST and GET", async () => {
    for (const m of ["POST", "GET"] as const) {
      expect((await send(m, "http://evil.example.com/api/proompter", ok)).status).toBe(403);
      expect((await send(m, "http://localhost.evil.com/api/proompter", ok)).status).toBe(403);
      expect((await send(m, "http://192.168.1.5:3000/api/proompter", ok)).status).toBe(403);
    }
    expect(await reviewsExists()).toBe(false);
  });

  it("refuses a hostile Host header even when the URL says localhost", async () => {
    // Some runtimes drop a forged Host header; when it is kept it must be checked too.
    const req = new Request(URL_OK, { method: "POST", headers: { ...ok, host: "evil.example.com" }, body: body() });
    if (req.headers.get("host") === "evil.example.com") expect((await route.POST(req)).status).toBe(403);
  });

  it("refuses a foreign Origin and cross-site / same-site Sec-Fetch-Site", async () => {
    for (const m of ["POST", "GET"] as const) {
      expect((await send(m, URL_OK, { ...ok, origin: "https://evil.example.com" })).status).toBe(403);
      expect((await send(m, URL_OK, { ...ok, origin: "http://localhost:4000" })).status).toBe(403);
      expect((await send(m, URL_OK, { ...ok, "sec-fetch-site": "cross-site" })).status).toBe(403);
      expect((await send(m, URL_OK, { ...ok, "sec-fetch-site": "same-site" })).status).toBe(403);
      expect((await send(m, URL_OK, { ...ok, "sec-fetch-site": "same-origin", origin: "http://localhost:3000" })).status).toBe(200);
    }
  });

  it("a cross-site GET cannot read the sessions", async () => {
    await post({ session: makeSession(), entry: makeEntry() });
    const res = await route.GET(new Request(URL_OK, { headers: { "sec-fetch-site": "cross-site" } }));
    expect(res.status).toBe(403);
    expect(await res.text()).not.toContain("Avatar");
  });

  it("requires the x-proompter header on POST and GET", async () => {
    expect((await send("POST", URL_OK, { "content-type": "application/json" })).status).toBe(403);
    expect((await send("GET", URL_OK, {})).status).toBe(403);
    expect((await send("POST", URL_OK, { "content-type": "application/json", "x-proompter": "0" })).status).toBe(403);
    expect(await reviewsExists()).toBe(false);
  });

  it("allowedHosts lets a named host through", async () => {
    const custom = createProompterRoute({ cwd: () => cwd, allowedHosts: ["dev.example.test"] });
    const url = "http://dev.example.test:3000/api/proompter";
    expect((await custom.GET(new Request(url, { headers: ok }))).status).toBe(200);
    expect((await route.GET(new Request(url, { headers: ok }))).status).toBe(403);
  });
});

describe("body size is counted in bytes while streaming", () => {
  const stream = (chunk: Uint8Array, count: number) => {
    let sent = 0;
    return new ReadableStream<Uint8Array>({
      pull(c) {
        if (sent++ < count) c.enqueue(chunk);
        else c.close();
      },
    });
  };
  const streamed = (s: ReadableStream<Uint8Array>) =>
    route.POST(
      new Request(URL_OK, {
        method: "POST",
        headers: { "content-type": "application/json", "x-proompter": "1" },
        body: s,
        duplex: "half",
      } as RequestInit),
    );

  it("refuses a chunked body without Content-Length once it passes the cap", async () => {
    const mb = new Uint8Array(1024 * 1024).fill(120);
    expect((await streamed(stream(mb, 25))).status).toBe(413);
  });

  it("counts bytes, not characters (multi-byte text)", async () => {
    const e = Buffer.from("é".repeat(512 * 1024)); // 1 MiB of bytes, 512 Ki characters
    expect(e.length).toBe(1024 * 1024);
    expect((await streamed(stream(new Uint8Array(e), 21))).status).toBe(413);
    const asString = await post("é".repeat(MAX_BODY_BYTES / 2 + 1));
    expect(asString.status).toBe(413);
  });

  it("still accepts a normal streamed body", async () => {
    const bytes = new TextEncoder().encode(body());
    expect((await streamed(stream(bytes, 1))).status).toBe(200);
  });
});

describe("field validation (frontmatter injection)", () => {
  const bad = (over: Record<string, unknown>) => post({ session: makeSession(), entry: { ...makeEntry(), ...over } });

  it("rejects a kind that is not one of the enum values, and writes nothing", async () => {
    expect((await bad({ kind: "point\nstatus: resolved" })).status).toBe(400);
    expect((await bad({ kind: "pin" })).status).toBe(400);
    expect(await reviewsExists()).toBe(false); // validation runs before anything touches the disk
  });

  it.each([
    ["status", { status: "done\nkind: x" }],
    ["intent", { intent: "other" }],
    ["priority", { priority: 3 }],
    ["size", { size: { width: "390", height: 844 } }],
    ["size NaN", { size: { width: null, height: 1 } }],
    ["targets", { targets: [{ selector: 1 }] }],
    ["targets not array", { targets: "x" }],
    ["tags", { tags: "ui" }],
    ["tags item", { tags: [1] }],
    ["created", { created: 5 }],
    ["route", { route: { a: 1 } }],
    ["issue", { issue: 7 }],
    ["context", { context: null }],
    ["context arrays", { context: { console: "x", network: [], queries: [] } }],
    ["snapshot", { snapshot: "x" }],
    ["snapshot element", { snapshot: { element: 5 } }],
    ["activity", { activity: [{ at: 1 }] }],
    ["rotated", { rotated: "no" }],
    ["testPlan", { testPlan: 1 }],
  ])("rejects a bad %s with 400", async (_n, over) => {
    expect((await bad(over)).status).toBe(400);
    expect(await exists(path.join(reviews(), "entries", "005-avatar-is-cropped-on-mobile.md"))).toBe(false);
  });
});

describe("serialised writes per session", () => {
  it("30 rounds of concurrent renames of the same entry always leave exactly one file", async () => {
    for (let round = 1; round <= 30; round++) {
      const a = makeEntry({ id: `PRO-${round}`, n: round, title: `Title A ${round}` });
      const b = makeEntry({ id: `PRO-${round}`, n: round, title: `Title B ${round}` });
      const rs = await Promise.all([
        post({ session: makeSession(), entry: a }),
        post({ session: makeSession(), entry: b }),
        post({ session: makeSession(), entry: { ...a, title: `Title C ${round}` } }),
      ]);
      expect(rs.map((r) => r.status)).toEqual([200, 200, 200]);
      const names = (await fs.readdir(path.join(reviews(), "entries"))).filter((n) => n.startsWith(`${String(round).padStart(3, "0")}-`));
      expect(names).toHaveLength(1);
    }
    const idx = parseSession(await fs.readFile(path.join(reviews(), "session.md"), "utf8"));
    expect(idx.entries).toHaveLength(30);
  });
});

describe("assets and reads", () => {
  it("deletes an orphaned element crop when the entry no longer has one", async () => {
    await post({ session: makeSession(), entry: makeEntry() });
    const png = path.join(reviews(), "assets", "005-mobile.png");
    expect(await exists(png)).toBe(true);
    const res = await post({ session: makeSession(), entry: makeEntry({ snapshot: undefined }) });
    expect(res.status).toBe(200);
    expect(await exists(png)).toBe(false);
    const md = await fs.readFile(path.join(reviews(), "entries", "005-avatar-is-cropped-on-mobile.md"), "utf8");
    expect(md).not.toContain("![");
  });

  it("keeps assets that are already on disk when the client sends only their names", async () => {
    await post({ session: makeSession(), entry: makeEntry() });
    const e = makeEntry();
    const res = await post({ session: makeSession(), entry: { ...e, snapshot: { assets: e.snapshot?.assets } } });
    expect(res.status).toBe(200);
    expect(await exists(path.join(reviews(), "assets", "005-mobile.png"))).toBe(true);
  });

  it("GET skips symlinked entry files", async () => {
    await post({ session: makeSession(), entry: makeEntry() });
    const real = path.join(reviews(), "entries", "005-avatar-is-cropped-on-mobile.md");
    await fs.copyFile(real, path.join(outside, "x.md"));
    await fs.symlink(path.join(outside, "x.md"), path.join(reviews(), "entries", "006-linked.md"));
    const r = (await (await get()).json()) as { sessions: { entries: { path: string }[] }[] };
    expect(r.sessions[0]?.entries.map((e) => e.path)).toEqual(["entries/005-avatar-is-cropped-on-mobile.md"]);
  });
});
