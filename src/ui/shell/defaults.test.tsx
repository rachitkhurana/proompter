import { describe, expect, it } from "vitest";
import type { NewEntry } from "../../core/store";
import { createStore } from "../../core/store";
import { serialize } from "../../core/serialize";
import { seedEntries } from "./fake";
import { adaptStore, createDefaultDeps } from "./defaults";

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
});
