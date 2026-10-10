import { describe, expect, it, vi } from "vitest";
import type { Entry, EntryEvent, ProompterPlugin } from "./entry";
import { makeEntry, PNG } from "./entry-fixtures.test-util";
import { createFakeIdb } from "./fake-idb.test-util";
import { createStore, RedactError, type NewEntry, type StoreOptions } from "./store";

const session = { title: "Manual test pass", reviewer: "rachit", branch: "migrate/main", sha: "611df0b", started: new Date(2026, 9, 10, 12, 40) };
const fixedNow = () => new Date(Date.UTC(2026, 9, 10, 12, 42, 7, 321));

/** A draft the way the composer builds it. */
function draft(over: Partial<NewEntry> = {}): NewEntry {
  const {
    id: _id,
    n: _n,
    session: _s,
    status: _st,
    issue: _i,
    created: _c,
    updated: _u,
    activity: _a,
    ...rest
  } = makeEntry();
  void [_id, _n, _s, _st, _i, _c, _u, _a];
  return { ...rest, ...over };
}

function make(over: Partial<StoreOptions> = {}) {
  const idb = createFakeIdb();
  const store = createStore({ session, idb: idb.factory, now: fixedNow, ...over });
  const events: EntryEvent[] = [];
  store.on((e) => events.push(e));
  return { idb, store, events };
}

describe("createStore: session", () => {
  it("builds the session from the options", () => {
    const { store } = make();
    expect(store.getState().session).toEqual({
      id: "2026-10-10_manual-test-pass",
      title: "Manual test pass",
      reviewer: "rachit",
      branch: "migrate/main",
      sha: "611df0b",
      started: expect.stringMatching(/^2026-10-\d\dT\d\d:\d\d:00Z$/) as string,
      version: 1,
    });
  });

  it("an explicit id wins", () => {
    expect(make({ session: { ...session, id: "2026-10-10_custom" } }).store.getState().session.id).toBe("2026-10-10_custom");
  });

  it("rejects session ids that could leave the reviews folder or aren't a folder name", () => {
    for (const id of ["custom", "../x", "2026-10-10_../x", "2026-10-10_a/b", "2026-10-10_a\\b", "2026-10-10_..", "2026-10-10_A", "2026-10-10_", "2026-1-1_x", "/2026-10-10_x"]) {
      expect(() => createStore({ session: { ...session, id }, idb: null }), id).toThrow(/Invalid session id/);
    }
    expect(() => createStore({ session: { ...session, id: "2026-10-10_ok-1" }, idb: null })).not.toThrow();
  });
});

