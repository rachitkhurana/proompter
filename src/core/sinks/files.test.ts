// @vitest-environment node
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createProompterRoute } from "../../next/route";
import { makeEntry, PNG } from "../entry-fixtures.test-util";
import { parse, serialize } from "../serialize";
import { createStore, type NewEntry } from "../store";
import { createFilesSink, diskPatch, type FilesSink } from "./files";

const SID = "2026-10-10_manual-test-pass";
let cwd: string;
let route: ReturnType<typeof createProompterRoute>;
let calls: { method: string; url: string; bytes: number }[];
let sinks: FilesSink[];

beforeEach(async () => {
  cwd = await fs.mkdtemp(path.join(os.tmpdir(), "proompter-sink-"));
  route = createProompterRoute({ cwd: () => cwd });
  calls = [];
  sinks = [];
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("NEXT_PUBLIC_PROOMPTER", "true");
});
afterEach(async () => {
  await Promise.all(sinks.map((s) => s.idle())); // no write may still be in flight when the folder goes
  vi.unstubAllEnvs();
  await fs.rm(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
});

/** A `fetch` that talks to the real route handlers (no network). */
const routeFetch: typeof fetch = async (input, init) => {
  const url = new URL(String(input), "http://localhost");
  const method = init?.method ?? "GET";
  calls.push({ method, url: url.pathname, bytes: typeof init?.body === "string" ? init.body.length : 0 });
  const req = new Request(url, init);
  return method === "POST" ? route.POST(req) : route.GET(req);
};
const posts = () => calls.filter((c) => c.method === "POST").length;

function draft(over: Partial<NewEntry> = {}): NewEntry {
  const { id: _i, ref: _r, n: _n, session: _s, status: _st, issue: _is, created: _c, updated: _u, activity: _a, ...rest } = makeEntry();
  return { ...rest, title: "Avatar is cropped on mobile", snapshot: { element: PNG, viewport: PNG }, ...over };
}

function newStore() {
  return createStore({ session: { title: "Manual test pass", reviewer: "rachit", id: SID }, idb: null });
}

function sinkFor(store: ReturnType<typeof newStore>, fetchImpl: typeof fetch = routeFetch, enabled?: boolean) {
  const sink = createFilesSink({ store, fetch: fetchImpl, ...(enabled !== undefined ? { enabled } : {}) });
  sinks.push(sink);
  return sink;
}

/** A store and a sink that has finished `rehydrate()` (so auto-posting is on). */
async function setup(fetchImpl: typeof fetch = routeFetch) {
  const store = newStore();
  await store.ready;
  const sink = sinkFor(store, fetchImpl);
  await sink.rehydrate();
  return { store, sink, dir: path.join(cwd, "reviews", SID) };
}

describe("files sink", () => {
  it("POSTs a created entry: files appear on disk and parse back, nothing stays pending", async () => {
    const { store, sink, dir } = await setup();
    const entry = await store.create(draft());
    expect(sink.pending().map((f) => f.path)).toContain("entries/001-avatar-is-cropped-on-mobile.md");
    await sink.idle();
    expect(sink.pending()).toEqual([]);
    expect(calls.find((c) => c.method === "POST")).toMatchObject({ url: "/api/proompter" });
    const md = await fs.readFile(path.join(dir, "entries", "001-avatar-is-cropped-on-mobile.md"), "utf8");
    expect(parse(md).id).toBe(entry.id);
    expect(await fs.stat(path.join(dir, "assets", "001-mobile.png"))).toBeTruthy();
    expect(await fs.stat(path.join(dir, "session.md"))).toBeTruthy();
  });

  it("lists pending files with add/modify, and an update re-posts and renames", async () => {
    const { store, sink, dir } = await setup();
    const entry = await store.create(draft());
    expect(sink.pending()).toEqual(
      expect.arrayContaining([
        { path: "entries/001-avatar-is-cropped-on-mobile.md", change: "add" },
        { path: "assets/001-mobile.png", change: "add" },
        { path: "assets/001-mobile-full.png", change: "add" },
        { path: "session.md", change: "add" },
      ]),
    );
    await sink.idle();
    await store.update(entry.id, { title: "Avatar clipped" });
    expect(sink.pending()).toEqual(
      expect.arrayContaining([
        { path: "entries/001-avatar-clipped.md", change: "modify" },
        { path: "session.md", change: "modify" },
      ]),
    );
    await sink.idle();
    expect(await fs.readdir(path.join(dir, "entries"))).toEqual(["001-avatar-clipped.md"]);
    expect(sink.pending()).toEqual([]);
  });

  it("returns the same pending array until something changes, and notifies subscribers", async () => {
    const { store, sink } = await setup();
    const empty = sink.pending();
    expect(sink.pending()).toBe(empty);
    let n = 0;
    const off = sink.subscribe(() => n++);
    await store.create(draft());
    expect(n).toBeGreaterThan(0);
    expect(sink.pending()).not.toBe(empty);
    off();
  });

  it("holds every automatic post until rehydrate() has finished", async () => {
    const store = newStore();
    await store.ready;
    const sink = sinkFor(store);
    await store.create(draft());
    await sink.idle();
    expect(posts()).toBe(0);
    expect(sink.pending().length).toBeGreaterThan(0);
    await sink.rehydrate();
    await sink.idle();
    expect(posts()).toBe(1);
    expect(sink.pending()).toEqual([]);
  });

  it("a stale store copy does not overwrite a hand edit on disk", async () => {
    const a = await setup();
    await a.store.create(draft());
    await a.sink.idle();
    const file = path.join(a.dir, "entries", "001-avatar-is-cropped-on-mobile.md");
    await fs.writeFile(file, (await fs.readFile(file, "utf8")).replace("status: open", "status: resolved"));

    const store = newStore(); // a reload: an older copy (status open) is in the store
    await store.ready;
    const sink = sinkFor(store);
    await store.create(draft());
    await sink.rehydrate();
    await sink.idle();
    expect(parse(await fs.readFile(file, "utf8")).status).toBe("resolved");
    expect(store.getState().entries[0]?.status).toBe("resolved");
  });

  it("on 404 (preview/prod) entries stay pending and auto-posting stops until write()", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { store, sink, dir } = await setup();
    expect(sink.paused()).toBe(true); // the rehydrate GET got a 404
    await store.create(draft());
    await store.flush();
    expect(posts()).toBe(0); // no auto post while paused
    const first = await sink.write();
    expect(first).toMatchObject({ ok: false, status: 404 });
    expect(sink.paused()).toBe(true);
    const before = posts();

    await store.create(draft({ title: "Second" }));
    await store.flush();
    expect(posts()).toBe(before);
    expect(sink.pending().map((f) => f.path)).toEqual(expect.arrayContaining(["entries/001-avatar-is-cropped-on-mobile.md", "entries/002-second.md"]));

    vi.stubEnv("NODE_ENV", "development"); // the explicit retry
    const r = await sink.write();
    expect(r.ok).toBe(true);
    expect(sink.paused()).toBe(false);
    expect(sink.pending()).toEqual([]);
    expect(await fs.readdir(path.join(dir, "entries"))).toHaveLength(2);
  });

  it("enabled: false never calls the route on its own, but write() still tries", async () => {
    const store = newStore();
    await store.ready;
    const sink = sinkFor(store, routeFetch, false);
    await sink.rehydrate();
    await store.create(draft());
    await sink.idle();
    expect(calls).toEqual([]);
    expect(sink.paused()).toBe(true);
    expect(sink.pending().length).toBeGreaterThan(0);
    expect((await sink.write()).ok).toBe(true);
    expect(posts()).toBe(1);
  });

  it("a 200 that is not the route's JSON {ok:true} counts as 'no route': pending, paused", async () => {
    const html: typeof fetch = async () => new Response("<html>hi</html>", { status: 200, headers: { "content-type": "text/html" } });
    const { store, sink } = await setup(html);
    await store.create(draft());
    const r = await sink.write();
    expect(r.ok).toBe(false);
    expect(sink.paused()).toBe(true);
    expect(sink.pending().length).toBeGreaterThan(0);

    const noOk: typeof fetch = async () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    const b = await setup(noOk);
    await b.store.create(draft());
    expect((await b.sink.write()).ok).toBe(false);
    expect(b.sink.paused()).toBe(true);
    expect(b.sink.pending().length).toBeGreaterThan(0);
  });

  it("sends one entry per request: 18 entries with 600 KB images are written after a 404 pause", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { store, sink, dir } = await setup();
    const big = `data:image/png;base64,${Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(450_000, 7)]).toString("base64")}`; // ~600 KB as a data URL
    expect(big.length * 2 * 18).toBeGreaterThan(20 * 1024 * 1024); // one batch would be over the route's cap
    for (let i = 1; i <= 18; i++) await store.create(draft({ title: `Entry ${i}`, snapshot: { element: big, viewport: big } }));
    expect(sink.pending().length).toBeGreaterThan(18);

    vi.stubEnv("NODE_ENV", "development");
    const r = await sink.write();
    expect(r.ok).toBe(true);
    expect(sink.pending()).toEqual([]);
    expect(await fs.readdir(path.join(dir, "entries"))).toHaveLength(18);
    expect(Math.max(...calls.filter((c) => c.method === "POST").map((c) => c.bytes))).toBeLessThan(2_000_000);

    // images already on disk are not sent again
    calls.length = 0;
    await store.update("PRO-3", { title: "Entry three, renamed" });
    await sink.idle();
    const last = calls.filter((c) => c.method === "POST").at(-1)!;
    expect(last.bytes).toBeLessThan(20_000);
    expect(sink.pending()).toEqual([]);
  });

  it("one rejected entry (400) does not block the others", async () => {
    const picky: typeof fetch = async (input, init) => {
      if (init?.method === "POST" && String(init.body).includes('"title":"Bad"')) {
        return new Response(JSON.stringify({ ok: false, scope: "entry", error: "nope" }), { status: 400, headers: { "content-type": "application/json" } });
      }
      return routeFetch(input, init);
    };
    const { store, sink, dir } = await setup(picky);
    await store.create(draft({ title: "Good one" }));
    await store.create(draft({ title: "Bad" }));
    await store.create(draft({ title: "Good two" }));
    await sink.idle();
    const r = await sink.write();
    expect(r).toMatchObject({ ok: false, status: 400, error: "nope" });
    expect((await fs.readdir(path.join(dir, "entries"))).sort()).toEqual(["001-good-one.md", "003-good-two.md"]);
    expect(sink.pending().map((f) => f.path)).toContain("entries/002-bad.md");
    expect(sink.pending().map((f) => f.path)).not.toContain("entries/001-good-one.md");
  });

  it("never throws into the host: network errors, bad statuses and a broken fetch leave entries pending", async () => {
    const down: typeof fetch = () => Promise.reject(new Error("offline"));
    const { store, sink } = await setup(down);
    await expect(store.create(draft())).resolves.toBeTruthy();
    const r = await sink.write();
    expect(r).toMatchObject({ ok: false, error: "offline" });
    expect(sink.pending().length).toBeGreaterThan(0);

    const boom = vi.fn<typeof fetch>(async () => new Response("no", { status: 500 }));
    const b = await setup(boom);
    await b.store.create(draft());
    expect(await b.sink.write()).toMatchObject({ ok: false, status: 500 });
    const afterWrite = boom.mock.calls.length;
    await b.sink.write();
    expect(boom.mock.calls.length).toBe(afterWrite + 1); // one request per explicit write(), no loop
    expect(b.sink.pending().length).toBeGreaterThan(0);
  });

  it("sends the x-proompter header on every request", async () => {
    const seen: (string | null)[] = [];
    const spy: typeof fetch = async (input, init) => {
      seen.push(new Headers(init?.headers).get("x-proompter"));
      return routeFetch(input, init);
    };
    const { store, sink } = await setup(spy);
    await store.create(draft());
    await sink.idle();
    expect(seen.length).toBeGreaterThanOrEqual(2); // the rehydrate GET and the POST
    expect(seen.every((h) => h === "1")).toBe(true);
  });
});

