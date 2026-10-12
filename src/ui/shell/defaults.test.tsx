import { describe, expect, it, vi } from "vitest";
import { createFilesSink } from "../../core/sinks/files";
import { createGithubSink } from "../../core/sinks/github";
import type * as StoreModule from "../../core/store";
import type { NewEntry } from "../../core/store";
import { createStore } from "../../core/store";
import { serialize } from "../../core/serialize";
import { toast } from "../primitives/toast";
import { seedEntries } from "./fake";
import { adaptStore, browserTag, BROWSER_TAG_STORAGE, createDefaultDeps, SESSION_START_STORAGE, sessionStart } from "./defaults";

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

  it("with GitHub sync the session id carries this browser's tag, kept across loads; without it, the plain id", () => {
    localStorage.removeItem(BROWSER_TAG_STORAGE);
    const idOf = () => vi.mocked(createStore).mock.calls.at(-1)![0].session.id;
    createDefaultDeps({ session: { title: "Manual test pass" }, github: {} });
    const first = idOf();
    expect(first).toMatch(/^\d{4}-\d{2}-\d{2}_manual-test-pass-[a-z0-9]{6}$/);
    expect(localStorage.getItem(BROWSER_TAG_STORAGE)).toBe(first!.slice(-6));
    createDefaultDeps({ session: { title: "Manual test pass" }, github: {} });
    expect(idOf()).toBe(first);
    // Another browser (no tag kept yet) gets another id.
    localStorage.removeItem(BROWSER_TAG_STORAGE);
    expect(browserTag()).not.toBe(first!.slice(-6));
    createDefaultDeps({ session: { title: "Manual test pass" } });
    expect(idOf()).toBeUndefined();
  });

  it("keeps the GitHub session's start per browser, so two tabs and a reload claim the same review", () => {
    localStorage.removeItem(BROWSER_TAG_STORAGE);
    localStorage.removeItem(SESSION_START_STORAGE);
    const last = () => vi.mocked(createStore).mock.calls.at(-1)![0].session;
    createDefaultDeps({ session: { title: "Manual test pass" }, github: {} });
    const tab1 = last();
    expect(tab1.started).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    createDefaultDeps({ session: { title: "Manual test pass" }, github: {} });
    expect(last()).toMatchObject({ id: tab1.id, started: tab1.started });
    // Junk in storage is replaced, not trusted.
    localStorage.setItem(SESSION_START_STORAGE, "{not json");
    expect(sessionStart(tab1.id!)).toMatch(/Z$/);
    localStorage.setItem(BROWSER_TAG_STORAGE, "NOPE!!");
    expect(browserTag()).toMatch(/^[a-z0-9]{6}$/);
  });

  it("an empty, non-Latin or very long title still makes a valid session id", () => {
    for (const title of ["", "Überprüfung 検証", "x".repeat(300)]) {
      createDefaultDeps({ session: { title }, github: {} });
      expect(vi.mocked(createStore).mock.calls.at(-1)![0].session.id).toMatch(/^\d{4}-\d{2}-\d{2}_[a-z0-9-]+$/);
    }
  });

  it("when localStorage throws, the tag lives in memory and the store keeps its own start", () => {
    const denied = () => {
      throw new Error("denied");
    };
    vi.stubGlobal("localStorage", { getItem: denied, setItem: denied, removeItem: denied });
    try {
      expect(browserTag()).toBe(browserTag());
      expect(sessionStart("2026-10-11_review-abcdef")).toBeUndefined();
      createDefaultDeps({ session: { title: "Review" }, github: {} });
      expect(vi.mocked(createStore).mock.calls.at(-1)![0].session).not.toHaveProperty("started");
    } finally {
      vi.unstubAllGlobals();
    }
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

describe("GitHub sync wiring (D16)", () => {
  it("without the github prop there is no syncGithub and no github status", async () => {
    const deps = createDefaultDeps({});
    expect(deps.store.syncGithub).toBeUndefined();
    expect(deps.store.getSnapshot().github).toBeUndefined();
  });

  it("with it: a pending count, a stable snapshot, and syncGithub(key) stores the key and sends it", async () => {
    localStorage.removeItem("proompter:review-key");
    const urls: string[] = [];
    const auth: (string | null)[] = [];
    const fetchSpy = vi.fn<typeof fetch>(async (input, init) => {
      urls.push(String(input));
      auth.push(new Headers(init?.headers).get("authorization"));
      return new Response("{}", { status: 401, headers: { "content-type": "application/json" } });
    });
    const { core } = await setup();
    const sink = createGithubSink({ store: core, key: () => localStorage.getItem("proompter:review-key"), fetch: fetchSpy });
    const store = adaptStore(core, undefined, sink);
    const snap = store.getSnapshot();
    expect(snap.github).toMatchObject({ pending: 1, error: null, needsKey: false });
    expect(store.getSnapshot()).toBe(snap);
    expect(store.syncGithub).toBeTypeOf("function");

    // A 401 asks for the key, and the snapshot says so.
    const r = await store.syncGithub?.();
    expect(r).toMatchObject({ ok: false, needsKey: true });
    expect(store.getSnapshot().github).toMatchObject({ needsKey: true });
    expect(auth[0]).toBeNull();
  });

  it("createDefaultDeps keeps the typed key in localStorage and sends it as a bearer token", async () => {
    localStorage.removeItem("proompter:review-key");
    const seen: (string | null)[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_i: unknown, init?: RequestInit) => {
        seen.push(new Headers(init?.headers).get("authorization"));
        return new Response("{}", { status: 401, headers: { "content-type": "application/json" } });
      }),
    );
    try {
      const deps = createDefaultDeps({ github: { endpoint: "/gh" } });
      await deps.store.syncGithub?.("secret-key");
      expect(localStorage.getItem("proompter:review-key")).toBe("secret-key");
      expect(seen).toContain("Bearer secret-key");
    } finally {
      vi.unstubAllGlobals();
      localStorage.removeItem("proompter:review-key");
    }
  });
});

