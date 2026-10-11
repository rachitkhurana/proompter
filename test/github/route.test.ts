// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import { makeEntry, makeSession, PNG } from "../../src/core/entry-fixtures.test-util";
import { parse, parseSession, serializeSession } from "../../src/core/serialize";
import { createGithubRoute } from "../../src/github";
import { MAX_BODY_BYTES } from "../../src/server/validate";
import { createFakeGithub } from "./fake";

const KEY = "review-key-1234567890";
const TOKEN = "ghp_faketoken";
const SID = "2026-10-10_manual-test-pass";
const URL_ = "https://preview.example.com/api/proompter/github";

let fake: ReturnType<typeof createFakeGithub>;
let route: ReturnType<typeof createGithubRoute>;
const mk = (extra: Partial<Parameters<typeof createGithubRoute>[0]> = {}) =>
  createGithubRoute({
    repo: "acme/reviews",
    token: TOKEN,
    reviewKey: KEY,
    api: "https://api.github.test",
    fetch: (input, init) => fake.handle(new Request(input as string, init)),
    ...extra,
  });
beforeEach(() => {
  fake = createFakeGithub({ repo: "acme/reviews", token: TOKEN });
  route = mk();
});

const headers = (over: Record<string, string> = {}) => ({
  "content-type": "application/json",
  "x-proompter": "1",
  authorization: `Bearer ${KEY}`,
  ...over,
});
const post = (body: unknown, over: Record<string, string> = {}, r = route, url = URL_) =>
  r.POST(new Request(url, { method: "POST", headers: headers(over), body: typeof body === "string" ? body : JSON.stringify(body) }));
const get = (query = `?session=${SID}`, over: Record<string, string> = {}, r = route) =>
  r.GET(new Request(`${URL_}${query}`, { headers: headers(over) }));
const sync = async (entry = makeEntry(), session = makeSession()) => {
  const res = await post({ session, entry });
  return { res, body: (await res.json()) as { ok: boolean; issue: string; state: string; url: string; files: string[] } };
};
const file = (p: string, branch = "reviews") => fake.state.branches.get(branch)?.get(p);
const base = `reviews/${SID}`;