describe("rehydrate", () => {
  it("disk wins for the fields the file carries; images and activity are kept", async () => {
    const { store, sink, dir } = await setup();
    const entry = await store.create(draft());
    await sink.idle();
    const file = path.join(dir, "entries", "001-avatar-is-cropped-on-mobile.md");
    const md = await fs.readFile(file, "utf8");
    await fs.writeFile(file, md.replace("status: open", "status: resolved").replace("priority: important", "priority: minor"));

    const fresh = sinkFor(store);
    const result = await fresh.rehydrate();
    expect(result).toMatchObject({ found: true, updated: 1, adopted: [] });
    await store.flush();
    const merged = store.get(entry.id)!;
    expect(merged.status).toBe("resolved");
    expect(merged.priority).toBe("minor");
    expect(merged.snapshot?.element).toBe(PNG);
    expect(merged.context.console.length).toBeGreaterThan(0);
    expect(merged.activity.length).toBeGreaterThan(entry.activity.length);
  });

  it("a title edited on disk renames the entry in the store", async () => {
    const { store, sink, dir } = await setup();
    await store.create(draft({ title: "Local title" }));
    await sink.idle();
    const file = path.join(dir, "entries", "001-local-title.md");
    await fs.writeFile(file, (await fs.readFile(file, "utf8")).replace("# Local title", "# Edited on disk"));
    await sinkFor(store).rehydrate();
    expect(store.getState().entries[0]?.title).toBe("Edited on disk");
  });

  it("entries already on disk are not pending afterwards", async () => {
    const { store, sink } = await setup();
    await store.create(draft());
    await sink.idle();
    const fresh = sinkFor(store);
    await fresh.rehydrate();
    expect(fresh.pending()).toEqual([]);
  });

  it("a 404 is reported as paused, with nothing found", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const store = newStore();
    await store.ready;
    const sink = sinkFor(store);
    await store.create(draft());
    expect(await sink.rehydrate()).toEqual({ found: false, updated: 0, adopted: [] });
    expect(sink.paused()).toBe(true);
    expect(sink.pending().length).toBeGreaterThan(0);
  });

  it("never throws, even when fetch fails", async () => {
    const store = newStore();
    await store.ready;
    const sink = sinkFor(store, () => Promise.reject(new Error("offline")));
    await expect(sink.rehydrate()).resolves.toMatchObject({ found: false });
  });

  it("entries that exist only on disk are loaded into the store (numbers kept, no created event)", async () => {
    const { store, sink } = await setup();
    await store.create(draft());
    await store.create(draft({ title: "Second" }));
    await sink.idle();

    const empty = newStore(); // IndexedDB was cleared
    await empty.ready;
    const created: string[] = [];
    empty.on((e) => created.push(e.type));
    const fresh = sinkFor(empty);
    const r = await fresh.rehydrate();
    expect(r.adopted.map((e) => e.id)).toEqual(["PRO-1", "PRO-2"]);
    expect(empty.getState().entries.map((e) => e.id)).toEqual(["PRO-1", "PRO-2"]);
    expect(created).toEqual([]);
    expect(fresh.pending()).toEqual([]);
    const next = await empty.create(draft({ title: "Third" }));
    expect(next.n).toBe(3);
  });
});