describe("create", () => {
  it("numbers entries PRO-1, PRO-2 and fills what the store owns", async () => {
    const { store } = make();
    const a = await store.create(draft());
    const b = await store.create(draft({ title: "Second" }));
    expect([a.id, a.n, b.id, b.n]).toEqual(["PRO-1", 1, "PRO-2", 2]);
    expect(a.session).toBe("2026-10-10_manual-test-pass");
    expect(a.status).toBe("open");
    expect(a.issue).toBeNull();
    expect(a.created).toBe("2026-10-10T12:42:07Z");
    expect(a.updated).toBe(a.created);
    expect(a.activity).toEqual([{ at: a.created, who: "rachit", text: "created" }]);
    expect(a.target).toEqual(a.targets[0]);
    expect(store.getState().entries.map((e) => e.id)).toEqual(["PRO-1", "PRO-2"]);
    expect(store.get("PRO-2")?.title).toBe("Second");
    expect(store.get("PRO-9")).toBeUndefined();
  });

  it("concurrent creates never share a number", async () => {
    const { store } = make();
    const all = await Promise.all([store.create(draft()), store.create(draft()), store.create(draft())]);
    expect(all.map((e) => e.n).sort()).toEqual([1, 2, 3]);
  });

  it("names the asset files from the entry number", async () => {
    const { store } = make();
    await store.create(draft());
    const e = await store.create(draft({ viewport: "tablet", snapshot: { element: PNG, viewport: PNG, fontsEmbedded: true } }));
    expect(e.snapshot?.assets).toEqual({ element: "002-tablet.png", viewport: "002-tablet-full.png" });
    expect(e.snapshot?.element).toBe(PNG);
    const onlyElement = await store.create(draft({ snapshot: { element: PNG, fontsEmbedded: false } }));
    expect(onlyElement.snapshot?.assets).toEqual({ element: "003-mobile.png" });
  });

  it("derives target from targets", async () => {
    const { store } = make();
    const e = await store.create(draft({ target: undefined, targets: [] }));
    expect(e.target).toBeUndefined();
    expect(e.targets).toEqual([]);
  });

  it("emits entry:created once, after the state changed, with the stored entry", async () => {
    const { store, events } = make();
    const seen: number[] = [];
    store.on(() => seen.push(store.getState().entries.length));
    const e = await store.create(draft());
    expect(events).toEqual([{ type: "entry:created", entry: e }]);
    expect(seen).toEqual([1]);
  });

  it("notifies subscribers with a new immutable snapshot", async () => {
    const { store } = make();
    await store.ready;
    const before = store.getState();
    const fn = vi.fn();
    const off = store.subscribe(fn);
    await store.create(draft());
    expect(fn).toHaveBeenCalledTimes(1);
    const after = store.getState();
    expect(after).not.toBe(before);
    expect(before.entries).toHaveLength(0);
    expect(after.entries).toHaveLength(1);
    expect(store.getState()).toBe(after); // stable until something changes
    off();
    await store.create(draft());
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("a throwing listener does not break the store or other listeners", async () => {
    const { store, events } = make();
    store.on(() => {
      throw new Error("sink bug");
    });
    store.subscribe(() => {
      throw new Error("ui bug");
    });
    const e = await store.create(draft());
    expect(events).toEqual([{ type: "entry:created", entry: e }]);
  });
});

describe("update and resolve", () => {
  it("changes fields, logs each change, bumps updated, emits entry:updated with the previous entry", async () => {
    let t = fixedNow().getTime();
    const { store, events } = make({ now: () => new Date((t += 60_000)) });
    const created = await store.create(draft());
    events.length = 0;
    const u = (await store.update(created.id, { priority: "blocking", status: "progress", tags: ["ui", "data"], testPlan: null, issue: "#481" }, "dana"))!;
    expect(u.priority).toBe("blocking");
    expect(u.status).toBe("progress");
    expect(u.tags).toEqual(["ui", "data"]);
    expect(u.testPlan).toBeUndefined();
    expect(u.issue).toBe("#481");
    expect(u.updated).not.toBe(created.updated);
    expect(u.activity.slice(1).map((a) => [a.who, a.text])).toEqual([
      ["dana", "status: open → progress"],
      ["dana", "priority: important → blocking"],
      ["dana", "tags: ui → ui, data"],
      ["dana", "test plan: §2 Feed and posts → none"],
      ["dana", "issue: none → #481"],
    ]);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ type: "entry:updated", entry: u, previous: created });
    expect(store.get(created.id)).toBe(u);
  });

  it("title, description, intent and task are editable; the number and session are not", async () => {
    const { store } = make();
    const c = await store.create(draft());
    const u = (await store.update(c.id, { title: "  New title ", description: "New text", intent: "question", task: "T-x" }))!;
    expect(u.title).toBe("New title");
    expect(u.description).toBe("New text");
    expect(u.intent).toBe("question");
    expect(u.task).toBe("T-x");
    expect(u.activity.map((a) => a.text)).toEqual(["created", "intent: fix → question", "title edited", "description edited", "task: T-feed-home → T-x"]);
    expect([u.id, u.n, u.session]).toEqual([c.id, c.n, c.session]);
  });

  it("resolution is patchable, logged, and removable with null", async () => {
    const { store } = make();
    const c = await store.create(draft());
    const u = (await store.update(c.id, { resolution: "Cropped it." }))!;
    expect(u.resolution).toBe("Cropped it.");
    expect(u.activity.at(-1)?.text).toBe("resolution edited");
    const r = (await store.update(c.id, { resolution: null }))!;
    expect(r.resolution).toBeUndefined();
    expect(r.activity.at(-1)?.text).toBe("resolution edited");
  });

  it("an empty or whitespace-only title is ignored, the rest of the patch still applies", async () => {
    const { store } = make();
    const c = await store.create(draft());
    expect(await store.update(c.id, { title: "" })).toBe(c);
    expect(await store.update(c.id, { title: "   \n " })).toBe(c);
    const u = (await store.update(c.id, { title: "  ", priority: "minor" }))!;
    expect(u.title).toBe(c.title);
    expect(u.priority).toBe("minor");
    expect(u.activity.map((a) => a.text)).toEqual(["created", "priority: important → minor"]);
  });

  it("a repeated edit containing a secret is a no-op: the patch is redacted before it is compared", async () => {
    const { store, events } = make();
    const c = await store.create(draft());
    const first = (await store.update(c.id, { description: "login with password=hunter2", tags: ["jo@example.com"] }))!;
    expect(first.description).not.toContain("hunter2");
    expect(first.tags).not.toContain("jo@example.com");
    const count = first.activity.length;
    events.length = 0;
    const again = await store.update(c.id, { description: "login with password=hunter2", tags: ["jo@example.com"] });
    expect(again).toBe(first);
    expect(again?.activity).toHaveLength(count);
    expect(events).toEqual([]);
  });

  it("no change: same entry back, no event, no write", async () => {
    const { store, events } = make();
    const c = await store.create(draft());
    events.length = 0;
    expect(await store.update(c.id, { status: "open", priority: "important", tags: ["ui"], title: c.title })).toBe(c);
    expect(await store.update(c.id, {})).toBe(c);
    expect(events).toEqual([]);
  });

  it("unknown id: undefined", async () => {
    const { store, events } = make();
    expect(await store.update("PRO-404", { status: "resolved" })).toBeUndefined();
    expect(events).toEqual([]);
  });

  it("resolve sets the status and logs who did it", async () => {
    const { store, events } = make();
    const c = await store.create(draft());
    const r = (await store.resolve(c.id, "dana"))!;
    expect(r.status).toBe("resolved");
    expect(r.activity.at(-1)).toMatchObject({ who: "dana", text: "status: open → resolved" });
    expect(events.at(-1)?.type).toBe("entry:updated");
    const { resolve } = store; // works detached
    expect(await resolve(c.id)).toBe(r);
  });
});