describe("save option", () => {
  const idOf = () => vi.mocked(createStore).mock.calls.at(-1)![0].session.id;

  it('"github" makes no request to the files endpoint and the store has no write', async () => {
    const fetchSpy = vi.fn(async (_input: unknown) => new Response("{}", { status: 404 }));
    vi.stubGlobal("fetch", fetchSpy);
    vi.stubEnv("NODE_ENV", "development");
    try {
      const deps = createDefaultDeps({ save: "github", github: { endpoint: "/gh" } });
      expect(deps.store.write).toBeUndefined();
      expect(deps.store.syncGithub).toBeTypeOf("function");
      expect(idOf()).toMatch(/-[a-z0-9]{6}$/);
      await deps.store.getSnapshot();
      await new Promise((r) => setTimeout(r, 20));
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });

  it('"files" with the github prop has no syncGithub and a session id without the tag', () => {
    const deps = createDefaultDeps({ save: "files", session: { title: "Manual test pass" }, github: {} });
    expect(deps.store.write).toBeTypeOf("function");
    expect(deps.store.syncGithub).toBeUndefined();
    expect(deps.store.getSnapshot().github).toBeUndefined();
    expect(idOf()).toBeUndefined();
  });

  it("the default with the github prop is both", () => {
    const deps = createDefaultDeps({ github: {} });
    expect(deps.store.write).toBeTypeOf("function");
    expect(deps.store.syncGithub).toBeTypeOf("function");
  });

  it('"github" without the github prop falls back to files', () => {
    for (const save of ["github", "both"] as const) {
      const deps = createDefaultDeps({ save });
      expect(deps.store.write).toBeTypeOf("function");
      expect(deps.store.syncGithub).toBeUndefined();
      expect(idOf()).toBeUndefined();
    }
  });
});