describe("store.hydrate", () => {
  it("adopts missing entries of this session only, never replaces existing numbers", async () => {
    const store = newStore();
    await store.ready;
    const mine = await store.create(draft());
    const added = await store.hydrate([
      makeEntry({ id: "PRO-1", n: 1, session: SID, title: "Clobber?" }),
      makeEntry({ id: "PRO-4", n: 4, session: SID }),
      makeEntry({ id: "PRO-7", n: 7, session: "2026-10-10_other" }),
    ]);
    expect(added.map((e) => e.n)).toEqual([4]);
    expect(store.getState().entries.map((e) => e.n)).toEqual([1, 4]);
    expect(store.get(mine.id)?.title).toBe(mine.title);
    expect((await store.create(draft({ title: "Next" }))).n).toBe(5);
  });
});

describe("diskPatch", () => {
  it("is empty for an entry equal to its file projection, and lists changed fields", () => {
    const e = makeEntry();
    const disk = parse(serialize(e));
    expect(diskPatch(e, disk)).toEqual({});
    expect(diskPatch(e, { ...disk, status: "resolved", testPlan: undefined, title: "New" })).toEqual({
      status: "resolved",
      testPlan: null,
      title: "New",
    });
  });
});

describe("hardening, round 3", () => {
  it("re-posting an adopted entry keeps its original Context lines", async () => {
    const { store, sink, dir } = await setup();
    await store.create(draft());
    await sink.idle();
    const file = path.join(dir, "entries", "001-avatar-is-cropped-on-mobile.md");
    expect(await fs.readFile(file, "utf8")).toContain("- Console: 2 lines, 1 error");

    const empty = newStore(); // IndexedDB cleared: the entry is adopted from the file (empty arrays + summary)
    await empty.ready;
    const fresh = sinkFor(empty);
    expect((await fresh.rehydrate()).adopted).toHaveLength(1);
    await empty.update("PRO-1", { status: "progress" });
    await fresh.idle();
    const md = await fs.readFile(file, "utf8");
    expect(md).toContain("status: progress");
    expect(md).toContain("- Console: 2 lines, 1 error");
    expect(md).not.toContain("Console: 0 lines");
  });

  /** POSTs go to a LAN host, GETs to localhost (the rehydrate GET must not be what pauses the sink). */
  const lan: typeof fetch = async (input, init) => {
    const method = init?.method ?? "GET";
    const url = new URL(String(input), method === "POST" ? "http://192.168.1.20:3000" : "http://localhost");
    calls.push({ method, url: url.pathname, bytes: 0 });
    const req = new Request(url, init);
    return method === "POST" ? route.POST(req) : route.GET(req);
  };

  it("a route-level 403 stops and pauses at once: one POST for 5 entries, none on update; then allowedHosts via env works", async () => {
    const { store, sink, dir } = await setup(lan);
    for (let i = 1; i <= 5; i++) await store.create(draft({ title: `Entry ${i}` }));
    await sink.idle();
    expect(posts()).toBe(1);
    expect(sink.paused()).toBe(true);
    expect(sink.pending().length).toBeGreaterThan(5);

    await store.update("PRO-2", { status: "progress" });
    await sink.idle();
    expect(posts()).toBe(1); // no re-send of every dirty entry on every event

    vi.stubEnv("PROOMPTER_ALLOWED_HOSTS", "192.168.1.20");
    const r = await sink.write();
    expect(r.ok).toBe(true);
    expect(sink.pending()).toEqual([]);
    expect(await fs.readdir(path.join(dir, "entries"))).toHaveLength(5);
  });

  it("a new entry cannot take a number that is already on disk, even if create() starts before rehydrate()", async () => {
    const a = await setup();
    await a.store.create(draft({ title: "Disk one" }));
    await a.sink.idle();

    // eslint-disable-next-line prefer-const -- assigned after the store exists; the store's beforeCreate closure reads it
    let gate: FilesSink | undefined;
    const store = createStore({ session: { title: "Manual test pass", reviewer: "rachit", id: SID }, idb: null, beforeCreate: () => gate?.hydrated });
    await store.ready;
    const sink = sinkFor(store);
    gate = sink;
    const pendingCreate = store.create(draft({ title: "Brand new" })); // before the disk has been read
    const r = await sink.rehydrate();
    const created = await pendingCreate;
    await sink.idle();
    expect(r.adopted.map((e) => e.id)).toEqual(["PRO-1"]);
    expect(created.n).toBe(2);
    expect((await fs.readdir(path.join(a.dir, "entries"))).sort()).toEqual(["001-disk-one.md", "002-brand-new.md"]);
  });
});