describe("persistence (IndexedDB)", () => {
  it("writes the session and every entry, and updates them", async () => {
    const { store, idb } = make();
    await store.ready;
    const a = await store.create(draft({ snapshot: { element: PNG, fontsEmbedded: true } }));
    await store.update(a.id, { status: "progress" });
    await store.flush();
    const sessions = idb.rows("proompter", "sessions");
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ id: "2026-10-10_manual-test-pass", reviewer: "rachit" });
    const rows = idb.rows("proompter", "entries");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ key: "2026-10-10_manual-test-pass/1", session: "2026-10-10_manual-test-pass" });
    expect((rows[0]?.entry as Entry).status).toBe("progress");
    expect((rows[0]?.entry as Entry).snapshot?.element).toBe(PNG); // data URLs are kept locally
  });

  it("a new store on the same database reloads the session and carries on numbering", async () => {
    const first = make();
    await first.store.create(draft({ title: "One" }));
    await first.store.create(draft({ title: "Two" }));
    await first.store.update("PRO-2", { status: "resolved" });
    await first.store.flush();
    first.store.close();

    const second = createStore({ session, idb: first.idb.factory, now: fixedNow });
    expect(second.getState().ready).toBe(false);
    await second.ready;
    expect(second.getState().ready).toBe(true);
    expect(second.getState().entries.map((e) => [e.id, e.title, e.status])).toEqual([
      ["PRO-1", "One", "open"],
      ["PRO-2", "Two", "resolved"],
    ]);
    const third = await second.create(draft({ title: "Three" }));
    expect(third.id).toBe("PRO-3");
    await second.flush();
    expect(first.idb.rows("proompter", "entries")).toHaveLength(3);
  });

  it("keeps the original start time when the session is reloaded", async () => {
    const first = make();
    await first.store.create(draft());
    await first.store.flush();
    const later = createStore({ session: { ...session, started: new Date(2026, 9, 10, 18, 5) }, idb: first.idb.factory });
    await later.ready;
    expect(later.getState().session.started).toBe(first.store.getState().session.started);
  });

  it("create waits for the load, so a fast first save cannot reuse a number", async () => {
    const first = make();
    await first.store.create(draft());
    await first.store.flush();
    const second = createStore({ session, idb: first.idb.factory });
    const e = await second.create(draft()); // no await on ready
    expect(e.id).toBe("PRO-2");
  });

  it("sessions do not see each other's entries", async () => {
    const first = make();
    await first.store.create(draft());
    await first.store.flush();
    const other = createStore({ session: { ...session, title: "Another pass" }, idb: first.idb.factory });
    await other.ready;
    expect(other.getState().entries).toEqual([]);
    expect((await other.create(draft())).id).toBe("PRO-1");
  });

  it("uses a custom database name", async () => {
    const { store, idb } = make({ dbName: "custom-db" });
    await store.create(draft());
    await store.flush();
    expect(idb.rows("custom-db", "entries")).toHaveLength(1);
    expect(idb.rows("proompter", "entries")).toHaveLength(0);
  });
});