describe("guards", () => {
  it("404 without the token or the review key", async () => {
    expect((await post({}, {}, mk({ token: "" }))).status).toBe(404);
    expect((await get("", {}, mk({ reviewKey: "" }))).status).toBe(404);
    expect(fake.state.log).toEqual([]);
  });
  it("a review key shorter than 16 characters is treated as unset (404)", async () => {
    const short = mk({ reviewKey: "short-key-15chr" });
    expect((await post({}, { authorization: "Bearer short-key-15chr" }, short)).status).toBe(404);
    expect((await get("", {}, short)).status).toBe(404);
    expect((await get("?session=" + SID, {}, mk({ reviewKey: "x".repeat(16) }))).status).toBe(401);
    expect(fake.state.log).toEqual([]);
  });
  it("PROOMPTER_ALLOWED_HOSTS is honoured when allowedHosts is given, like the dev route", async () => {
    const strict = mk({ allowedHosts: [] });
    expect((await post({ session: makeSession(), entry: makeEntry() }, {}, strict)).status).toBe(403);
    process.env.PROOMPTER_ALLOWED_HOSTS = "preview.example.com";
    try {
      expect((await post({ session: makeSession(), entry: makeEntry() }, {}, strict)).status).toBe(200);
    } finally {
      delete process.env.PROOMPTER_ALLOWED_HOSTS;
    }
  });
  it("reads both from the environment", async () => {
    process.env.PROOMPTER_GITHUB_TOKEN = TOKEN;
    process.env.PROOMPTER_REVIEW_KEY = KEY;
    try {
      const r = createGithubRoute({ repo: "acme/reviews", api: "https://api.github.test", fetch: (i, n) => fake.handle(new Request(i as string, n)) });
      expect((await get("", {}, r)).status).toBe(400); // past the guards, no session given
    } finally {
      delete process.env.PROOMPTER_GITHUB_TOKEN;
      delete process.env.PROOMPTER_REVIEW_KEY;
    }
  });
  it("401 for a missing or wrong key, and calls GitHub never", async () => {
    for (const authorization of ["", "Bearer nope", "Bearer", `Basic ${KEY}`, `Bearer ${KEY}x`]) {
      expect((await post({ session: makeSession(), entry: makeEntry() }, { authorization })).status).toBe(401);
      expect((await get(undefined, { authorization })).status).toBe(401);
    }
    expect(fake.state.log).toEqual([]);
  });
  it("403 for cross-site, a foreign origin and a missing x-proompter header", async () => {
    const b = { session: makeSession(), entry: makeEntry() };
    expect((await post(b, { "sec-fetch-site": "cross-site" })).status).toBe(403);
    expect((await post(b, { origin: "https://evil.example" })).status).toBe(403);
    expect((await post(b, { "x-proompter": "0" })).status).toBe(403);
    expect((await get(undefined, { "x-proompter": "" })).status).toBe(403);
    expect(fake.state.log).toEqual([]);
  });
  it("allows a non-loopback host unless allowedHosts is given", async () => {
    expect((await sync()).res.status).toBe(200);
    const strict = mk({ allowedHosts: ["other.example.com"] });
    expect((await post({ session: makeSession(), entry: makeEntry() }, {}, strict)).status).toBe(403);
    const ok = mk({ allowedHosts: ["preview.example.com"] });
    expect((await post({ session: makeSession(), entry: makeEntry() }, {}, ok)).status).toBe(200);
  });
  it("415 for a non-JSON body, 400 for bad JSON, bad entry and missing entry", async () => {
    expect((await post("x", { "content-type": "text/plain" })).status).toBe(415);
    expect((await post("{nope")).status).toBe(400);
    expect((await post({ session: makeSession() })).status).toBe(400);
    const bad = await post({ session: makeSession(), entry: makeEntry({ priority: "point\nstatus: resolved" as never }) });
    expect(bad.status).toBe(400);
    expect(fake.state.log).toEqual([]);
  });
  it("413 over the 20 MB cap", async () => {
    const res = await post("x".repeat(MAX_BODY_BYTES + 1));
    expect(res.status).toBe(413);
    expect(fake.state.log).toEqual([]);
  });
  it("refuses a non-PNG image before touching GitHub", async () => {
    const e = makeEntry({ snapshot: { element: "data:image/png;base64,AAAA", assets: {} } });
    expect((await post({ session: makeSession(), entry: e })).status).toBe(400);
    expect(fake.state.log).toEqual([]);
  });
  it("never puts the token in a response, also when GitHub rejects it", async () => {
    const bad = mk({ token: "ghp_wrong" });
    const res = await post({ session: makeSession(), entry: makeEntry() }, {}, bad);
    expect(res.status).toBe(502);
    expect(await res.text()).not.toContain("ghp_");
    const ok = await sync();
    expect(JSON.stringify(ok.body)).not.toContain(TOKEN);
  });
});

