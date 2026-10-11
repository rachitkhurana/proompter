// @vitest-environment node
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { createGithubRoute } from "../../github";
import { createFakeGithub } from "../../../test/github/fake";
import { makeEntry, PNG } from "../entry-fixtures.test-util";
import { createStore, type NewEntry } from "../store";
import { createGithubSink, type GithubSink } from "./github";

const SID = "2026-10-10_manual-test-pass";
const KEY = "review-key-1234567890";
let fake: ReturnType<typeof createFakeGithub>;
let route: ReturnType<typeof createGithubRoute>;
let calls: string[];
let key: string | null;

beforeEach(() => {
  fake = createFakeGithub({ repo: "acme/reviews", token: "ghp_t" });
  route = createGithubRoute({
    repo: "acme/reviews",
    token: "ghp_t",
    reviewKey: KEY,
    api: "https://api.github.test",
    fetch: (i, n) => fake.handle(new Request(i as string, n)),
  });
  calls = [];
  key = KEY;
});

/** A `fetch` that talks to the real route handlers (no network). */
const routeFetch: typeof fetch = async (input, init) => {
  const url = new URL(String(input), "https://preview.example.com");
  const method = init?.method ?? "GET";
  calls.push(`${method} ${url.pathname}`);
  const req = new Request(url, init);
  return method === "POST" ? route.POST(req) : route.GET(req);
};

function draft(over: Partial<NewEntry> = {}): NewEntry {
  const { id: _i, ref: _r, n: _n, session: _s, status: _st, issue: _is, created: _c, updated: _u, activity: _a, ...rest } = makeEntry();
  return { ...rest, title: "Avatar is cropped on mobile", snapshot: { element: PNG, viewport: PNG }, ...over };
}

async function setup(fetchImpl: typeof fetch = routeFetch): Promise<{ store: ReturnType<typeof createStore>; sink: GithubSink }> {
  const store = createStore({ session: { title: "Manual test pass", reviewer: "rachit", id: SID }, idb: null });
  await store.ready;
  const sink = createGithubSink({ endpoint: "/api/proompter/github", store, key: () => key, fetch: fetchImpl });
  return { store, sink };
}
const posts = () => calls.filter((c) => c.startsWith("POST")).length;