describe("persistence falls back to memory", () => {
  const cases: Array<[string, Parameters<typeof createFakeIdb>[0] | "null" | "undefined-global"]> = [
    ["idb: null", "null"],
    ["open fails", { failOpen: true }],
    ["open throws (private mode)", { throwOnOpen: true }],
  ];
  for (const [name, mode] of cases) {
    it(`${name}: the store still works`, async () => {
      const idb = createFakeIdb(mode === "null" ? {} : (mode as object));
      const store = createStore({ session, idb: mode === "null" ? null : idb.factory, now: fixedNow });
      const events: EntryEvent[] = [];
      store.on((e) => events.push(e));
      await store.ready;
      expect(store.getState().ready).toBe(true);
      const e = await store.create(draft());
      expect(e.id).toBe("PRO-1");
      expect(events).toHaveLength(1);
      await store.flush();
      expect(idb.rows("proompter", "entries")).toEqual([]);
    });
  }

  it("a database that never answers does not hang the store", async () => {
    vi.useFakeTimers();
    try {
      const idb = createFakeIdb({ hang: true });
      const store = createStore({ session, idb: idb.factory });
      let ready = false;
      void store.ready.then(() => (ready = true));
      await vi.advanceTimersByTimeAsync(3000);
      expect(ready).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("writes that fail do not break create or update", async () => {
    const { store, idb, events } = make();
    await store.ready;
    idb.options.failWrites = true;
    const e = await store.create(draft());
    await store.update(e.id, { status: "progress" });
    await store.flush();
    expect(events.map((x) => x.type)).toEqual(["entry:created", "entry:updated"]);
    expect(store.getState().entries[0]?.status).toBe("progress");
  });

  it("a failed write calls onWriteError once per burst; the entry is still filed", async () => {
    const onWriteError = vi.fn();
    const { store, idb } = make({ onWriteError });
    await store.ready;
    const a = await store.create(draft());
    await store.flush();
    expect(onWriteError).not.toHaveBeenCalled();
    idb.options.failWrites = true;
    await store.update(a.id, { status: "progress" });
    await store.flush();
    expect(onWriteError).toHaveBeenCalledTimes(1);
    const b = await store.create(draft());
    await store.flush();
    expect(b.n).toBe(2);
    expect(store.getState().entries).toHaveLength(2);
    expect(onWriteError).toHaveBeenCalledTimes(1);
    idb.options.failWrites = false;
    await store.update(a.id, { status: "resolved" });
    await store.flush();
    idb.options.failWrites = true;
    await store.update(a.id, { status: "open" });
    await store.flush();
    expect(onWriteError).toHaveBeenCalledTimes(2);
  });

  it("a failed create write also calls onWriteError", async () => {
    const onWriteError = vi.fn();
    const { store, idb } = make({ onWriteError });
    await store.ready;
    idb.options.failWrites = true;
    const e = await store.create(draft());
    expect(e.id).toBe("PRO-1");
    expect(onWriteError).toHaveBeenCalledTimes(1);
  });

  it("with no indexedDB global at all (SSR, old browsers), runs in memory", async () => {
    vi.stubGlobal("indexedDB", undefined);
    try {
      const store = createStore({ session });
      await store.ready;
      expect((await store.create(draft())).id).toBe("PRO-1");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("redaction (fail closed)", () => {
  const strip: ProompterPlugin = {
    name: "strip",
    redact: (e) => ({ ...e, description: e.description.replace(/secret-\w+/g, "[redacted]"), context: { ...e.context, network: [] } }),
  };

  it("sinks and IndexedDB only ever see the redacted entry", async () => {
    const { store, events, idb } = make({ plugins: [strip] });
    const e = await store.create(draft({ description: "token secret-abc" }));
    await store.flush();
    expect(e.description).toBe("token [redacted]");
    expect(e.context.network).toEqual([]);
    expect(events).toEqual([{ type: "entry:created", entry: e }]);
    expect(JSON.stringify(idb.rows("proompter", "entries"))).not.toContain("secret-abc");
    const u = (await store.update(e.id, { description: "again secret-xyz" }))!;
    expect(u.description).toBe("again [redacted]");
    await store.flush();
    expect(JSON.stringify(idb.rows("proompter", "entries"))).not.toContain("secret-xyz");
  });

  it("the plugins passed to create are used for that call", async () => {
    const { store } = make();
    const e = await store.create(draft({ description: "secret-1" }), { plugins: [strip] });
    expect(e.description).toBe("[redacted]");
  });

  it("a failing plugin: create rejects, nothing is stored or emitted, the number is not used up", async () => {
    let broken = true;
    const flaky: ProompterPlugin = {
      name: "flaky",
      redact: (e) => {
        if (broken) throw new Error("boom");
        return e;
      },
    };
    const { store, events, idb } = make({ plugins: [flaky] });
    await store.ready;
    const fn = vi.fn();
    store.subscribe(fn);
    await expect(store.create(draft())).rejects.toBeInstanceOf(RedactError);
    await expect(store.create(draft())).rejects.toMatchObject({ plugin: "flaky" });
    expect(store.getState().entries).toEqual([]);
    expect(events).toEqual([]);
    expect(fn).not.toHaveBeenCalled();
    await store.flush();
    expect(idb.rows("proompter", "entries")).toEqual([]);
    broken = false;
    expect((await store.create(draft())).id).toBe("PRO-1");
  });

  it("a failing plugin on update leaves the entry as it was", async () => {
    let broken = false;
    const flaky: ProompterPlugin = {
      name: "flaky",
      redact: (e) => {
        if (broken) throw new Error("boom");
        return e;
      },
    };
    const { store, events } = make({ plugins: [flaky] });
    const c = await store.create(draft());
    events.length = 0;
    broken = true;
    await expect(store.update(c.id, { status: "resolved" })).rejects.toBeInstanceOf(RedactError);
    expect(store.get(c.id)).toEqual(c);
    expect(events).toEqual([]);
  });
});

describe("two tabs on one session", () => {
  it("never take the same number, and never overwrite each other", async () => {
    const idb = createFakeIdb();
    const a = createStore({ session, idb: idb.factory, now: fixedNow });
    const b = createStore({ session, idb: idb.factory, now: fixedNow });
    await Promise.all([a.ready, b.ready]);
    const [x, y, z] = await Promise.all([a.create(draft({ title: "A1" })), b.create(draft({ title: "B1" })), a.create(draft({ title: "A2" }))]);
    expect([x.n, y.n, z.n].sort()).toEqual([1, 2, 3]);
    expect(new Set([x.id, y.id, z.id]).size).toBe(3);
    await Promise.all([a.flush(), b.flush()]);
    const rows = idb.rows("proompter", "entries");
    expect(rows.map((r) => (r.entry as Entry).title).sort()).toEqual(["A1", "A2", "B1"]);
    // A third tab sees all of them and carries on.
    const c = createStore({ session, idb: idb.factory, now: fixedNow });
    await c.ready;
    expect(c.getState().entries).toHaveLength(3);
    expect((await c.create(draft())).n).toBe(4);
  });

  it("a stale tab skips numbers it hasn't seen instead of reusing them", async () => {
    const idb = createFakeIdb();
    const a = createStore({ session, idb: idb.factory, now: fixedNow });
    const b = createStore({ session, idb: idb.factory, now: fixedNow });
    await Promise.all([a.ready, b.ready]);
    await a.create(draft({ title: "first" }));
    await a.create(draft({ title: "second" }));
    const e = await b.create(draft({ title: "third" })); // b's memory is empty
    expect(e.n).toBe(3);
    expect(idb.rows("proompter", "entries")).toHaveLength(3);
  });
});