describe("POST", () => {
  it("creates the branch from the default branch and writes the files", async () => {
    const { res, body } = await sync();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(fake.state.branches.has("reviews")).toBe(true);
    expect(file("README.md")).toBeDefined(); // came from the default branch
    expect(body.files.sort()).toEqual(["assets/005-mobile-full.png", "assets/005-mobile.png", "entries/005-avatar-is-cropped-on-mobile.md", "session.md"]);
    const md = file(`${base}/entries/005-avatar-is-cropped-on-mobile.md`)?.toString("utf8") ?? "";
    expect(parse(md).issue).toBe(body.issue);
    expect(file(`${base}/assets/005-mobile.png`)?.subarray(0, 4).toString("hex")).toBe("89504e47");
    const idx = parseSession(file(`${base}/session.md`)?.toString("utf8") ?? "");
    expect(idx.entries.map((e) => e.id)).toEqual(["PRO-5"]);
    expect(fake.state.branches.get("main")?.size).toBe(1); // default branch untouched
  });

  it("creates the issue with title, labels, ref and a snapshot link", async () => {
    const { body } = await sync();
    expect(body).toMatchObject({ issue: "1", state: "open", url: "https://github.com/acme/reviews/issues/1" });
    const issue = fake.state.issues[0]!;
    expect(issue.title).toBe("PRO-5: Avatar is cropped on mobile");
    expect(issue.labels.map((l) => l.name)).toEqual(["proompter", "kind:element", "priority:important"]);
    expect(issue.body).toContain(`ref: ${SID}/PRO-5`);
    expect(issue.body).toContain(`![snapshot](https://github.com/acme/reviews/blob/reviews/${base}/assets/005-mobile.png?raw=true)`);
    expect([...fake.state.labels].sort()).toEqual(["kind:element", "priority:important", "proompter"]);
  });

  it("an unchanged entry rewrites nothing and creates no second issue", async () => {
    const first = await sync();
    const writes = fake.state.writes;
    const again = await sync(makeEntry({ issue: first.body.issue }));
    expect(again.body.files).toEqual([]);
    expect(fake.state.writes).toBe(writes);
    expect(fake.state.issues).toHaveLength(1);
    expect(fake.state.log.filter((l) => l.startsWith("PATCH"))).toEqual([]);
  });

  it("a lost issue number does not create a duplicate (found by ref)", async () => {
    await sync();
    await sync(makeEntry({ issue: null }));
    expect(fake.state.issues).toHaveLength(1);
  });

  it("a client-supplied issue number cannot touch another issue", async () => {
    fake.state.issues.push({ number: 1, title: "someone else's", body: "mine", state: "open", labels: [], html_url: "x" });
    const { body } = await sync(makeEntry({ issue: "1" }));
    expect(body.issue).toBe("2");
    expect(fake.state.issues[0]).toMatchObject({ title: "someone else's", body: "mine", state: "open" });
  });

  it("a re-sync while GitHub's listing still lags finds the issue by its number, not a second create", async () => {
    const first = await sync();
    fake.state.unlisted.add(Number(first.body.issue)); // live: the label listing missed a seconds-old issue
    const again = await sync(makeEntry({ issue: first.body.issue, status: "resolved" }));
    expect(again.body).toMatchObject({ issue: first.body.issue, state: "closed" });
    expect(fake.state.issues).toHaveLength(1);
  });

  it("another review with the same session id is refused (409) before any issue or file is touched", async () => {
    const first = await sync();
    const writes = fake.state.writes;
    const before = JSON.stringify(fake.state.issues);
    // A second browser, same day and title: same id, its own start time, its own PRO-5.
    const other = makeSession({ started: "2026-10-10T18:00:00Z" });
    const res = await post({ session: other, entry: makeEntry({ title: "Someone else's note" }) });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toMatch(/belongs to another review/);
    expect(fake.state.writes).toBe(writes);
    expect(JSON.stringify(fake.state.issues)).toBe(before);
    expect(fake.state.log.filter((l) => l.startsWith("PATCH") || l.startsWith("POST /repos/acme/reviews/issues"))).toHaveLength(1);
    // The same review (same `started`) still syncs.
    expect((await sync(makeEntry({ issue: first.body.issue, status: "resolved" }))).res.status).toBe(200);
  });

  it("a new session claims its folder first: session.md is created before any issue", async () => {
    await sync();
    const order = fake.state.log.filter((l) => l.startsWith("PUT") || l.startsWith("POST /repos/acme/reviews/issues"));
    expect(order[0]).toBe(`PUT /repos/acme/reviews/contents/${base}/session.md`);
    expect(order[1]).toBe("POST /repos/acme/reviews/issues");
  });

  it("two reviews racing for one new id (another server instance): the loser is refused, nothing of it written", async () => {
    let raced = false;
    const racing = mk({
      fetch: async (input, init) => {
        const req = new Request(input as string, init);
        // Between our read (no session.md) and our create, another instance creates it for another review.
        if (!raced && req.method === "PUT" && req.url.endsWith(`${base}/session.md`)) {
          raced = true;
          const other = await fake.handle(new Request(req.url, { method: "PUT", headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" }, body: JSON.stringify({ branch: "reviews", content: Buffer.from(serializeSession(makeSession({ started: "2026-10-10T18:00:00Z", reviewer: "other" }), [])).toString("base64") }) }));
          expect(other.status).toBe(201);
        }
        return fake.handle(req);
      },
    });
    const res = await post({ session: makeSession(), entry: makeEntry() }, {}, racing);
    expect(res.status).toBe(409);
    expect(fake.state.issues).toEqual([]);
    expect([...(fake.state.branches.get("reviews")?.keys() ?? [])].filter((f) => f.startsWith(base))).toEqual([`${base}/session.md`]);
  });

  it("a `started` that does not parse is a 400; a stored one that does not parse locks nothing", async () => {
    expect((await post({ session: makeSession({ started: "yesterday" }), entry: makeEntry() })).status).toBe(400);
    expect(fake.state.writes).toBe(0);
    await sync();
    const md = file(`${base}/session.md`)!.toString("utf8").replace(/^started: .*$/m, 'started: "sometime"');
    fake.state.branches.get("reviews")!.set(`${base}/session.md`, Buffer.from(md));
    expect((await sync(makeEntry({ title: "Edited" }))).res.status).toBe(200);
  });

  it("an issue number that is gone or is a pull request falls back to the listing", async () => {
    const first = await sync();
    fake.state.issues.push({ number: 2, title: "pr", body: `ref: ${SID}/PRO-5`, state: "open", labels: [{ name: "proompter" }], html_url: "x", pull_request: {} });
    for (const issue of ["2", "404"]) {
      const { body } = await sync(makeEntry({ issue, title: `Via ${issue}` }));
      expect(body.issue).toBe(first.body.issue);
    }
    expect(fake.state.issues).toHaveLength(2);
  });

  it("a client-supplied number for another entry's proompter issue is ignored", async () => {
    fake.state.issues.push({ number: 1, title: "PRO-9", body: `ref: ${SID}/PRO-9`, state: "open", labels: [{ name: "proompter" }], html_url: "x" });
    const { body } = await sync(makeEntry({ issue: "1", status: "resolved" }));
    expect(body.issue).toBe("2");
    expect(fake.state.issues[0]).toMatchObject({ title: "PRO-9", state: "open" });
  });

  it("sends the images only when given, and keeps the existing ones", async () => {
    await sync();
    const slim = makeEntry({ snapshot: { assets: { element: "005-mobile.png", viewport: "005-mobile-full.png" } } as never });
    const { body } = await sync(slim);
    expect(body.files).toEqual([]);
    expect(file(`${base}/assets/005-mobile.png`)).toBeDefined();
  });

  it("a title change deletes the old file and updates the issue", async () => {
    await sync();
    const { body } = await sync(makeEntry({ title: "Avatar is clipped" }));
    expect(body.files).toContain("entries/005-avatar-is-clipped.md");
    expect(body.files).toContain("entries/005-avatar-is-cropped-on-mobile.md");
    expect(file(`${base}/entries/005-avatar-is-cropped-on-mobile.md`)).toBeUndefined();
    expect(file(`${base}/entries/005-avatar-is-clipped.md`)).toBeDefined();
    const idx = parseSession(file(`${base}/session.md`)?.toString("utf8") ?? "");
    expect(idx.entries).toHaveLength(1);
    expect(idx.entries[0]?.title).toBe("Avatar is clipped");
    expect(fake.state.issues[0]?.title).toBe("PRO-5: Avatar is clipped");
  });

  it("resolved closes the issue, open again reopens it, labels follow priority", async () => {
    await sync();
    expect((await sync(makeEntry({ status: "resolved" }))).body.state).toBe("closed");
    expect(fake.state.issues[0]?.state).toBe("closed");
    const re = await sync(makeEntry({ status: "open", priority: "blocking" }));
    expect(re.body.state).toBe("open");
    expect(fake.state.issues[0]?.labels.map((l) => l.name)).toEqual(["proompter", "kind:element", "priority:blocking"]);
    expect(fake.state.labels.has("priority:blocking")).toBe(true);
  });

  it("an entry that is resolved when first synced is created closed", async () => {
    expect((await sync(makeEntry({ status: "resolved" }))).body.state).toBe("closed");
  });

  it("neutralises @mentions in the issue title and body, but not in the branch files", async () => {
    const e = makeEntry({ title: "Ask @octocat", description: "cc @acme/core-team and @octocat" });
    await sync(e);
    const issue = fake.state.issues[0]!;
    for (const text of [issue.title, issue.body]) {
      expect(text).not.toContain("@octocat");
      expect(text).not.toContain("@acme/core-team");
    }
    expect(issue.title).toContain("@\u200boctocat");
    expect(issue.body).toContain("@\u200bacme/core-team");
    const md = file(`${base}/entries/005-ask-octocat.md`)?.toString("utf8") ?? "";
    expect(md).toContain("cc @acme/core-team and @octocat");
  });

  it("deletes an element crop the entry no longer links", async () => {
    await sync();
    expect(file(`${base}/assets/005-mobile.png`)).toBeDefined();
    const { body } = await sync(makeEntry({ snapshot: { viewport: PNG, assets: {} } as never }));
    expect(body.files).toContain("assets/005-mobile.png");
    expect(file(`${base}/assets/005-mobile.png`)).toBeUndefined();
    expect(file(`${base}/assets/005-mobile-full.png`)).toBeDefined();
  });

  it("retries a 409 on DELETE once", async () => {
    await sync();
    const real = fake.handle;
    let hit = false;
    const flaky = mk({
      fetch: async (input, init) => {
        const req = new Request(input as string, init);
        if (!hit && req.method === "DELETE") {
          hit = true;
          // the old file changes between our listing and our delete: its sha is now stale
          fake.state.branches.get("reviews")?.set(`${base}/entries/005-avatar-is-cropped-on-mobile.md`, Buffer.from("changed elsewhere"));
        }
        return real(req);
      },
    });
    const res = await post({ session: makeSession(), entry: makeEntry({ title: "Renamed for delete" }) }, {}, flaky);
    expect(res.status).toBe(200);
    expect(hit).toBe(true);
    expect(file(`${base}/entries/005-avatar-is-cropped-on-mobile.md`)).toBeUndefined();
  });

  it("works with a branch name that has a slash", async () => {
    const r = mk({ branch: "feat/reviews" });
    expect((await post({ session: makeSession(), entry: makeEntry() }, {}, r)).status).toBe(200);
    expect(fake.state.branches.has("feat/reviews")).toBe(true);
    expect(file(`${base}/session.md`, "feat/reviews")).toBeDefined();
  });

  it("a 422 creating the branch is fine when it exists now, an error when it still does not", async () => {
    // someone else created it between our GET and our POST
    let raced = false;
    const racy = mk({
      fetch: async (input, init) => {
        const req = new Request(input as string, init);
        if (!raced && req.method === "POST" && req.url.endsWith("/git/refs")) {
          raced = true;
          fake.state.branches.set("reviews", new Map(fake.state.branches.get("main")));
        }
        return fake.handle(req);
      },
    });
    expect((await post({ session: makeSession(), entry: makeEntry() }, {}, racy)).status).toBe(200);

    fake.reset();
    const refuses = mk({
      fetch: async (input, init) => {
        const req = new Request(input as string, init);
        if (req.method === "POST" && req.url.endsWith("/git/refs")) return new Response(JSON.stringify({ message: "Reference name is invalid" }), { status: 422, headers: { "content-type": "application/json" } });
        return fake.handle(req);
      },
    });
    const res = await post({ session: makeSession(), entry: makeEntry() }, {}, refuses);
    expect(res.status).toBe(502);
    expect(((await res.json()) as { error: string }).error).toMatch(/could not create the branch/);
    expect(fake.state.issues).toHaveLength(0);
  });

  it("only lists as many issue pages as it needs to find the entry's issue", async () => {
    for (let n = 1; n <= 250; n++) {
      fake.state.issues.push({ number: n, title: "t", body: `ref: ${SID}/PRO-${n}`, state: "open", labels: [{ name: "proompter" }], html_url: "u" });
    }
    await sync(makeEntry({ id: "PRO-3", n: 3, title: "Third" })); // lives on page 1
    const pages = fake.state.log.filter((l) => l.includes("/issues?labels=proompter"));
    expect(pages).toHaveLength(1);
  });

  it("ignores directories when it lists a folder", async () => {
    fake.state.branches.get("main")?.set(`${base}/entries/sub/x.md`, Buffer.from("x"));
    fake.state.branches.get("main")?.set(`${base}/entries/005-avatar-is-cropped-on-mobile.md`, Buffer.from("old"));
    const { res } = await sync();
    expect(res.status).toBe(200);
  });

  it("two entries of one session keep both in session.md, also when synced at once", async () => {
    const a = makeEntry();
    const b = makeEntry({ id: "PRO-6", n: 6, title: "Second one" });
    const [ra, rb] = await Promise.all([post({ session: makeSession(), entry: a }), post({ session: makeSession(), entry: b })]);
    expect([ra.status, rb.status]).toEqual([200, 200]);
    const idx = parseSession(file(`${base}/session.md`)?.toString("utf8") ?? "");
    expect(idx.entries.map((e) => e.id)).toEqual(["PRO-5", "PRO-6"]);
    expect(fake.state.issues.map((i) => i.number)).toEqual([1, 2]);
  });

  it("retries once when a file changed under it (409)", async () => {
    await sync();
    const real = fake.handle;
    let first = true;
    const flaky = mk({
      fetch: async (input, init) => {
        const req = new Request(input as string, init);
        if (first && req.method === "PUT" && req.url.endsWith("session.md")) {
          first = false;
          // someone else rewrites session.md between our read and our write
          fake.state.branches.get("reviews")?.set(`${base}/session.md`, Buffer.from("changed elsewhere"));
        }
        return real(req);
      },
    });
    const res = await post({ session: makeSession(), entry: makeEntry({ title: "Changed again" }) }, {}, flaky);
    expect(res.status).toBe(200);
  });

  it("answers 502 when GitHub fails, with no token in the body", async () => {
    const down = mk({ fetch: () => Promise.reject(new Error("ghp_faketoken boom")) });
    const res = await post({ session: makeSession(), entry: makeEntry() }, {}, down);
    expect(res.status).toBe(502);
    expect(await res.text()).not.toContain("ghp_");
  });
});

describe("GET", () => {
  it("lists the session's issues with their state", async () => {
    await sync();
    await sync(makeEntry({ id: "PRO-6", n: 6, title: "Other", status: "resolved" }));
    await sync(makeEntry({ session: "2026-10-11_other", id: "PRO-1", n: 1 }), makeSession({ id: "2026-10-11_other" }));
    fake.state.issues.push({ number: 99, title: "pr", body: `ref: ${SID}/PRO-9`, state: "open", labels: [{ name: "proompter" }], html_url: "x", pull_request: {} });
    const res = await get();
    const { issues } = (await res.json()) as { issues: unknown[] };
    expect(issues).toEqual([
      { n: 5, issue: "1", state: "open", url: "https://github.com/acme/reviews/issues/1" },
      { n: 6, issue: "2", state: "closed", url: "https://github.com/acme/reviews/issues/2" },
    ]);
  });
  it("with `started`, answers only the review that owns the session: 409 for another one", async () => {
    await sync();
    const started = makeSession().started;
    expect((await get(`?session=${SID}&started=${encodeURIComponent(started)}`)).status).toBe(200);
    const res = await get(`?session=${SID}&started=${encodeURIComponent("2026-10-10T18:00:00Z")}`);
    expect(res.status).toBe(409);
    expect((await get(`?session=${SID}&started=nope`)).status).toBe(400);
    // A session not on the branch yet is anyone's, and a 0.1.0 client (no `started`) is still answered.
    expect((await get(`?session=2026-10-11_fresh&started=${encodeURIComponent(started)}`)).status).toBe(200);
    expect((await get(`?session=${SID}`)).status).toBe(200);
    // The same instant in another offset is the same review.
    expect((await get(`?session=${SID}&started=${encodeURIComponent(started.replace(/Z$/, "+00:00"))}`)).status).toBe(200);
  });
  it("sees an issue closed on GitHub", async () => {
    await sync();
    fake.state.issues[0]!.state = "closed";
    const { issues } = (await (await get()).json()) as { issues: { state: string }[] };
    expect(issues[0]?.state).toBe("closed");
  });
  it("400 for a bad session id", async () => {
    expect((await get("?session=../x")).status).toBe(400);
    expect((await get("")).status).toBe(400);
  });
  it("reads past one page of issues", async () => {
    for (let n = 1; n <= 120; n++) {
      fake.state.issues.push({ number: n, title: "t", body: `ref: ${SID}/PRO-${n}`, state: "open", labels: [{ name: "proompter" }], html_url: "u" });
    }
    const { issues } = (await (await get()).json()) as { issues: unknown[] };
    expect(issues).toHaveLength(120);
  });
});