describe("github sink", () => {
  it("sends each changed entry once, stores the issue number and links the url", async () => {
    const { store, sink } = await setup();
    const a = await store.create(draft());
    const b = await store.create(draft({ title: "Second" }));
    expect(sink.pending()).toEqual([a.id, b.id]);
    const r = await sink.sync();
    expect(r).toMatchObject({ ok: true, synced: 2, resolved: 0 });
    expect(posts()).toBe(2); // one request per entry
    expect(store.get(a.id)?.issue).toBe("1");
    expect(store.get(b.id)?.issue).toBe("2");
    expect(store.get(a.id)?.activity.at(-1)?.who).toBe("github");
    expect(sink.pending()).toEqual([]);
    expect(sink.urls()[a.id]).toBe("https://github.com/acme/reviews/issues/1");
    expect(fake.state.issues).toHaveLength(2);
    // nothing changed: nothing is posted
    calls = [];
    expect(await sink.sync()).toMatchObject({ ok: true, synced: 0 });
    expect(posts()).toBe(0);
  });

  it("sends only the entries that changed, and the images once", async () => {
    const { store, sink } = await setup();
    const a = await store.create(draft());
    await sink.sync();
    const bodies: string[] = [];
    const spy: typeof fetch = (i, n) => {
      if (n?.method === "POST") bodies.push(String(n.body));
      return routeFetch(i, n);
    };
    const s2 = createGithubSink({ endpoint: "/api/proompter/github", store, key: () => key, fetch: spy });
    await s2.sync(); // a new page load: everything is pending, the image goes again
    expect(bodies[0]).toContain("data:image/png");
    bodies.length = 0;
    await store.update(a.id, { title: "Renamed" });
    await s2.sync();
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).not.toContain("data:image/png");
    expect(fake.state.issues[0]?.title).toBe("PRO-1: Renamed");
    expect(fake.state.branches.get("reviews")?.has(`reviews/${SID}/assets/001-mobile.png`)).toBe(true);
  });

  it("resolves an entry whose issue was closed on GitHub, with one activity line", async () => {
    const { store, sink } = await setup();
    const a = await store.create(draft());
    await sink.sync();
    fake.state.issues[0]!.state = "closed";
    const r = await sink.sync();
    expect(r).toMatchObject({ ok: true, resolved: 1 });
    const e = store.get(a.id);
    expect(e?.status).toBe("resolved");
    expect(e?.activity.filter((x) => x.who === "github" && /resolved/i.test(x.text))).toHaveLength(1);
    // the resolved state went back up and the issue stays closed
    expect(fake.state.issues[0]?.state).toBe("closed");
    expect(sink.pending()).toEqual([]);
  });

  it("asks for issue states with this review's `started`, so another review's closed issues resolve nothing", async () => {
    const urls: string[] = [];
    const { store, sink } = await setup((input, init) => (urls.push(String(input)), routeFetch(input, init)));
    await store.create(draft());
    await sink.sync();
    const started = store.getState().session.started;
    expect(urls[0]).toBe(`/api/proompter/github?session=${SID}&started=${encodeURIComponent(started)}`);
    // Another review already owns this id on the branch: the sync stops with the route's 409 message.
    const md = fake.state.branches.get("reviews")!.get(`reviews/${SID}/session.md`)!.toString("utf8");
    fake.state.branches.get("reviews")!.set(`reviews/${SID}/session.md`, Buffer.from(md.replace(/^started: .*$/m, "started: 2026-10-10T18:00:00Z")));
    fake.state.issues[0]!.state = "closed";
    const r = await sink.sync();
    expect(r).toMatchObject({ ok: false, status: 409, error: expect.stringMatching(/belongs to another review/) });
    expect(store.getState().entries[0]?.status).toBe("open");
  });

  it("resolving locally closes the issue; reopening locally wins over a stale closed issue", async () => {
    const { store, sink } = await setup();
    const a = await store.create(draft());
    await sink.sync();
    await store.resolve(a.id, "rachit");
    await sink.sync();
    expect(fake.state.issues[0]?.state).toBe("closed");
    await store.update(a.id, { status: "open" }, "rachit");
    const r = await sink.sync();
    expect(r.resolved).toBe(0);
    expect(store.get(a.id)?.status).toBe("open");
    expect(fake.state.issues[0]?.state).toBe("open");
  });

  it("401: asks for the key (needsKey), then works once the key is right", async () => {
    const { store, sink } = await setup();
    await store.create(draft());
    key = null;
    const r = await sink.sync();
    expect(r).toMatchObject({ ok: false, status: 401, needsKey: true });
    expect(sink.needsKey).toBe(true);
    expect(sink.lastError).toMatch(/review key/i);
    expect(fake.state.issues).toHaveLength(0);
    key = "wrong";
    expect((await sink.sync()).needsKey).toBe(true);
    key = KEY;
    expect(await sink.sync()).toMatchObject({ ok: true, synced: 1 });
    expect(sink.needsKey).toBe(false);
    expect(sink.lastError).toBeNull();
  });

  it("404: says GitHub sync isn't set up, and never throws", async () => {
    const { store, sink } = await setup(async () => new Response("Not found", { status: 404 }));
    await store.create(draft());
    const r = await sink.sync();
    expect(r).toMatchObject({ ok: false, status: 404, error: "GitHub sync isn't set up on this server" });
    expect(sink.lastError).toBe("GitHub sync isn't set up on this server");
    expect(sink.pending()).toHaveLength(1);
  });

  it("a network failure or a non-route 2xx becomes an error, not an exception", async () => {
    const down = await setup(() => Promise.reject(new Error("offline")));
    await down.store.create(draft());
    expect(await down.sink.sync()).toMatchObject({ ok: false, error: "offline" });
    const html = await setup(async () => new Response("<html>", { status: 200, headers: { "content-type": "text/html" } }));
    await html.store.create(draft());
    expect((await html.sink.sync()).ok).toBe(false);
  });

  it("an edit made while the POST is in flight stays pending and goes out on the next sync", async () => {
    const { store, sink } = await setup();
    const a = await store.create(draft());
    let edited = false;
    const editing: typeof fetch = async (i, n) => {
      const res = await routeFetch(i, n);
      if (n?.method === "POST" && !edited) {
        edited = true;
        await store.update(a.id, { title: "Edited mid-flight" }, "rachit");
      }
      return res;
    };
    const s2 = createGithubSink({ endpoint: "/api/proompter/github", store, key: () => key, fetch: editing });
    await s2.sync();
    expect(store.get(a.id)?.issue).toBe("1");
    expect(store.get(a.id)?.title).toBe("Edited mid-flight");
    expect(s2.pending()).toEqual([a.id]);
    await s2.sync();
    expect(s2.pending()).toEqual([]);
    expect(fake.state.issues[0]?.title).toBe("PRO-1: Edited mid-flight");
    void sink;
  });

  it("one entry the route refuses does not stop the others", async () => {
    const real = routeFetch;
    const picky: typeof fetch = (i, n) => {
      if (n?.method === "POST" && String(n.body).includes("Bad one")) {
        return Promise.resolve(new Response(JSON.stringify({ ok: false, scope: "entry", error: "bad title" }), { status: 400, headers: { "content-type": "application/json" } }));
      }
      return real(i, n);
    };
    const { store, sink } = await setup(picky);
    await store.create(draft({ title: "Bad one" }));
    await store.create(draft({ title: "Fine" }));
    const r = await sink.sync();
    expect(r).toMatchObject({ ok: false, synced: 1, error: "bad title" });
    expect(fake.state.issues).toHaveLength(1);
  });

  it("notifies subscribers and returns the same pending array until it changes", async () => {
    const { store, sink } = await setup();
    const empty = sink.pending();
    expect(sink.pending()).toBe(empty);
    let n = 0;
    const off = sink.subscribe(() => n++);
    await store.create(draft());
    expect(n).toBeGreaterThan(0);
    off();
  });

  it("two calls at once share one run", async () => {
    const { store, sink } = await setup();
    await store.create(draft());
    const [a, b] = await Promise.all([sink.sync(), sink.sync()]);
    expect(a).toBe(b);
    expect(fake.state.issues).toHaveLength(1);
  });
});

describe("client bundle hygiene", () => {
  it("the sink imports nothing from src/github or src/server, and never names the token", () => {
    const src = readFileSync(new URL("./github.ts", import.meta.url), "utf8");
    const imports = [...src.matchAll(/^import .* from "([^"]+)";$/gm)].map((m) => m[1]);
    expect(imports.length).toBeGreaterThan(0);
    for (const spec of imports) expect(spec).not.toMatch(/github|server|node:/);
    expect(src).not.toContain("PROOMPTER_GITHUB_TOKEN");
  });
});
