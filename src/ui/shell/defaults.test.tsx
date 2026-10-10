import { describe, expect, it, vi } from "vitest";
import { createFilesSink } from "../../core/sinks/files";
import type * as StoreModule from "../../core/store";
import type { NewEntry } from "../../core/store";
import { createStore } from "../../core/store";
import { serialize } from "../../core/serialize";
import { toast } from "../primitives/toast";
import { seedEntries } from "./fake";
import { adaptStore, createDefaultDeps } from "./defaults";

// The real store, but its options are recorded (to reach `onWriteError`); the toast is a spy.
vi.mock("../../core/store", async (orig) => {
  const m = await orig<typeof StoreModule>();
  return { ...m, createStore: vi.fn(m.createStore) };
});
vi.mock("../primitives/toast", () => ({ toast: vi.fn() }));

function draft(): NewEntry {
  const { id: _id, ref: _ref, n: _n, session: _s, status: _st, issue: _i, created: _c, updated: _u, activity: _a, ...rest } =
    seedEntries("/feeds")[0]!;
  return { ...rest, title: "Avatar is cropped on mobile", priority: "important" };
}

async function setup() {
  const core = createStore({ session: { title: "Manual test pass", reviewer: "rachit" }, idb: null });
  await core.ready;
  const store = adaptStore(core);
  const entry = await core.create(draft());
  return { core, store, entry };
}

describe("adaptStore (T07's store behind the root's EntryStore)", () => {
  it("returns the store's session and entries, an empty pending list, and a stable snapshot", async () => {
    const { store, entry } = await setup();
    const a = store.getSnapshot();
    expect(a.session.title).toBe("Manual test pass");
    expect(a.entries.map((e) => e.id)).toEqual([entry.id]);
    expect(a.pending).toEqual([]); // INTEGRATION(T09)
    expect(store.getSnapshot()).toBe(a);
  });

  it("notifies subscribers, and update/resolve go through with exactly one activity line each", async () => {
    const { core, store, entry } = await setup();
    let calls = 0;
    const off = store.subscribe(() => calls++);
    const before = store.getSnapshot();
    store.update(entry.id, { status: "progress" }, "rachit");
    await core.flush();
    const after = store.getSnapshot();
    expect(after).not.toBe(before);
    expect(calls).toBeGreaterThan(0);
    const e1 = after.entries[0]!;
    expect(e1.status).toBe("progress");
    expect(e1.activity.length).toBe(entry.activity.length + 1);
    expect(e1.activity.at(-1)).toMatchObject({ who: "rachit", text: "status: open → progress" });

    store.resolve(entry.id, "rachit");
    await core.flush();
    const e2 = store.getSnapshot().entries[0]!;
    expect(e2.status).toBe("resolved");
    expect(e2.activity.length).toBe(e1.activity.length + 1);
    off();
  });

  it("unlinks the test plan with null", async () => {
    const { core, store, entry } = await setup();
    store.update(entry.id, { testPlan: "§2 Feed and posts" }, "rachit");
    await core.flush();
    expect(store.getSnapshot().entries[0]?.testPlan).toBe("§2 Feed and posts");
    store.update(entry.id, { testPlan: null }, "rachit");
    await core.flush();
    expect(store.getSnapshot().entries[0]?.testPlan).toBeUndefined();
  });
});

describe("createDefaultDeps", () => {
  it("uses the real serializer (the output carries ref:) and builds repo-relative entry paths", async () => {
    const deps = createDefaultDeps({ session: { reviewer: "rachit", title: "Manual test pass" } });
    const core = createStore({ session: { title: "x", reviewer: "y" }, idb: null });
    await core.ready;
    const e = await core.create(draft());
    const md = deps.serialize(e, core.getState().session);
    expect(md).toBe(serialize(e, core.getState().session));
    expect(md).toMatch(/^ref: .*PRO-1$/m);
    const s = deps.store.getSnapshot().session;
    expect(deps.entryPath(e, s)).toBe(`reviews/${s.id}/entries/001-avatar-is-cropped-on-mobile.md`);
    expect(s.reviewer).toBe("rachit");
    expect(s.title).toBe("Manual test pass");
  });

  it("warns with a toast when the store cannot save locally", () => {
    createDefaultDeps({});
    const opts = vi.mocked(createStore).mock.calls.at(-1)![0];
    expect(toast).not.toHaveBeenCalled();
    opts.onWriteError?.();
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith("Couldn't save locally. The entry is kept until you close this tab.");
  });
});

describe("adaptStore with the files sink (INTEGRATION(T09))", () => {
  async function withSink(status: number) {
    const { core, entry } = await setup();
    // The stub is injected: nothing here may reach a real server.
    const fetchSpy = vi.fn<typeof fetch>(async () =>
      status === 404
        ? new Response("Not found", { status })
        : new Response(JSON.stringify({ ok: true, files: [] }), { status, headers: { "content-type": "application/json" } }),
    );
    const sink = createFilesSink({ store: core, fetch: fetchSpy });
    const store = adaptStore(core, sink);
    return { core, entry, sink, store, fetchSpy };
  }

  it("exposes the sink's pending files and a write() that flushes them", async () => {
    const { core, store, fetchSpy } = await withSink(200);
    await core.create({ ...draft(), title: "Second" });
    const snap = store.getSnapshot();
    expect(snap.pending.map((f) => f.path)).toEqual(
      expect.arrayContaining(["entries/002-second.md", "session.md"]),
    );
    expect(store.getSnapshot()).toBe(snap);
    expect(store.write).toBeTypeOf("function");
    await store.write?.();
    expect(fetchSpy.mock.calls.at(-1)?.[1]?.method).toBe("POST");
    expect(store.getSnapshot().pending).toEqual([]);
  });

  it("notifies subscribers when the pending list changes", async () => {
    const { core, store } = await withSink(200);
    let calls = 0;
    const off = store.subscribe(() => calls++);
    await core.create({ ...draft(), title: "Another" });
    expect(calls).toBeGreaterThan(0);
    off();
  });

  it("keeps entries pending when the route is missing (404)", async () => {
    const { core, store } = await withSink(404);
    await core.create({ ...draft(), title: "Unwritten" }); // something to keep pending
    await store.write?.();
    expect(store.getSnapshot().pending.length).toBeGreaterThan(0);
  });

  it("without a sink there is no write() and nothing is pending", async () => {
    const { store } = await setup();
    expect(store.write).toBeUndefined();
  });

  it("createDefaultDeps wires a sink: write is available and the endpoint is configurable", async () => {
    const fetchSpy = vi.fn(async (_input: unknown) => new Response("{}", { status: 404 }));
    vi.stubGlobal("fetch", fetchSpy);
    vi.stubEnv("NODE_ENV", "development"); // the root only talks to the route in dev
    try {
      const deps = createDefaultDeps({ endpoint: "/custom/endpoint" });
      expect(deps.store.write).toBeTypeOf("function");
      await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalled());
      expect(String(fetchSpy.mock.calls[0]?.[0])).toContain("/custom/endpoint");
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });

  it("outside dev the root makes no request on mount", async () => {
    const fetchSpy = vi.fn(async (_input: unknown) => new Response("Not found", { status: 404 }));
    vi.stubGlobal("fetch", fetchSpy);
    try {
      const deps = createDefaultDeps({});
      await deps.store.getSnapshot();
      await new Promise((r) => setTimeout(r, 20));
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
